// Bootstrap + frame loop. The world is procedural in the shader; nothing to
// generate up front beyond finding a spawn point.
(async function () {
  // a macrotask yield so a boot-stage line paints before a synchronous block
  const breathe = () => new Promise(r => setTimeout(r, 0));

  Entities.init();
  Edits.init();       // load persisted digs before the first frame
  Fells.init();       // load persisted felled trees
  Game.init();        // load persisted inventory
  Boot.set('finding a door');
  await breathe();
  Player.init();      // spawn scan: the heavy synchronous bit
  Boot.set('waking the gpu');
  await breathe();

  let ready = false;
  try { ready = await GPURenderer.init(); }
  catch (e) { GPURenderer.reason = e.message; }

  if (!ready) {
    Boot.fail();
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
  // ASCII only: the text atlas covers 32..126, and anything outside it
  // clears to a gap rather than drawing
  const HUD_LINE = 'wasd move - Tab inventory - C craft - E examine - Enter console - LMB dig - RMB fill - F fullscreen';

  addEventListener('beforeunload', () => {
    if (Edits.needSave) Edits.save();
    if (Game.needSave) Game.save();
  });

  let booted = false;

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
    if (!booted) { booted = true; Boot.done(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
