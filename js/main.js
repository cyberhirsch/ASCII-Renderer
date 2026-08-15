// Bootstrap + frame loop.
(function () {
  World.generate(CFG.SEED);
  Entities.init(CFG.SEED);
  Player.init();
  Renderer.init();

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsShown = 0;
  const fpsEl = document.getElementById('fps');

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const time = now / 1000;

    Player.update(dt);
    Entities.update(dt, time);
    Renderer.render(time);

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      fpsShown = Math.round(fpsN / fpsAcc);
      fpsAcc = 0; fpsN = 0;
      fpsEl.textContent = fpsShown + ' fps';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
