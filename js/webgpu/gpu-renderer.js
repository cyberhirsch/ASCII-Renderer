// WebGPU renderer: per-pixel 3D raymarch in a compute shader, then a
// glyph-mapped upscale. This is the only renderer.
const GPURenderer = {
  ok: false, device: null, ctx: null,
  cols: 0, rows: 0,
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
      // a lost device otherwise looks like a freeze on the last frame —
      // say so on screen, because it usually means a shader ran over budget
      const d = document.createElement('div');
      d.id = 'fail';
      d.innerHTML = '<h1>GPU device lost</h1><p>' + (info.message || '') +
        '</p><p>The render exceeded the driver watchdog (or the GPU reset). ' +
        'Reload to restart; if it recurs, lower SUN_SAMPLES / AO_SAMPLES in js/config.js.</p>';
      document.body.appendChild(d);
    });

    this.resize();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    // The world is procedural in the shader — nothing to upload. Entities:
    // capacity-sized buffer, two vec4 each, live count sent per frame.
    this.entData = new Float32Array(CFG.MAX_ENTS * 8);
    this.entBuf = device.createBuffer({
      size: this.entData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // player edits: resident chunk headers + voxel bricks (see js/edits.js)
    const chunkBytes = CAVES.EDIT_CHUNK ** 3;
    this.editHeadBuf = device.createBuffer({
      size: CFG.EDIT_MAX * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.editDataBuf = device.createBuffer({
      size: CFG.EDIT_MAX * chunkBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.editCount = 0;
    this.editBounds = null;

    // felled trees: small list of removed cells (see js/fells.js)
    this.fellBuf = device.createBuffer({
      size: CFG.FELL_MAX * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.fellCount = 0;

    this.buildAtlas(CFG.GLYPH_SET);

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniBuf = device.createBuffer({
      size: 240, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    const atlas = GlyphAtlas.build(setName, this.cellW, this.cellH);
    this.atlasCell = atlas.cell;
    const text = TextAtlas.build(this.cellW, this.cellH);
    if (this.textTex) this.textTex.destroy();
    this.textTex = this.device.createTexture({
      size: [text.canvas.width, text.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
             GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: text.canvas }, { texture: this.textTex },
      [text.canvas.width, text.canvas.height]);
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
    this.cellW = Math.max(4, Math.round(CFG.CELL_W * dpr));
    this.cellH = Math.max(6, Math.round(CFG.CELL_H * dpr));

    this.cols = Math.max(40, Math.floor((innerWidth * dpr) / this.cellW));
    this.rows = Math.max(20, Math.floor((innerHeight * dpr) / this.cellH));

    // exact whole number of cells, then displayed at exactly that many
    // device pixels so nothing is rescaled
    canvas.width = this.cols * this.cellW;
    canvas.height = this.rows * this.cellH;
    canvas.style.width = (canvas.width / dpr) + 'px';
    canvas.style.height = (canvas.height / dpr) + 'px';
  },

  allocTargets() {
    if (this.lowTex) this.lowTex.destroy();
    if (this.overlayBuf) this.overlayBuf.destroy();
    this.overlayBuf = this.device.createBuffer({
      size: this.cols * this.rows * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    Overlay.resize(this.cols, this.rows);
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
        { binding: 1, resource: this.lowTex.createView() },
        { binding: 2, resource: { buffer: this.entBuf } },
        { binding: 3, resource: { buffer: this.editHeadBuf } },
        { binding: 4, resource: { buffer: this.editDataBuf } },
        { binding: 5, resource: { buffer: this.fellBuf } },
      ],
    });
    this.renderBind = this.device.createBindGroup({
      layout: this.renderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.lowTex.createView() },
        { binding: 1, resource: this.atlasTex.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.rparBuf } },
        { binding: 4, resource: this.textTex.createView() },
        { binding: 5, resource: { buffer: this.overlayBuf } },
      ],
    });
  },

  handleResize() {
    const oc = this.cols, or = this.rows;
    const ow = this.cellW, oh = this.cellH;
    this.resize();
    if (!this.ok) return;
    // a changed cell size means the atlas is no longer 1:1 with the display
    if (this.cellW !== ow || this.cellH !== oh) { this.buildAtlas(CFG.GLYPH_SET); return; }
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
    const tanY = tanX * (this.rows * this.cellH) / (this.cols * this.cellW);

    // --- player edits: re-pack the resident chunk set when it changed ---
    if (Edits.gpuDirty) {
      const res = Edits.pack(Player.x, Player.y, Player.z);
      dev.queue.writeBuffer(this.editHeadBuf, 0, Edits.head);
      dev.queue.writeBuffer(this.editDataBuf, 0, Edits.data);
      this.editCount = res.count;
      this.editBounds = res.bounds;
      Edits.gpuDirty = false;
    }

    if (Fells.gpuDirty) {
      this.fellCount = Fells.pack(Player.x, Player.y);
      dev.queue.writeBuffer(this.fellBuf, 0, Fells.data);
      Fells.gpuDirty = false;
    }

    const u = new Float32Array(60);
    u[0] = Player.x;  u[1] = Player.y;
    u[2] = this.cols; u[3] = this.rows;
    // eye rides on the terrain; Player.z is kept current by Player.update
    u[4] = fwd[0]; u[5] = fwd[1]; u[6] = fwd[2];
    u[7] = (Player.z || 0) + CFG.EYE;
    u[8] = right[0]; u[9] = right[1]; u[10] = right[2]; u[11] = CFG.MAX_DIST;
    u[12] = up[0]; u[13] = up[1]; u[14] = up[2];   u[15] = CFG.SEED;
    u[16] = sx * il; u[17] = sy * il; u[18] = sz * il; u[19] = CFG.SHADOW;
    u[20] = tanX; u[21] = tanY; u[22] = CFG.TERRAIN_MAX;
    u[23] = Math.min(Entities.list.length, CFG.MAX_ENTS);
    u[24] = CFG.SUN_ANGLE; u[25] = CFG.SUN_SAMPLES;
    u[26] = CFG.AO_SAMPLES; u[27] = CFG.AO_RADIUS;
    u[28] = CFG.TREE_REACH;
    u[29] = CFG.SEA_LEVEL;
    u[30] = (performance.now() / 1000) % 3600;
    u[31] = CFG.SHADE_NEAR;
    u[43] = CFG.SHADE_FAR;
    u.set(CFG.SUN_COL, 32);      u[35] = CFG.SUN_I;
    u.set(CFG.AMB_COL, 36);      u[39] = CFG.AMB_I;
    u.set(CFG.SKY_HORIZON, 40);
    u.set(CFG.SKY_ZENITH, 44);
    if (this.editCount > 0 && this.editBounds) {
      u[48] = this.editBounds[0]; u[49] = this.editBounds[1];
      u[50] = this.editBounds[2]; u[51] = this.editCount;
      u[52] = this.editBounds[3]; u[53] = this.editBounds[4];
      u[54] = this.editBounds[5];
    }
    // a carried torch brightens the headlamp
    u[56] = CFG.LAMP * (Game.count('torch') > 0 ? 2.2 : 1);
    u[57] = this.fellCount;
    dev.queue.writeBuffer(this.uniBuf, 0, u);
    dev.queue.writeBuffer(this.rparBuf, 0, new Float32Array([
      this.cols, this.rows, this.levels, CFG.MONO ? 1 : 0,
      CFG.RAW ? 1 : 0, CFG.TONE_BLACK, CFG.TONE_WHITE, CFG.TONE_GAMMA]));

    // --- entities: (x, y, heading, kind) + kind extras, e1[0] = ground z ---
    let k = 0;
    const live = Math.min(Entities.list.length, CFG.MAX_ENTS);
    for (let i = 0; i < live; i++) {
      const e = Entities.list[i];
      this.entData[k++] = e.x; this.entData[k++] = e.y;
      this.entData[k++] = e.heading || 0; this.entData[k++] = e.kind || 0;
      this.entData[k++] = World.groundZ(e.x, e.y);
      this.entData[k++] = e.e1 ? e.e1[1] : 0;
      this.entData[k++] = e.e1 ? e.e1[2] : 0;
      this.entData[k++] = e.e1 ? e.e1[3] : 0;
    }
    if (live > 0) dev.queue.writeBuffer(this.entBuf, 0, this.entData);

    if (Overlay.dirty && Overlay.data &&
        Overlay.data.byteLength === this.cols * this.rows * 4) {
      dev.queue.writeBuffer(this.overlayBuf, 0, Overlay.data);
      Overlay.dirty = false;
    }

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
