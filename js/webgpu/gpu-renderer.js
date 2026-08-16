// WebGPU renderer: per-pixel 3D raymarch in a compute shader, then a
// glyph-mapped upscale. This is the only renderer.
const GPURenderer = {
  ok: false, device: null, ctx: null,
  cols: 0, rows: 0, cellPx: 10,
  reason: '',

  async init() {
    const canvas = document.getElementById('screen');
    if (!navigator.gpu) { this.reason = 'this browser has no WebGPU support'; return false; }
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) { this.reason = 'no GPU adapter available'; return false; }
      device = await adapter.requestDevice();
    } catch (e) { this.reason = 'device request failed: ' + e.message; return false; }

    this.device = device;
    this.ctx = canvas.getContext('webgpu');
    if (!this.ctx) { this.reason = 'could not get a webgpu canvas context'; return false; }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    device.lost.then(info => {
      this.ok = false;
      console.error('[WebGPU] device lost: ' + info.message);
    });

    this.resize();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    // world cells: type | height<<8 | ao<<16
    this.uploadWorld();

    // two vec4 per entity: (x, y, heading, kind), (halfLen, halfWid, height, phase)
    this.entCount = Entities.cars.length + Entities.peds.length;
    this.entData = new Float32Array(Math.max(this.entCount, 1) * 8);
    this.entBuf = device.createBuffer({
      size: this.entData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // billboard signage
    const signs = SignAtlas.build();
    this.signCount = signs.count;
    this.signTex = device.createTexture({
      size: [signs.canvas.width, signs.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
             GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: signs.canvas }, { texture: this.signTex },
      [signs.canvas.width, signs.canvas.height]);
    this.signSamp = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    this.buildAtlas(CFG.GLYPH_SET);

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniBuf = device.createBuffer({
      size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rparBuf = device.createBuffer({
      size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    device.pushErrorScope('validation');
    const cmod = device.createShaderModule({ code: WGSL_COMPUTE });
    const rmod = device.createShaderModule({ code: WGSL_RENDER });
    if (!await this.checkShader(cmod, 'compute')) return false;
    if (!await this.checkShader(rmod, 'render')) return false;

    this.computePipe = device.createComputePipeline({
      layout: 'auto', compute: { module: cmod, entryPoint: 'main' } });
    this.renderPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: rmod, entryPoint: 'vs' },
      fragment: { module: rmod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.allocTargets();

    const err = await device.popErrorScope();
    if (err) {
      this.reason = 'pipeline validation: ' + err.message;
      console.error('[WebGPU] ' + this.reason);
      return false;
    }
    this.ok = true;
    return true;
  },

  // (Re)build the glyph atlas texture. Safe to call at runtime; the render
  // bind group is recreated because the texture object changes.
  buildAtlas(setName) {
    const atlas = GlyphAtlas.build(setName, this.cellDev);
    this.atlasCell = atlas.cell;
    this.levels = atlas.levels;
    this.rampChars = atlas.chars;
    if (this.atlasTex) this.atlasTex.destroy();
    this.atlasTex = this.device.createTexture({
      size: [atlas.canvas.width, atlas.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
             GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: atlas.canvas }, { texture: this.atlasTex },
      [atlas.canvas.width, atlas.canvas.height]);
    if (this.renderPipe) this.allocTargets();
    return atlas;
  },

  setGlyphSet(name) {
    CFG.GLYPH_SET = name;
    this.buildAtlas(name);
    return { set: name, levels: this.levels, chars: this.rampChars };
  },

  uploadWorld() {
    const N = CFG.WORLD * CFG.WORLD;
    // type | height<<8 | baseGround<<16 | nearObj<<24 | elev<<25.
    // Canopies overhang their own cell, so a ray must test trees in a
    // neighbourhood; the flag marks where that search is worth doing.
    // elev is ground elevation in ELEV_STEP units (7 bits, 0..127 capacity,
    // generator caps at ELEV_MAX=63).
    const W = CFG.WORLD, R = CFG.TREE_REACH;
    const packed = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      packed[i] = (World.type[i] & 0xff) |
                  ((Math.min(World.height[i], 255) & 0xff) << 8) |
                  ((World.base[i] & 0xff) << 16) |
                  ((World.elev[i] & 0x7f) << 25);
    }
    // flag cells whose neighbourhood holds a tree or a prop, so rays only pay
    // for the object search where something can actually be hit
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (World.type[i] !== T_TREE && !World.prop[i]) continue;
      const y0 = Math.max(0, y - R), y1 = Math.min(W - 1, y + R);
      const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R);
      for (let ny = y0; ny <= y1; ny++)
        for (let nx = x0; nx <= x1; nx++) packed[ny * W + nx] |= (1 << 24);
    }
    this.cellBuf = this.device.createBuffer({
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cellBuf, 0, packed);

    this.propBuf = this.device.createBuffer({
      size: World.prop.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.propBuf, 0, World.prop);
  },

  async checkShader(mod, label) {
    if (!mod.getCompilationInfo) return true;
    const info = await mod.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    for (const m of info.messages) {
      const where = `${label}.wgsl:${m.lineNum}:${m.linePos}`;
      if (m.type === 'error') console.error(`[WGSL ${where}] ${m.message}`);
      else console.warn(`[WGSL ${where}] ${m.message}`);
    }
    if (errors.length) {
      this.reason = `${label} shader failed to compile (see console)`;
      return false;
    }
    return true;
  },

  // Glyphs alias badly unless one atlas texel maps to exactly one device
  // pixel. Two things break that: a backing store that does not match the
  // display's pixel ratio, and a canvas whose size is not a whole number of
  // cells. Both leave the browser resampling at a fractional ratio, which
  // beats against the glyph strokes as moire.
  resize() {
    const canvas = document.getElementById('screen');
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    this.dpr = dpr;
    this.cellDev = Math.max(4, Math.round(this.cellPx * dpr));

    this.cols = Math.max(40, Math.floor((innerWidth * dpr) / this.cellDev));
    this.rows = Math.max(24, Math.floor((innerHeight * dpr) / this.cellDev));

    // exact whole number of cells, then displayed at exactly that many
    // device pixels so nothing is rescaled
    canvas.width = this.cols * this.cellDev;
    canvas.height = this.rows * this.cellDev;
    canvas.style.width = (canvas.width / dpr) + 'px';
    canvas.style.height = (canvas.height / dpr) + 'px';
  },

  allocTargets() {
    if (this.lowTex) this.lowTex.destroy();
    this.lowTex = this.device.createTexture({
      size: [this.cols, this.rows],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.COPY_SRC,
    });
    this.computeBind = this.device.createBindGroup({
      layout: this.computePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniBuf } },
        { binding: 1, resource: { buffer: this.cellBuf } },
        { binding: 2, resource: this.lowTex.createView() },
        { binding: 3, resource: { buffer: this.entBuf } },
        { binding: 4, resource: { buffer: this.propBuf } },
        { binding: 5, resource: this.signTex.createView() },
        { binding: 6, resource: this.signSamp },
      ],
    });
    this.renderBind = this.device.createBindGroup({
      layout: this.renderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.lowTex.createView() },
        { binding: 1, resource: this.atlasTex.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.rparBuf } },
      ],
    });
  },

  handleResize() {
    const oc = this.cols, or = this.rows, ocell = this.cellDev;
    this.resize();
    if (!this.ok) return;
    // a changed cell size means the atlas is no longer 1:1 with the display
    if (this.cellDev !== ocell) { this.buildAtlas(CFG.GLYPH_SET); return; }
    if (this.cols !== oc || this.rows !== or) this.allocTargets();
  },

  render() {
    if (!this.ok) return;
    const dev = this.device;

    // --- camera basis, genuinely rotated by pitch (true 3-point perspective) ---
    const a = Player.angle, p = Player.pitch;
    const cp = Math.cos(p), sp = Math.sin(p);
    const fwd = [Math.cos(a) * cp, Math.sin(a) * cp, sp];
    const right = [-Math.sin(a), Math.cos(a), 0];
    // up = fwd x right  (the other order points down and flips the image)
    const up = [
      fwd[1] * right[2] - fwd[2] * right[1],
      fwd[2] * right[0] - fwd[0] * right[2],
      fwd[0] * right[1] - fwd[1] * right[0],
    ];
    const sx = Math.cos(CFG.SUN_AZ), sy = Math.sin(CFG.SUN_AZ), sz = Math.tan(CFG.SUN_EL);
    const il = 1 / Math.hypot(sx, sy, sz);
    const tanX = CFG.PLANE_LEN;
    const tanY = tanX * (this.rows / this.cols);

    const u = new Float32Array(48);
    u[0] = Player.x;  u[1] = Player.y;
    u[2] = this.cols; u[3] = this.rows;
    // eye rides on the terrain; Player.z is kept current by Player.update
    u[4] = fwd[0]; u[5] = fwd[1]; u[6] = fwd[2];
    u[7] = (Player.z || 0) + CFG.EYE;
    u[8] = right[0]; u[9] = right[1]; u[10] = right[2]; u[11] = CFG.MAX_DIST;
    u[12] = up[0]; u[13] = up[1]; u[14] = up[2];   u[15] = CFG.WORLD;
    u[16] = sx * il; u[17] = sy * il; u[18] = sz * il; u[19] = CFG.SHADOW;
    u[20] = tanX; u[21] = tanY; u[22] = Light.maxH || 32; u[23] = this.entCount;
    u[24] = CFG.SUN_ANGLE; u[25] = CFG.SUN_SAMPLES;
    u[26] = CFG.AO_SAMPLES; u[27] = CFG.AO_RADIUS;
    u[28] = CFG.TREE_REACH;
    u[29] = this.signCount;
    u[30] = (performance.now() / 1000) % 3600;
    u.set(CFG.SUN_COL, 32);      u[35] = CFG.SUN_I;
    u.set(CFG.AMB_COL, 36);      u[39] = CFG.AMB_I;
    u.set(CFG.SKY_HORIZON, 40);
    u.set(CFG.SKY_ZENITH, 44);
    dev.queue.writeBuffer(this.uniBuf, 0, u);
    dev.queue.writeBuffer(this.rparBuf, 0, new Float32Array([
      this.cols, this.rows, this.levels, CFG.MONO ? 1 : 0,
      CFG.RAW ? 1 : 0, CFG.TONE_BLACK, CFG.TONE_WHITE, CFG.TONE_GAMMA]));

    // --- entities: position, heading, per-instance dimensions, ground z ---
    let k = 0;
    for (const c of Entities.cars) {
      this.entData[k++] = c.x; this.entData[k++] = c.y;
      this.entData[k++] = Math.atan2(c.dy, c.dx); this.entData[k++] = 0; // car
      this.entData[k++] = 0.46; this.entData[k++] = 0.24;
      this.entData[k++] = World.groundZ(c.x, c.y);   // e1.z = ground
      this.entData[k++] = (c.col % 5) / 5;
    }
    for (const pd of Entities.peds) {
      const dx = pd.tx - pd.x, dy = pd.ty - pd.y;
      const ang = (dx * dx + dy * dy) > 1e-6 ? Math.atan2(dy, dx) : 0;
      this.entData[k++] = pd.x; this.entData[k++] = pd.y;
      this.entData[k++] = ang;  this.entData[k++] = 1; // pedestrian
      this.entData[k++] = World.groundZ(pd.x, pd.y);  // e1.x = ground
      this.entData[k++] = 0.0;
      this.entData[k++] = 1.55 + pd.shade * 0.25;
      this.entData[k++] = pd.shade;
    }
    dev.queue.writeBuffer(this.entBuf, 0, this.entData);

    const enc = dev.createCommandEncoder();
    const cpass = enc.beginComputePass();
    cpass.setPipeline(this.computePipe);
    cpass.setBindGroup(0, this.computeBind);
    cpass.dispatchWorkgroups(Math.ceil(this.cols / 8), Math.ceil(this.rows / 8));
    cpass.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    rp.setPipeline(this.renderPipe);
    rp.setBindGroup(0, this.renderBind);
    rp.draw(3);
    rp.end();
    dev.queue.submit([enc.finish()]);

    const probe = this.frameNo === undefined ? (this.frameNo = 0) : ++this.frameNo;
    if (probe < 3) {
      dev.pushErrorScope('validation');
      dev.popErrorScope().then(err => {
        if (err) console.error('[WebGPU] frame error: ' + err.message);
      });
    }
  },

  // Dumps the compute output so a black screen can be attributed to either
  // the raymarch (all zeros) or the glyph upscale (non-zero here).
  async debugReadback() {
    if (!this.ok) return 'GPU renderer inactive: ' + (this.reason || 'n/a');
    const bpr = Math.ceil(this.cols * 4 / 256) * 256;
    const buf = this.device.createBuffer({
      size: bpr * this.rows,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.lowTex },
      { buffer: buf, bytesPerRow: bpr }, [this.cols, this.rows]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const d = new Uint8Array(buf.getMappedRange());
    let nonZero = 0, maxV = 0, sum = 0;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const v = d[y * bpr + x * 4 + 3];
      if (v > 0) nonZero++;
      if (v > maxV) maxV = v;
      sum += v;
    }
    const total = this.cols * this.rows;
    buf.unmap(); buf.destroy();
    return { cols: this.cols, rows: this.rows, litCells: nonZero, total,
             maxLum: maxV, avgLum: +(sum / total).toFixed(1) };
  },
};
