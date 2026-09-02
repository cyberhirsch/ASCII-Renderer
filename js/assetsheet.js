// The asset sheet: every building, find and prop in one page, drawn by the
// same tracer the game will draw them with, with somewhere to say what is
// wrong with each one.
//
// It is a review instrument, not a gallery. The checkbox and the note are
// the point - a catalogue you cannot mark up is a screenshot - and both
// survive a reload, a seed change and a decay sweep, because the thing you
// noticed at decay 0.6 has to still be written down when you come back.

(function () {
  const REVIEW_KEY = 'assets:review';
  const CARD = { cols: 56, rows: 22, cellW: 7, cellH: 13 };
  const RAW_DETAIL = 2.4;      // samples per cell edge in the high-res view

  const $ = id => document.getElementById(id);
  const sheet = $('sheet');

  // ---- review notes ----
  // Keyed by asset id and nothing else, so a note written about the shape
  // of a longhouse is not lost when the decay slider moves.
  let review = {};
  try { review = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') || {}; }
  catch (e) { review = {}; }
  let saveT = 0;
  function saveReview() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(REVIEW_KEY, JSON.stringify(review)); }
      catch (e) { /* a full quota costs the notes, not the page */ }
    }, 250);
  }
  const noteOf = id => review[id] || (review[id] = { ok: false, note: '' });

  // ---- global state ----
  const S = {
    decay: 0, cause: 'left', mat: 'timber', az: 0.85, raw: false,
    fp: false, figure: true, section: false,
  };

  // ---- cards ----
  const cards = [];

  function optsFor(e) {
    return {
      decay: S.decay, cause: S.cause, mat: S.mat,
      figure: S.figure, view: S.fp && e.hold ? 'fp' : 'orbit',
      // the builder needs to know too: in section the overburden is drawn
      // as a soil profile, so it must not also be there as a mound
      section: S.section && e.kindOf === 'building',
      // an artifact's condition is its own axis: the chronicle decides it
      // from how long the thing has been in the ground, and the slider here
      // stands in for those centuries
      cond: e.kindOf === 'find' ? 1 - S.decay : 1,
    };
  }

  function draw(card) {
    const e = card.entry;
    const o = optsFor(e);
    const t0 = performance.now();
    const m = Assets.make(e.id, o);

    // A stain is looked at from above, standing over it, because that is the
    // only angle it exists from - edge on, a discolouration in the ground
    // is nothing at all.
    const view = {
      cols: CARD.cols, rows: CARD.rows, az: card.az === null ? S.az : card.az,
      el: m.gone ? Math.max(card.elev, 0.95)
        : S.section ? Math.min(card.elev, 0.22) : card.elev,
      view: m.held ? o.view : 'orbit', detail: RAW_DETAIL,
      section: S.section && e.kindOf === 'building' ? 1 : 0,
      sink: e.kindOf === 'building' ? sinkDepth(S.decay) : 0,
    };
    const f = S.raw ? AssetView.renderRaw(m.parts, view)
                    : AssetView.render(m.parts, view);
    if (S.raw) AssetView.paintRaw(card.cv, f, CARD);
    else AssetView.paint(card.cv, f, CARD);
    const ms = Math.round(performance.now() - t0);

    // the measurements, on the picture rather than under it
    card.dim.innerHTML = '<b>' + Assets.dims(m.bounds) + '</b>';
    const tall = (m.bounds.hi[2] - m.bounds.lo[2]);
    card.tr.innerHTML = e.kindOf === 'building'
      ? '<b>' + stageOf(S.decay) + '</b>'
      : e.kindOf === 'find'
        ? '<b>' + condWord(o.cond) + '</b>'
        : '<b>' + tall.toFixed(1) + ' m tall</b>';
    card.bl.textContent = m.parts.length + ' parts  ' + ms + ' ms';
    card.br.textContent = m.held ? 'in hand, from the eye'
      : m.gone ? 'nothing left to pick up'
      : (tall > 0.6 ? Math.max(1, Math.round(tall / FIGURE_H * 10) / 10) +
          'x a person' : '1 m grid');
    card.dirty = false;
  }

  // The chronicle's own five words for what is left of a thing, so the
  // sheet and the record describe a find the same way.
  function condWord(c) {
    for (const [t, w] of [[0.75, 'sound'], [0.45, 'worn'], [0.22, 'corroded'],
      [0.07, 'a fragment'], [0, 'a stain']]) if (c >= t) return w;
    return 'gone';
  }

  // Rendering is lazy and queued: sixty-odd assets at twenty milliseconds
  // apiece is a second and a half of frozen page if they all go at once,
  // and the high-res view is ten times that. Only what is on screen is
  // drawn, one card per frame, so the page stays live while it fills.
  const queue = [];
  let pumping = false;
  function want(card) {
    if (!card.visible || !card.dirty || queue.includes(card)) return;
    queue.push(card);
    if (!pumping) { pumping = true; requestAnimationFrame(pump); }
  }
  function pump() {
    const card = queue.shift();
    if (card && card.visible && card.dirty) {
      try { (card.draw ? card.draw() : draw(card)); }
      catch (err) { console.error(card.entry.id, err); }
    }
    if (queue.length) requestAnimationFrame(pump);
    else pumping = false;
  }

  // A hidden tab does not fire requestAnimationFrame, so the queue stops
  // where it was - which is the right thing to do with somebody else's CPU.
  // What it must not do is stay stopped: nothing re-fires the observer for a
  // card that was already on screen when the tab went away.
  addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    for (const c of cards) if (c.visible && c.dirty) want(c);
  });

  const io = new IntersectionObserver(list => {
    for (const en of list) {
      const card = cards[+en.target.dataset.i];
      card.visible = en.isIntersecting;
      if (en.isIntersecting) want(card);
    }
  }, { rootMargin: '400px 0px' });

  function invalidate(filter) {
    for (const c of cards) {
      if (filter && !filter(c.entry)) continue;
      c.dirty = true;
      want(c);
    }
  }

  // ---- the life of a building, on one line ----
  // The decay slider shows one moment. A ruin is a sequence, and the thing
  // the slider cannot show is that the ground comes up as the building comes
  // down - so the strip draws all five stages in section, with the soil
  // profile beside each, and the sinking becomes a band you can watch grow.
  const STAGE_AT = [0.02, 0.26, 0.50, 0.74, 0.96];
  const STRIP = { cols: 30, rows: 26, cellW: 7, cellH: 13 };

  function buildStrip(card) {
    const wrap = document.createElement('div');
    wrap.className = 'strip';
    // every panel is framed on the building as built, so the turf line sits
    // on the same row in all five and the sinking is a thing you can see
    // rather than a number you have to compare
    const frame = Assets.make(card.entry.id, {
      decay: 0, cause: S.cause, mat: S.mat, figure: false,
    }).bounds;
    for (const d of STAGE_AT) {
      const cell = document.createElement('div');
      cell.className = 'sc';
      const cv = document.createElement('canvas');
      cell.appendChild(cv);
      const cap = document.createElement('p');
      const sink = sinkDepth(d);
      cap.innerHTML = '<b>' + stageOf(d) + '</b>' +
        (sink > 0.02 ? '<span>' + sink.toFixed(2).replace('0.', '.') +
          ' m down</span>' : '<span>at grade</span>');
      cell.appendChild(cap);
      wrap.appendChild(cell);
      // drawn on the same queue as everything else, so opening a strip does
      // not stall the page behind five renders
      queue.push({
        visible: true, dirty: true, entry: card.entry,
        draw() {
          const m = Assets.make(card.entry.id, {
            decay: d, cause: S.cause, mat: S.mat, figure: false, section: true,
          });
          // aimed at the turf line and pulled in, because the strip is
          // about the ground coming up rather than about the elevation
          const f = AssetView.render(m.parts, {
            cols: STRIP.cols, rows: STRIP.rows, section: 1, sink,
            az: card.az === null ? S.az : card.az, el: 0.17,
            frame, zoom: 1.12, aimZ: frame.lo[2] + (frame.hi[2] - frame.lo[2]) * 0.30,
          });
          AssetView.paint(cv, f, STRIP);
          this.dirty = false;
        },
      });
    }
    if (!pumping) { pumping = true; requestAnimationFrame(pump); }
    return wrap;
  }

  // ---- building the page ----

  function makeCard(e, i) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.i = i;

    const view = document.createElement('div');
    view.className = 'view';
    const cv = document.createElement('canvas');
    view.appendChild(cv);
    const mk = (cls) => {
      const t = document.createElement('div');
      t.className = 'tag ' + cls; view.appendChild(t); return t;
    };
    const dim = mk('tl'), tr = mk('tr'), bl = mk('bl'), br = mk('br');
    el.appendChild(view);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<h3></h3><p class="why"></p>';
    meta.querySelector('h3').textContent = e.name;
    meta.querySelector('.why').textContent = e.why || '';
    el.appendChild(meta);

    // the two controls this page exists for
    const rev = document.createElement('div');
    rev.className = 'review';
    const n = noteOf(e.id);
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.className = 'chk';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!n.ok;
    lab.appendChild(chk);
    lab.appendChild(document.createTextNode('approved'));
    row.appendChild(lab);
    const mini = document.createElement('div');
    mini.className = 'mini';
    const life = document.createElement('button');
    life.textContent = 'life';
    mini.appendChild(life);
    const reset = document.createElement('button');
    reset.textContent = 'recentre';
    mini.appendChild(reset);
    row.appendChild(mini);
    rev.appendChild(row);
    const ta = document.createElement('textarea');
    ta.placeholder = 'what is wrong with it';
    ta.value = n.note || '';
    if (ta.value) ta.classList.add('has');
    rev.appendChild(ta);
    el.appendChild(rev);

    const card = {
      entry: e, node: el, cv, dim, tr, bl, br,
      az: null, elev: AssetView.DEF.el, dirty: true, visible: false,
    };

    chk.addEventListener('change', () => {
      n.ok = chk.checked;
      el.classList.toggle('ok', n.ok);
      saveReview(); tally();
    });
    ta.addEventListener('input', () => {
      n.note = ta.value;
      ta.classList.toggle('has', !!ta.value.trim());
      saveReview(); tally();
    });
    el.classList.toggle('ok', !!n.ok);

    // drag to turn this one asset without moving the rest
    let down = null;
    view.addEventListener('pointerdown', ev => {
      down = { x: ev.clientX, y: ev.clientY,
               az: card.az === null ? S.az : card.az, el: card.elev };
      view.setPointerCapture(ev.pointerId);
    });
    view.addEventListener('pointermove', ev => {
      if (!down) return;
      card.az = down.az - (ev.clientX - down.x) * 0.011;
      card.elev = clamp(down.el + (ev.clientY - down.y) * 0.007, -0.25, 1.35);
      card.dirty = true;
      want(card);
    });
    const up = ev => { if (down) { down = null; view.releasePointerCapture(ev.pointerId); } };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    reset.addEventListener('click', () => {
      card.az = null; card.elev = AssetView.DEF.el; card.dirty = true; want(card);
    });
    life.addEventListener('click', () => {
      const open = el.querySelector('.strip');
      if (open) { open.remove(); life.classList.remove('on'); return; }
      life.classList.add('on');
      el.insertBefore(buildStrip(card), meta);
    });
    if (e.kindOf !== 'building') life.remove();

    return card;
  }

  function build() {
    sheet.textContent = '';
    cards.length = 0;
    const all = Assets.all();
    for (const g of Assets.GROUPS) {
      const inG = all.filter(e => e.g === g.id);
      if (!inG.length) continue;
      const sec = document.createElement('section');
      const head = document.createElement('div');
      head.className = 'shead';
      const h = document.createElement('h2');
      h.textContent = g.name;
      const p = document.createElement('p');
      p.textContent = g.note;
      head.appendChild(h); head.appendChild(p);
      sec.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const e of inG) {
        const card = makeCard(e, cards.length);
        cards.push(card);
        grid.appendChild(card.node);
        io.observe(card.node);
      }
      sec.appendChild(grid);
      sheet.appendChild(sec);
    }
    tally();
  }

  function tally() {
    const all = Assets.all();
    const ok = all.filter(e => review[e.id] && review[e.id].ok).length;
    const notes = all.filter(e => review[e.id] && (review[e.id].note || '').trim()).length;
    $('count').innerHTML = '<b>' + ok + '</b> / ' + all.length + ' approved' +
      (notes ? '  ' + notes + ' noted' : '');
  }

  // ---- controls ----

  const causeSel = $('cause');
  for (const k of Object.keys(ASSET.CAUSES)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = ASSET.CAUSES[k].note;
    causeSel.appendChild(o);
  }
  causeSel.value = S.cause;

  $('decay').addEventListener('input', ev => {
    S.decay = ev.target.value / 100;
    $('stage').textContent = stageOf(S.decay);
    // props and inventory items do not decay, so they are not redrawn
    invalidate(e => e.kindOf === 'building' || e.kindOf === 'find');
  });
  causeSel.addEventListener('change', ev => {
    S.cause = ev.target.value; invalidate(e => e.kindOf === 'building');
  });
  $('mat').addEventListener('change', ev => {
    S.mat = ev.target.value; invalidate(e => e.kindOf === 'building');
  });
  $('az').addEventListener('input', ev => {
    S.az = ev.target.value / 100;
    for (const c of cards) if (c.az === null) { c.dirty = true; want(c); }
  });

  function setRaw(v) {
    S.raw = v;
    $('raw').classList.toggle('on', v);
    $('raw').innerHTML = (v ? 'raw' : 'ascii') + ' <kbd>x</kbd>';
    invalidate();
  }
  $('raw').addEventListener('click', () => setRaw(!S.raw));
  $('fp').addEventListener('click', () => {
    S.fp = !S.fp;
    $('fp').classList.toggle('on', S.fp);
    invalidate(e => !!e.hold);
  });
  $('sect').addEventListener('click', () => {
    S.section = !S.section;
    $('sect').classList.toggle('on', S.section);
    invalidate();
  });
  $('fig').addEventListener('click', () => {
    S.figure = !S.figure;
    $('fig').classList.toggle('on', S.figure);
    invalidate();
  });

  // X, the same key the game binds raw shading to, and for the same reason:
  // it is the picture before the ramp threw most of it away.
  addEventListener('keydown', ev => {
    if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT') return;
    if (ev.key === 'x' || ev.key === 'X') { setRaw(!S.raw); ev.preventDefault(); }
  });

  // The notes have to come back out or the review was for nothing. Markdown,
  // because that is what gets pasted into the thing that acts on it.
  $('copy').addEventListener('click', async () => {
    const all = Assets.all();
    const L = ['# Asset review — seed ' + CFG.SEED, ''];
    const bad = all.filter(e => {
      const n = review[e.id];
      return n && ((n.note || '').trim() || !n.ok);
    });
    const good = all.filter(e => review[e.id] && review[e.id].ok);
    L.push('Approved: ' + good.length + ' of ' + all.length + '.', '');
    for (const g of Assets.GROUPS) {
      const rows = bad.filter(e => e.g === g.id);
      if (!rows.length) continue;
      L.push('## ' + g.name, '');
      for (const e of rows) {
        const n = review[e.id];
        const note = (n.note || '').trim();
        L.push('- **' + e.name + '** (`' + e.id + '`)' +
          (n.ok ? ' — approved' : ' — not approved') + (note ? ': ' + note : ''));
      }
      L.push('');
    }
    if (good.length) {
      L.push('## Approved', '');
      L.push(good.map(e => '`' + e.id + '`').join(', '), '');
    }
    const text = L.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      $('copy').textContent = 'copied';
      setTimeout(() => { $('copy').textContent = 'copy notes'; }, 1200);
    } catch (err) {
      console.log(text);
      $('copy').textContent = 'in console';
      setTimeout(() => { $('copy').textContent = 'copy notes'; }, 1600);
    }
  });

  $('clear').addEventListener('click', () => {
    if (!confirm('Throw away every tick and every note?')) return;
    review = {};
    try { localStorage.removeItem(REVIEW_KEY); } catch (e) { /* nothing to do */ }
    build();
  });

  const seedBox = $('seed');
  seedBox.value = CFG.SEED;
  $('go').addEventListener('click', () => {
    const v = Number(seedBox.value);
    if (!Number.isInteger(v) || v < 0 || v >= (1 << 24)) return;
    // Every module caches something derived from the seed, and the hashes
    // that place a stone are among them - so the honest way to change world
    // is the way the game does it, by reloading into it.
    location.search = '?seed=' + v;
  });

  build();
})();
