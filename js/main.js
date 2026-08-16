// Bootstrap + frame loop.
//
// Two backends share the world/sim: the CPU character renderer (default,
// works everywhere) and an optional WebGPU backend that raymarches in a
// compute shader and glyph-maps the low-res result on the GPU. Each owns its
// own canvas — a canvas can only hold one context type — so G swaps between
// them instantly, with no reload.
(async function () {
  World.generate(CFG.SEED);
  Light.bake();
  Entities.init(CFG.SEED);
  Player.init();
  Renderer.init();

  const hud = document.getElementById('hud');
  const cpuCanvas = document.getElementById('screen');
  const gpuCanvas = document.getElementById('gpuscreen');
  const baseHud = hud.textContent;
  let useGPU = false, gpuReady = false;

  try { gpuReady = await GPURenderer.init(); }
  catch (e) { GPURenderer.reason = e.message; gpuReady = false; }

  function setBackend(gpu) {
    useGPU = gpu && gpuReady;
    cpuCanvas.hidden = useGPU;
    gpuCanvas.hidden = !useGPU;
    hud.textContent = baseHud + (gpuReady ? ' · G: ' + (useGPU ? 'GPU' : 'CPU') : '');
  }

  if (gpuReady) {
    addEventListener('resize', () => GPURenderer.handleResize());
    setBackend(true);
  } else {
    console.info('WebGPU unavailable (' + (GPURenderer.reason || 'unknown') +
      '); using CPU renderer.');
    setBackend(false);
  }

  addEventListener('keydown', e => {
    if (e.code === 'KeyG' && gpuReady) setBackend(!useGPU);
  });

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  const fpsEl = document.getElementById('fps');

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = now / 1000;

    Player.update(dt);
    Entities.update(dt, time);
    if (useGPU) GPURenderer.render(); else Renderer.render(time);

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + (useGPU ? 'GPU' : 'CPU');
      fpsAcc = 0; fpsN = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
