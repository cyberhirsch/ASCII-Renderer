// Bootstrap + frame loop. WebGPU is the only renderer; without it there is
// nothing to fall back on, so say so plainly instead of showing black.
(async function () {
  World.generate(CFG.SEED);
  World.placeProps(CFG.SEED);
  Light.bake();
  Entities.init(CFG.SEED);
  Player.init();

  let ready = false;
  try { ready = await GPURenderer.init(); }
  catch (e) { GPURenderer.reason = e.message; }

  if (!ready) {
    document.getElementById('screen').hidden = true;
    const msg = document.createElement('div');
    msg.id = 'fail';
    msg.innerHTML = '<h1>WebGPU required</h1><p>' +
      (GPURenderer.reason || 'unknown error') + '</p>' +
      '<p>This renderer runs entirely on the GPU. Try a current Chrome, Edge, ' +
      'Firefox or Safari on a machine with a working GPU driver.</p>';
    document.body.appendChild(msg);
    console.error('[ASCII City] ' + GPURenderer.reason);
    return;
  }

  addEventListener('resize', () => GPURenderer.handleResize());

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  const fpsEl = document.getElementById('fps');

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    Player.update(dt);
    Entities.update(dt, now / 1000);
    GPURenderer.render();

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps · ' +
        GPURenderer.cols + '×' + GPURenderer.rows;
      fpsAcc = 0; fpsN = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
