// WebGPU backend: compute-shader raymarch into a low-res target, then a
// glyph-mapping upscale pass. Falls back to the CPU renderer if unavailable.
const GPURenderer = {
  ok: false, device: null, ctx: null,
  cols: 0, rows: 0, cellPx: 12,
  reason: '',

  async init() {
    const canvas = document.getElementById('gpuscreen');
    if (!navigator.gpu) { this.reason = 'navigator.gpu missing'; return false; }
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) { this.reason = 'no GPU adapter'; return false; }
      device = await adapter.requestDevice();
    } catch (e) { this.reason = 'device request failed: ' + e.message; return false; }

    this.device = device;
    this.ctx = canvas.getContext('webgpu');
    if (!this.ctx) { this.reason = 'webgpu context unavailable'; return false; }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    device.lost.then(info => {
      this.ok = false;
      console.warn('WebGPU device lost:', info.message);
    });

    this.resize();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    // ---- world data as a storage buffer: type | height<<8 ----
    const N = CFG.WORLD * CFG.WORLD;
    const packed = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      packed[i] = (World.type[i] & 0xff) | ((Math.min(World.height[i], 255) & 0xff) << 8);
    }
    this.cellBuf = device.createBuffer({
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.cellBuf, 0, packed);

    // ---- glyph atlas texture ----
    const atlas = GlyphAtlas.build();
    this.levels = atlas.levels;
    this.atlasTex = device.createTexture({
      size: [atlas.canvas.width, atlas.canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
             GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: atlas.canvas }, { texture: this.atlasTex },
      [atlas.canvas.width, atlas.canvas.height]);

    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // ---- uniforms ----
    this.uniBuf = device.createBuffer({
      size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.rparBuf = device.createBuffer({
      size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ---- pipelines (with compile diagnostics: a silent shader failure
    // otherwise shows up as an unexplained black screen) ----
    device.pushErrorScope('validation');

    const cmod = device.createShaderModule({ code: WGSL_COMPUTE });
    const rmod = device.createShaderModule({ code: WGSL_RENDER });
    if (!await this.checkShader(cmod, 'compute')) return false;
    if (!await this.checkShader(rmod, 'render')) return false;

    this.computePipe = device.createComputePipeline({
      layout: 'auto', compute: { module: cmod, entryPoint: 'main' },
    });
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
      this.reason = `${label} shader failed to compile (${errors.length} error(s); see console)`;
      return false;
    }
    return true;
  },

  resize() {
    const canvas = document.getElementById('gpuscreen');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    this.cols = Math.max(40, Math.floor(innerWidth / this.cellPx));
    this.rows = Math.max(24, Math.floor(innerHeight / this.cellPx));
  },

  allocTargets() {
    if (this.lowTex) this.lowTex.destroy();
    this.lowTex = this.device.createTexture({
      size: [this.cols, this.rows],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.computeBind = this.device.createBindGroup({
      layout: this.computePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniBuf } },
        { binding: 1, resource: { buffer: this.cellBuf } },
        { binding: 2, resource: this.lowTex.createView() },
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
    this.device.queue.writeBuffer(this.rparBuf, 0,
      new Float32Array([this.cols, this.rows, this.levels, 0]));
  },

  handleResize() {
    const oldC = this.cols, oldR = this.rows;
    this.resize();
    if (this.cols !== oldC || this.rows !== oldR) this.allocTargets();
  },

  render() {
    if (!this.ok) return;
    // check the first few frames for draw-time validation errors, which
    // would otherwise present as a silent black screen
    const probe = this.frameNo === undefined ? (this.frameNo = 0) : ++this.frameNo;
    if (probe < 3) this.device.pushErrorScope('validation');
    const dirX = Math.cos(Player.angle), dirY = Math.sin(Player.angle);
    const planeX = -dirY * CFG.PLANE_LEN, planeY = dirX * CFG.PLANE_LEN;
    const el = CFG.SUN_EL, az = CFG.SUN_AZ;
    const sx = Math.cos(az), sy = Math.sin(az), sz = Math.tan(el);
    const il = 1 / Math.hypot(sx, sy, sz);

    // std140-ish layout matching the WGSL Uniforms struct
    const u = new Float32Array(24);
    u[0] = Player.x; u[1] = Player.y;         // camPos
    u[2] = dirX; u[3] = dirY;                 // camDir
    u[4] = planeX; u[5] = planeY;             // camPlane
    u[6] = CFG.WORLD; u[7] = CFG.MAX_DIST;
    u[8] = sx * il; u[9] = sy * il; u[10] = sz * il; // sunDir (vec3, 16B aligned)
    u[11] = CFG.SHADOW;
    u[12] = CFG.EYE; u[13] = CFG.Y_SCALE;
    u[14] = Player.pitch * (this.rows / Math.max(CFG.ROWS, 1));
    u[15] = Light.maxH || 32;
    u[16] = this.cols; u[17] = this.rows;
    this.device.queue.writeBuffer(this.uniBuf, 0, u);

    const enc = this.device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(this.computePipe);
    cp.setBindGroup(0, this.computeBind);
    cp.dispatchWorkgroups(Math.ceil(this.cols / 8), Math.ceil(this.rows / 8));
    cp.end();

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
    this.device.queue.submit([enc.finish()]);

    if (probe < 3) {
      this.device.popErrorScope().then(err => {
        if (err) console.error('[WebGPU] frame ' + probe + ' error: ' + err.message);
      });
    }
  },

  // Dumps the low-res compute output so a black screen can be traced to
  // either the raymarch (all zeros) or the glyph-upscale pass (non-zero here).
  async debugReadback() {
    if (!this.ok) return 'GPU renderer not active: ' + (this.reason || 'n/a');
    const bpr = Math.ceil(this.cols * 4 / 256) * 256;
    const buf = this.device.createBuffer({
      size: bpr * this.rows,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.lowTex },
      { buffer: buf, bytesPerRow: bpr },
      [this.cols, this.rows]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const d = new Uint8Array(buf.getMappedRange());
    let nonZero = 0, maxV = 0, sum = 0;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
      const v = d[y * bpr + x * 4 + 3]; // alpha = luminance
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
