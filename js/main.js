// Bootstrap + frame loop. The world is procedural in the shader; nothing to
// generate up front beyond finding a spawn point.
(async function () {
  Entities.init();
  Edits.init();       // load persisted digs before the first frame
  Fells.init();       // load persisted felled trees
  Game.init();        // load persisted inventory
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
    console.error('[ASCII World] ' + GPURenderer.reason);
    return;
  }

  addEventListener('resize', () => GPURenderer.handleResize());

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsLine = '';
  const HUD_LINE = 'wasd move · Tab inventory · E examine · LMB dig · RMB fill · G cave hop · F fullscreen';

  addEventListener('beforeunload', () => {
    if (Edits.needSave) Edits.save();
    if (Game.needSave) Game.save();
  });

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    Player.update(dt);
    Entities.update(dt, now / 1000);
    Edits.tick(dt);
    Game.tick(dt);

    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      const ms = (fpsAcc / fpsN) * 1000;
      fpsLine = Math.round(fpsN / fpsAcc) + ' fps ' +
        ms.toFixed(1) + ' ms ' + GPURenderer.cols + 'x' + GPURenderer.rows +
        ' ' + Player.x.toFixed(0) + ',' + Player.y.toFixed(0) + ' ';
      fpsAcc = 0; fpsN = 0;
      Game.uiDirty = true;
    }
    if (Game.uiDirty) {
      Overlay.clear();
      Overlay.writeRight(0, fpsLine);
      Overlay.write(1, Overlay.rows - 1, HUD_LINE);
      Game.drawUI();
      Game.uiDirty = false;
    }
    GPURenderer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
