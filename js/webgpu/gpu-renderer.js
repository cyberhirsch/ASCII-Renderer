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

    // entity buffer: vec4(x, y, halfWidth, height)
    this.entCount = Entities.cars.length + Entities.peds.length;
    this.entData = new Float32Array(Math.max(this.entCount, 1) * 4);
    this.entBuf = device.createBuffer({
      size: this.entData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.buildAtlas(CFG.GLYPH_SET);

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniBuf = device.createBuffer({
      size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    const atlas = GlyphAtlas.build(setName);
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
    // AO is traced per pixel now, so cells only carry type and height
    const packed = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      packed[i] = (World.type[i] & 0xff) |
                  ((Math.min(World.height[i], 255) & 0xff) << 8);
    }
    this.cellBuf = this.device.createBuffer({
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.cellBuf, 0, packed);
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

  resize() {
    const canvas = document.getElementById('screen');
    const dpr = 1; // glyph cells are the pixels that matter here
    canvas.width = Math.max(320, Math.floor(innerWidth * dpr));
    canvas.height = Math.max(240, Math.floor(innerHeight * dpr));
    this.cols = Math.max(40, Math.floor(canvas.width / this.cellPx));
    this.rows = Math.max(24, Math.floor(canvas.height / this.cellPx));
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
    const oc = this.cols, or = this.rows;
    this.resize();
    if (this.ok && (this.cols !== oc || this.rows !== or)) this.allocTargets();
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

    const u = new Float32Array(28);
    u[0] = Player.x;  u[1] = Player.y;
    u[2] = this.cols; u[3] = this.rows;
    u[4] = fwd[0]; u[5] = fwd[1]; u[6] = fwd[2];   u[7] = CFG.EYE;
    u[8] = right[0]; u[9] = right[1]; u[10] = right[2]; u[11] = CFG.MAX_DIST;
    u[12] = up[0]; u[13] = up[1]; u[14] = up[2];   u[15] = CFG.WORLD;
    u[16] = sx * il; u[17] = sy * il; u[18] = sz * il; u[19] = CFG.SHADOW;
    u[20] = tanX; u[21] = tanY; u[22] = Light.maxH || 32; u[23] = this.entCount;
    u[24] = CFG.SUN_ANGLE; u[25] = CFG.SUN_SAMPLES;
    u[26] = CFG.AO_SAMPLES; u[27] = CFG.AO_RADIUS;
    dev.queue.writeBuffer(this.uniBuf, 0, u);
    dev.queue.writeBuffer(this.rparBuf, 0, new Float32Array([
      this.cols, this.rows, this.levels, CFG.MONO ? 1 : 0,
      CFG.RAW ? 1 : 0, CFG.TONE_BLACK, CFG.TONE_WHITE, CFG.TONE_GAMMA]));

    // --- entities ---
    let k = 0;
    for (const c of Entities.cars) {
      this.entData[k++] = c.x; this.entData[k++] = c.y;
      this.entData[k++] = 0.42; this.entData[k++] = 0.85;
    }
    for (const pd of Entities.peds) {
      this.entData[k++] = pd.x; this.entData[k++] = pd.y;
      this.entData[k++] = 0.16; this.entData[k++] = 1.7;
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
