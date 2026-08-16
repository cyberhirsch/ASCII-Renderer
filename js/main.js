// Bootstrap + frame loop.
//
// Two backends share the world/sim: the CPU character renderer (default,
// works everywhere) and an optional WebGPU backend that raymarches in a
// compute shader and glyph-maps the low-res result on the GPU.
// A canvas can only hold one context type, so the choice is made up front:
// #cpu in the URL forces the CPU path, otherwise WebGPU is used when present.
(async function () {
  World.generate(CFG.SEED);
  Light.bake();
  Entities.init(CFG.SEED);
  Player.init();

  const hud = document.getElementById('hud');
  const forceCPU = location.hash.indexOf('cpu') !== -1;
  let useGPU = false;

  if (!forceCPU) {
    try { useGPU = await GPURenderer.init(); }
    catch (e) { GPURenderer.reason = e.message; useGPU = false; }
  }

  if (useGPU) {
    addEventListener('resize', () => GPURenderer.handleResize());
    hud.textContent = 'WASD move · mouse look · shift run · G: switch to CPU renderer';
  } else {
    Renderer.init();
    if (!forceCPU) {
      console.info('WebGPU unavailable (' + (GPURenderer.reason || 'unknown') +
        '); using CPU renderer.');
    }
  }

  addEventListener('keydown', e => {
    if (e.code !== 'KeyG') return;
    location.hash = useGPU ? 'cpu' : '';
    location.reload();
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
      fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps' + (useGPU ? ' · GPU' : '');
      fpsAcc = 0; fpsN = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
