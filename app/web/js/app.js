/* HomeView for iPad Air 2.
 *
 * Two layers driven by one frame loop:
 *   - #gl: WebGL wallpaper + liquid glass (glass.js), rendered at 1.25x;
 *   - #ui: DOM content (text, icons, SVG) at native resolution, composited by WebKit on the GPU.
 * Every glass tile is a DOM element plus a rect in the glass list; both are
 * moved in the same frame (page offset, press scale) so they never drift.
 * Nothing renders while nothing moves, except the wallpaper at a low rate.
 *
 * Layouts follow homeview-g4 (MIT): 4 x 3 Home grid, weather icons.
 * Glass, springs and face ideas come from FrontRow's HomeView.
 */
(function () {
  'use strict';

  const CFG = window.HV_CONFIG || {};
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (n, cls) => (window.sf ? window.sf(n, cls) : (SF[n] ? '<svg viewBox="' + SF[n].vb + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + SF[n].g + '</svg>' : ''));

  function native(msg) { try { window.webkit.messageHandlers.native.postMessage(msg); return true; } catch (e) { return false; } }
  function log(body) { if (!native({ cmd: 'log', body: Object.assign({ at: new Date().toISOString() }, body) })) console.log('[hv]', JSON.stringify(body)); }
  window.addEventListener('error', (e) => log({ event: 'js_error', message: e.message, src: (e.filename || '').split('/').pop(), line: e.lineno }));

  // ---- springs ---------------------------------------------------------------------------
  // Mass 1; `k` stiffness, `zeta` damping ratio (1 = critically damped, no overshoot).
  // `eps`: how close counts as settled, in the spring's own units (px for the pager, 0..1 for scale/tint).
  function Spring(value, k, zeta, eps) {
    this.value = value; this.target = value; this.v = 0;
    this.k = k || 200; this.c = 2 * Math.sqrt(this.k) * (zeta == null ? 1 : zeta);
    this.eps = eps || 0.05;
  }
  Spring.prototype.to = function (t, v) { this.target = t; if (v != null) this.v = v; loop.kick(); };
  Spring.prototype.set = function (t) { this.value = this.target = t; this.v = 0; };
  Spring.prototype.step = function (dt) {
    const steps = Math.ceil(dt / 0.008);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.value - this.target) - this.c * this.v;
      this.v += a * h;
      this.value += this.v * h;
    }
    if (Math.abs(this.value - this.target) < this.eps && Math.abs(this.v) < this.eps * 10) { this.value = this.target; this.v = 0; return false; }
    return true;
  };
  const springs = new Set();
  function track(s) { springs.add(s); return s; }

  // ---- layout ------------------------------------------------------------------------------
  const L = {};
  // Landscape: a 4 x 3 grid; portrait: 3 x 4 (the same tile size on a 4:3 screen).
  function layout() {
    L.W = window.innerWidth || 1024;
    L.H = window.innerHeight || 768;
    L.portrait = L.H > L.W;
    const short = Math.min(L.W, L.H);
    L.m = Math.round(short * 0.021);         // 16 at 768
    L.g = Math.round(short * 0.0156);        // 12
    L.cols = L.portrait ? 3 : 4;
    L.rows = L.portrait ? 4 : 3;
    L.u = Math.floor(Math.min((L.W - 2 * L.m - (L.cols - 1) * L.g) / L.cols, (L.H - 2 * L.m - (L.rows - 1) * L.g) / L.rows));
    L.mx = Math.round((L.W - (L.cols * L.u + (L.cols - 1) * L.g)) / 2);
    L.my = Math.round((L.H - (L.rows * L.u + (L.rows - 1) * L.g)) / 2);
    L.r = Math.round(L.u * 0.2);             // corner radius (Apple ~ 1/6 .. 1/5 of the tile)
    // faces and apps are laid out on a 1024 x 768 (or 768 x 1024) reference
    L.RW = L.portrait ? 768 : 1024;
    L.RH = L.portrait ? 1024 : 768;
    L.k = Math.min(L.W / L.RW, L.H / L.RH);
    document.documentElement.style.setProperty('--u', L.u + 'px');
    document.body.classList.toggle('portrait', L.portrait);
  }
  function cell(c, r, w, h) {
    w = w || 1; h = h || 1;
    return { x: L.mx + c * (L.u + L.g), y: L.my + r * (L.u + L.g), w: w * L.u + (w - 1) * L.g, h: h * L.u + (h - 1) * L.g };
  }

  // ---- tiles: a DOM element and its glass rect ----------------------------------------------
  function Tile(page, rect, cls, opts) {
    opts = opts || {};
    this.page = page;
    this.rect = rect;
    this.r = opts.r == null ? L.r : opts.r;
    this.glass = opts.glass !== false;
    this.fill = [1, 1, 1];
    this.tintAmount = 0;
    this.tintSpring = track(new Spring(0, 260, 1, 0.002));
    this.press = track(new Spring(1, 700, 0.62, 0.0004));
    this.onTap = opts.onTap || null;
    const el = document.createElement('div');
    el.className = 'tile ' + (cls || '');
    el.style.left = rect.x + 'px';
    el.style.top = rect.y + 'px';
    el.style.width = rect.w + 'px';
    el.style.height = rect.h + 'px';
    el.style.borderRadius = this.r + 'px';
    el._tile = this;
    this.el = el;
    page.el.appendChild(el);
    page.tiles.push(this);
  }
  Tile.prototype.html = function (h) { if (this._html !== h) { this._html = h; this.el.innerHTML = h; } };
  Tile.prototype.setOn = function (on, fill) {
    this.el.classList.toggle('on', !!on);
    if (fill) this.fill = fill;
    this.tintSpring.to(on ? 0.82 : 0);
  };

  function Page(name, parent) {
    this.name = name;
    this.tiles = [];
    this.texts = [];                         // glass numerals: {rect, mask, fill, tintAmount}
    this.scale = track(new Spring(1, 300, 0.85, 0.0005));
    this.ty = track(new Spring(0, 300, 0.85, 0.05));
    this.el = document.createElement('div');
    this.el.className = 'page page-' + name;
    (parent || $('#pages')).appendChild(this.el);
  }

  // ---- frame loop --------------------------------------------------------------------------
  // rAF drives springs and the idle wallpaper; during a drag the touch handler renders directly
  // (loop.now) so a frame follows the finger without waiting for the next vsync. While anything
  // moves the wallpaper is frozen and its blurred copy reused: only the glass is redrawn.
  const WALL_IDLE_MS = 1000 / 30;   // wallpaper drift while nothing else moves
  const loop = {
    scheduled: false, last: 0, lastRender: 0, lastRenderWall: 0, lastTick: 0, dirty: true, moving: false,
    kick() { this.dirty = true; this.schedule(); },
    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      requestAnimationFrame((t) => { this.scheduled = false; this.tick(t, false); });
    },
    now() { this.dirty = true; this.tick(performance.now(), true); },
    tick(now, direct) {
      const dt = Math.min(0.05, this.last ? Math.max(0, (now - this.last) / 1000) : 0.016);
      this.last = now;
      let moving = drag.active;
      for (const s of springs) if (s.value !== s.target || s.v !== 0) { if (s.step(dt)) moving = true; }
      const wasMoving = this.moving;
      this.moving = moving;
      if (glass) glass.freeze(moving, now);
      const tiles = applyTransforms();
      // During a drag touch events render first (lowest latency); the vsync tick fills in any
      // display frame that got no touch event, using the latest finger position.
      const skip = drag.active && !direct && performance.now() - this.lastRenderWall < 12;
      if (glass && !skip && (moving || this.dirty || now - this.lastRender >= WALL_IDLE_MS - 2)) {
        const t0 = performance.now();
        glass.render(now, tiles);
        const t1 = performance.now();
        perf.frame(t1, t1 - t0, moving, glass.lastPasses);
        this.lastRender = now;
        this.lastRenderWall = t1;
        this.dirty = false;
        stats.frames++;
      }
      if (wasMoving && !moving) perf.flush();
      if (moving || (glass && glass.wall.animated)) this.schedule(); else this.last = 0;
    },
  };
  const stats = { frames: 0 };

  // Interaction timing, logged after each drag or animation: frame gaps and CPU time per render.
  const perf = {
    gaps: [], cpu: [], lastAt: 0, passes: {},
    frame(now, cpuMs, moving, passes) {
      if (!moving) { this.lastAt = 0; return; }
      if (this.lastAt) this.gaps.push(now - this.lastAt);
      this.lastAt = now;
      this.cpu.push(cpuMs);
      this.passes[passes] = (this.passes[passes] || 0) + 1;
    },
    flush() {
      if (this.gaps.length >= 5) {
        const g = this.gaps.slice().sort((a, b) => a - b), c = this.cpu.slice().sort((a, b) => a - b);
        const pct = (a, p) => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1);
        log({ event: 'perf', kind: this.kind || 'anim', frames: g.length + 1, gapP50: pct(g, 0.5), gapP95: pct(g, 0.95), gapMax: pct(g, 1),
          over20: g.filter((x) => x > 20).length, cpuP50: pct(c, 0.5), cpuP95: pct(c, 0.95), passes: this.passes });
      }
      this.gaps = []; this.cpu = []; this.lastAt = 0; this.passes = {}; this.kind = null;
    },
  };

  // ---- pixel shift: content walks a 4 x 4 px square, one step every 90 s (LCD image retention) ----
  // The wallpaper stays put (it moves or changes by itself); text, glass and hands shift together.
  const SHIFT_PATH = (() => {
    const p = [];
    for (let x = -2; x < 2; x++) p.push([x, -2]);
    for (let y = -2; y < 2; y++) p.push([2, y]);
    for (let x = 2; x > -2; x--) p.push([x, 2]);
    for (let y = 2; y > -2; y--) p.push([-2, y]);
    return p;                                      // 16 points around the square
  })();
  const shift = { x: 0, y: 0, i: 0 };
  function stepShift() {
    if (CFG.pixel_shift === false) { shift.x = shift.y = 0; return; }
    shift.i = (shift.i + 1) % SHIFT_PATH.length;
    [shift.x, shift.y] = SHIFT_PATH[shift.i];
    if (shift.i % 4 === 0) log({ event: 'pixel_shift', x: shift.x, y: shift.y });
    loop.kick();
  }

  // ---- night dimming: screen brightness down at night (frame rate unchanged) -------------------
  // config.json "night": {"start": "23:00", "end": "07:00", "brightness": 0.12, "day_brightness": 0.6}
  // or "night": false. A touch at night brightens to the day level for a minute.
  const NIGHT = Object.assign({ start: '23:00', end: '07:00', brightness: 0.12, day_brightness: 0.6 }, CFG.night || {});
  const night = { level: null, target: null, wakeUntil: 0, ramp: 0 };
  const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  function isNight(d) {
    const m = d.getHours() * 60 + d.getMinutes(), a = minutesOf(NIGHT.start), b = minutesOf(NIGHT.end);
    return a <= b ? m >= a && m < b : m >= a || m < b;            // the window may cross midnight
  }
  function setBrightness(target) {
    if (night.target === target) return;
    night.target = target;
    const from = night.level == null ? target : night.level;
    const t0 = performance.now(), dur = 3000;
    clearInterval(night.ramp);
    night.ramp = setInterval(() => {
      const x = Math.min(1, (performance.now() - t0) / dur);
      night.level = from + (target - from) * (x * x * (3 - 2 * x));
      native({ cmd: 'brightness', value: night.level });
      if (x >= 1) clearInterval(night.ramp);
    }, 100);
    log({ event: 'brightness', value: target });
  }
  function nightTick() {
    if (CFG.night === false) return;
    const dark = isNight(new Date()) && performance.now() > night.wakeUntil;
    // By day the brightness is the user's: only undo a dimming we did (remembered across reloads).
    let dimmed = false;
    try { dimmed = localStorage.getItem('hv_dimmed') === '1'; } catch (e) {}
    if (!dark && night.target == null && !dimmed) return;
    setBrightness(dark ? NIGHT.brightness : NIGHT.day_brightness);
    try { if (dark) localStorage.setItem('hv_dimmed', '1'); else if (performance.now() > night.wakeUntil) localStorage.removeItem('hv_dimmed'); } catch (e) {}
  }
  function nightTouch() {
    if (CFG.night === false || !isNight(new Date())) return;
    night.wakeUntil = performance.now() + 60000;
    nightTick();
  }

  // ---- pager -------------------------------------------------------------------------------
  const pages = [];
  const pager = { offset: track(new Spring(0, 220, 1)), index: 0 };

  // Each page: horizontal offset, plus its own scale and vertical shift (the face gallery),
  // both about the screen centre. Glass rects get exactly the same mapping as the DOM.
  function applyTransforms() {
    const out = [];
    const off = pager.offset.value;
    const cx = L.W / 2, cy = L.H / 2;
    const appA = overlay.show.value;                 // 0..1: an app zoomed over the pages
    const pagesA = 1 - appA;
    const pagesEl = $('#pages');
    if (pagesEl._a !== pagesA) { pagesEl._a = pagesA; pagesEl.style.opacity = pagesA.toFixed(3); pagesEl.style.visibility = pagesA < 0.01 ? 'hidden' : 'visible'; }
    pages.forEach((p, i) => {
      if (pagesA < 0.01) return;
      const dx = i * L.W - off + shift.x;
      const ps = p.scale.value, ty = p.ty.value + shift.y;
      const key = dx.toFixed(2) + '|' + ps.toFixed(4) + '|' + ty.toFixed(2);
      if (key !== p._key) {
        p._key = key;
        p.el.style.transform = 'translate3d(' + dx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)' + (ps !== 1 ? ' scale(' + ps.toFixed(4) + ')' : '');
      }
      const visible = dx > -L.W + 4 && dx < L.W - 4;
      p.el.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) return;
      const mx = (x) => cx + (x - cx) * ps + dx, my = (y) => cy + (y - cy) * ps + ty;
      for (const t of p.tiles) {
        const s = t.press.value;
        if (s !== t._s) { t._s = s; t.el.style.transform = s === 1 ? '' : 'scale(' + s.toFixed(4) + ')'; }
        if (!t.glass) continue;
        const w = t.rect.w * s, h = t.rect.h * s;
        const x = t.rect.x + (t.rect.w - w) / 2, y = t.rect.y + (t.rect.h - h) / 2;
        out.push({ x: mx(x), y: my(y), w: w * ps, h: h * ps, r: t.r * s * ps, alpha: pagesA, fill: t.fill, tintAmount: t.tintSpring.value });
      }
      for (const g of p.texts) {
        out.push({ mask: g.mask, x: mx(g.rect.x), y: my(g.rect.y), w: g.rect.w * ps, h: g.rect.h * ps, r: (g.r || 0) * ps, alpha: pagesA, fill: g.fill, tintAmount: g.tintAmount });
      }
    });
    const op = overlay.page;
    if (op) {
      const ps = 0.9 + 0.1 * appA;
      const key = ps.toFixed(4) + '|' + appA.toFixed(3) + '|' + shift.x + ',' + shift.y;
      if (key !== op._key) { op._key = key; op.el.style.transform = 'translate(' + shift.x + 'px,' + shift.y + 'px) scale(' + ps.toFixed(4) + ')'; op.el.style.opacity = appA.toFixed(3); }
      const mx = (x) => cx + (x - cx) * ps + shift.x, my = (y) => cy + (y - cy) * ps + shift.y;
      for (const t of op.tiles) {
        const s = t.press.value;
        if (s !== t._s) { t._s = s; t.el.style.transform = s === 1 ? '' : 'scale(' + s.toFixed(4) + ')'; }
        if (!t.glass) continue;
        const w = t.rect.w * s, h = t.rect.h * s;
        const x = t.rect.x + (t.rect.w - w) / 2, y = t.rect.y + (t.rect.h - h) / 2;
        out.push({ x: mx(x), y: my(y), w: w * ps, h: h * ps, r: t.r * s * ps, alpha: appA, fill: t.fill, tintAmount: t.tintSpring.value });
      }
      for (const g of op.texts) out.push({ mask: g.mask, x: mx(g.rect.x), y: my(g.rect.y), w: g.rect.w * ps, h: g.rect.h * ps, r: (g.r || 0) * ps, alpha: appA, fill: g.fill, tintAmount: g.tintAmount });
      if (appA === 0 && overlay.show.target === 0) finishClose();
    }
    updateDots();
    return out;
  }

  function goTo(i, v) {
    pager.index = Math.max(0, Math.min(pages.length - 1, i));
    pager.offset.to(pager.index * L.W, v);
  }

  // ---- apps: one at a time, zoomed in over the pages -----------------------------------------
  const overlay = { page: null, app: null, id: '', show: track(new Spring(0, 240, 1, 0.002)) };
  function openApp(id) {
    if (id === 'faces') { goTo(0); setTimeout(() => faces.openGallery(), 350); return; }
    if (id === 'lights') { goTo(2); return; }
    if (overlay.id === id && overlay.show.target === 1) return;
    if (overlay.page) finishClose();
    const page = new Page('app', $('#overlay'));
    overlay.page = page;
    overlay.id = id;
    try { overlay.app = apps.create(id, page); } catch (e) {
      overlay.app = null;
      log({ event: 'app_error', id, message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 400) });
      page.el.innerHTML = '<div class="app"><div class="app-title">打开失败</div><div class="app-empty">' + esc(String(e && e.message || e)) + '</div></div>';
    }
    const close = new Tile(page, { x: 24 * L.k, y: 20 * L.k, w: 52 * L.k, h: 52 * L.k }, 'closebtn', { r: 26 * L.k, onTap: closeApp });
    close.html(icon('chevDown'));
    if (overlay.app && overlay.app.wallpaper && glass) glass.setWallpaper(overlay.app.wallpaper);
    document.body.classList.add('app-open');
    overlay.show.set(0);
    overlay.show.to(1);
    log({ event: 'app_open', id });
  }
  function closeApp() {
    if (!overlay.page) return;
    overlay.show.to(0);
    if (glass && faces) glass.setWallpaper(faces.wallpaper());
    document.body.classList.remove('app-open');
  }
  function finishClose() {
    const page = overlay.page;
    if (!page) return;
    try { overlay.app && overlay.app.destroy && overlay.app.destroy(); } catch (e) { console.error(e); }
    clearPage(page);
    page.el.remove();
    overlay.page = null; overlay.app = null; overlay.id = '';
  }

  // ---- input: taps, presses, page drags, long press (face gallery) --------------------------
  const drag = { active: false };
  let lastTouch = performance.now();
  function setupInput() {
    const ui = $('#ui');
    let start = null, pressed = null, samples = [], longTimer = 0, longFired = false;
    const onFace = () => pager.index === 0 && faces && Math.abs(pager.offset.value) < 2 && !overlay.page;
    ui.addEventListener('pointerdown', (e) => {
      if (start) return;
      lastTouch = performance.now();
      nightTouch();
      const inBar = e.target.closest('#gallery button');
      const tileEl = e.target.closest('.tile');
      pressed = !inBar && tileEl && tileEl._tile && tileEl._tile.onTap && !(faces && faces.gallery) ? tileEl._tile : null;
      if (pressed) pressed.press.to(0.95);
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, off: pager.offset.value, id: e.pointerId, inBar: !!inBar };
      samples = [{ x: e.clientX, t: e.timeStamp }];
      longFired = false;
      clearTimeout(longTimer);
      if (onFace() && !faces.gallery && !inBar) {
        longTimer = setTimeout(() => {
          if (!start || drag.active) return;
          longFired = true;
          if (pressed) { pressed.press.to(1); pressed = null; }
          faces.openGallery();
        }, 450);
      }
    });
    ui.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 10) clearTimeout(longTimer);
      if (faces && faces.gallery) return;                                // the gallery swipes faces on release
      if (overlay.page) { if (pressed && Math.hypot(dx, dy) > 14) { pressed.press.to(1); pressed = null; } return; }
      if (!drag.active && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        drag.active = true;
        if (pressed) { pressed.press.to(1); pressed = null; }
      }
      if (!drag.active && pressed && Math.hypot(dx, dy) > 14) { pressed.press.to(1); pressed = null; }
      if (drag.active) {
        let off = start.off - dx;
        const max = (pages.length - 1) * L.W;
        if (off < 0) off *= 0.35; else if (off > max) off = max + (off - max) * 0.35;   // rubber band
        pager.offset.set(off);
        samples.push({ x: e.clientX, t: e.timeStamp });
        if (samples.length > 6) samples.shift();
        perf.kind = 'drag';
        loop.now();
      }
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      clearTimeout(longTimer);
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const tap = e.type === 'pointerup' && Math.hypot(dx, dy) < 12;
      if (overlay.page) {
        if (pressed && tap) { const t = pressed; t.press.to(1); try { t.onTap(t); } catch (err) { log({ event: 'tap_error', message: String(err) }); } }
        else if (pressed) pressed.press.to(1);
        else if (dy > 120 && Math.abs(dy) > Math.abs(dx)) closeApp();       // swipe down closes the app
        if (apps) apps.unlockAudio();
      } else if (faces && faces.gallery && !longFired) {
        if (start.inBar) { if (tap) faces.galleryClick(e.target); }
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) faces.step(dx < 0 ? 1 : -1);
        else if (tap) faces.closeGallery();
      } else if (drag.active) {
        const a = samples[0], b = samples[samples.length - 1];
        const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;            // px per ms, finger direction
        const projected = pager.offset.value - v * 160;                  // where a fling would carry it
        let i = Math.round(projected / L.W);
        i = Math.max(pager.index - 1, Math.min(pager.index + 1, i));
        drag.active = false;
        goTo(i, -v * 1000);
      } else if (pressed && tap && !longFired) {
        const t = pressed;
        t.press.to(1);
        try { t.onTap(t); } catch (err) { console.error(err); log({ event: 'tap_error', message: String(err) }); }
      } else if (pressed) {
        pressed.press.to(1);
      } else if (tap && !longFired && onFace() && e.timeStamp - start.t < 400) {
        goTo(1);                                                          // a tap on the face opens Home
      }
      pressed = null; start = null;
      loop.kick();
    };
    ui.addEventListener('pointerup', end);
    ui.addEventListener('pointercancel', end);
  }

  let dotsEl;
  function updateDots() {
    if (!dotsEl) return;
    const p = pager.offset.value / L.W;
    const kids = dotsEl.children;
    for (let i = 0; i < kids.length; i++) kids[i].style.opacity = (0.35 + 0.65 * Math.max(0, 1 - Math.abs(p - i))).toFixed(3);
  }

  // ---- weather (HA conditions, icons after homeview-g4) ------------------------------------
  const WX = {
    'sunny': ['晴', 0], 'clear-night': ['晴', 0], 'partlycloudy': ['多云', 2], 'cloudy': ['阴', 3], 'fog': ['雾', 45],
    'rainy': ['雨', 61], 'pouring': ['大雨', 65], 'lightning': ['雷暴', 95], 'lightning-rainy': ['雷阵雨', 95],
    'snowy': ['雪', 71], 'snowy-rainy': ['雨夹雪', 71], 'hail': ['冰雹', 71], 'windy': ['大风', 3], 'windy-variant': ['大风', 3], 'exceptional': ['异常', 3],
  };
  let WXN = 0;
  function wxIcon(cond, day, size) {
    const code = (WX[cond] || ['', 3])[1];
    const g = (n, color, extra) => '<g color="' + color + '"' + (extra || '') + '>' + SF[n].g + '</g>';
    const split = (n, top, bottom, cut) => {
      const id = 'wxc' + (++WXN);
      return '<defs><clipPath id="' + id + 'a"><rect width="56" height="' + cut + '"/></clipPath><clipPath id="' + id + 'b"><rect y="' + cut + '" width="56" height="' + (56 - cut) + '"/></clipPath></defs>' +
        g(n, top, ' clip-path="url(#' + id + 'a)"') + g(n, bottom, ' clip-path="url(#' + id + 'b)"');
    };
    let body;
    if (cond === 'windy' || cond === 'windy-variant') body = g('wx_wind', '#fff');
    else if (code === 0) body = day ? g('wx_sun', '#ffd60a') : g('wx_moonstars', '#fff');
    else if (code === 2) body = (day ? '<g transform="translate(17 -3) scale(.62)">' + g('wx_sun', '#ffd60a') + '</g>' : '<g transform="translate(20 0) scale(.55)">' + g('wx_moon', '#fff') + '</g>') +
      '<g transform="translate(-2 8) scale(.86)">' + g('wx_cloud', '#fff') + '</g>';
    else if (code === 45) body = g('wx_fog', '#fff');
    else if (code === 61 || code === 65) body = split(code === 65 ? 'wx_heavyrain' : 'wx_rain', '#fff', '#5ac8fa', 37);
    else if (code === 71) body = cond === 'snowy' ? g('wx_snow', '#fff') : g('wx_sleet', '#fff');
    else if (code === 95) body = split('wx_bolt', '#fff', '#ffd60a', 37);
    else body = g('wx_cloud', '#fff');
    return '<svg viewBox="0 0 56 56" width="' + size + '" height="' + size + '">' + body + '</svg>';
  }

  // ---- app state ---------------------------------------------------------------------------
  let ha = null, glass = null, faces = null, facePage = null, apps = null, appsPage = null, photos = null;
  const forecast = { list: [], at: 0 };
  const hourly = { list: [], at: 0 };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const isDay = () => { const s = ha && ha.get('sun.sun'); return s ? s.state === 'above_horizon' : (new Date().getHours() >= 6 && new Date().getHours() < 18); };

  /** Home tiles from config.json "home" or a sensible default. at: [col, row, w, h]. */
  function homeSpec() {
    if (Array.isArray(CFG.home) && CFG.home.length) return CFG.home;
    const lights = Object.keys((ha && ha.states) || {}).filter((id) => id.startsWith('light.') && !/indicator/.test(id)).slice(0, 6);
    const spec = [{ type: 'clock', at: [0, 0, 2, 2] }, { type: 'weather', at: [2, 0] }];
    const free = [[3, 0], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
    lights.forEach((id, i) => spec.push({ type: 'light', entity: id, at: free[i] }));
    return spec;
  }

  const homeTiles = [];   // {spec, tile, render()}
  let homePage, devicesPage, devicesBuiltFor = '';

  function clearPage(page) {
    for (const t of page.tiles) { springs.delete(t.press); springs.delete(t.tintSpring); }
    page.tiles.length = 0;
  }

  function buildHome() {
    clearPage(homePage);
    homePage.el.innerHTML = '';
    homeTiles.length = 0;
    // Landscape uses each tile's `at`; portrait packs them in order into the 3 x 4 grid.
    const used = [];
    const free = (c, r, w, h) => {
      if (c + w > L.cols || r + h > L.rows) return false;
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (used[y * L.cols + x]) return false;
      return true;
    };
    for (const spec of homeSpec()) {
      const maker = MAKERS[spec.type];
      if (!maker) continue;
      const at = spec.at || [0, 0];
      const w = at[2] || 1, h = at[3] || 1;
      let pos = null;
      if (!L.portrait) pos = [at[0], at[1]];
      else for (let i = 0; i < L.cols * L.rows && !pos; i++) { const c = i % L.cols, r = Math.floor(i / L.cols); if (free(c, r, w, h)) pos = [c, r]; }
      if (!pos) continue;
      for (let y = pos[1]; y < pos[1] + h; y++) for (let x = pos[0]; x < pos[0] + w; x++) used[y * L.cols + x] = true;
      homeTiles.push(maker(homePage, cell(pos[0], pos[1], w, h), spec));
    }
    renderHome();
  }

  function renderHome() { for (const h of homeTiles) h.render(); loop.kick(); }

  // ---- tile kinds ----------------------------------------------------------------------------
  const MAKERS = {
    clock(page, rect, spec) {
      const t = new Tile(page, rect, 'k-clock', { onTap: () => openApp('timer') });
      return {
        tile: t, spec, render() {
          const d = new Date();
          t.html('<div class="time">' + d.getHours() + ':' + pad(d.getMinutes()) + '</div>' +
            '<div class="date">' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()] + '</div>');
        },
      };
    },

    weather(page, rect, spec) {
      const t = new Tile(page, rect, 'k-weather', { onTap: () => { refreshForecast(false); openApp('weather'); } });
      return {
        tile: t, spec, render() {
          const s = weatherNow();
          if (!s || s.attributes.temperature == null || s.state === 'unavailable') { t.html('<div class="row"><div class="temp">--°</div></div><div class="cond">天气</div><div class="hl">暂无数据</div>'); return; }
          const a = s.attributes, today = forecast.list[0];
          const hl = today ? '最高 ' + Math.round(today.temperature) + '° 最低 ' + Math.round(today.templow) + '°' : '';
          t.html('<div class="row"><div class="temp">' + Math.round(a.temperature) + '°</div><div class="wxicon">' + wxIcon(s.state, isDay(), 64) + '</div></div>' +
            '<div class="cond">' + esc((WX[s.state] || [s.state])[0]) + '</div><div class="hl">' + hl + '</div>');
        },
      };
    },

    climate(page, rect, spec) {
      const t = new Tile(page, rect, 'k-climate');
      return {
        tile: t, spec, render() {
          const tp = ha.get(spec.temperature), hu = ha.get(spec.humidity);
          const ok = (s) => s && s.state !== 'unavailable' && s.state !== 'unknown';
          t.html('<div class="label">' + esc(spec.name || '室内') + '</div>' +
            '<div class="temp">' + (ok(tp) ? Number(tp.state).toFixed(1) : '--') + '<small>°</small></div>' +
            '<div class="sub">湿度 ' + (ok(hu) ? Math.round(Number(hu.state)) + '%' : '--') + '</div>');
        },
      };
    },

    light(page, rect, spec) { return deviceTile(page, rect, spec, 'k-acc'); },
    switch(page, rect, spec) { return deviceTile(page, rect, spec, 'k-acc'); },
    media(page, rect, spec) { return deviceTile(page, rect, spec, 'k-acc'); },
  };

  const pendingToggle = {};   // entity -> {want, until}
  function deviceTile(page, rect, spec, cls) {
    const id = spec.entity;
    const domain = id.split('.')[0];
    const t = new Tile(page, rect, cls + (rect.h < L.u * 0.8 ? ' small' : ''), {
      onTap: () => {
        const s = ha.get(id);
        if (!s || s.state === 'unavailable') return;
        const want = s.state === 'on' || s.state === 'playing' ? 'off' : 'on';
        pendingToggle[id] = { want, until: performance.now() + 5000 };
        h.render();
        loop.kick();
        const svc = domain === 'media_player' ? 'toggle' : 'toggle';
        ha.call(domain, svc, id).catch((e) => { delete pendingToggle[id]; h.render(); log({ event: 'toggle_error', entity: id, message: String(e.message || e) }); });
        setTimeout(() => { if (pendingToggle[id]) { delete pendingToggle[id]; h.render(); } }, 5200);
      },
    });
    const h = {
      tile: t, spec, render() {
        const s = ha.get(id);
        const p = pendingToggle[id];
        const offline = !s || s.state === 'unavailable';
        let on = s && (s.state === 'on' || s.state === 'playing');
        if (p && !offline) on = p.want === 'on';
        const name = spec.name || HA.cleanName(s && s.attributes.friendly_name) || id;
        const room = spec.room || HA.cleanArea(ha.areas[id] || '');
        let state = offline ? '无响应' : on ? '开' : '关';
        if (on && s && s.attributes.brightness && !p) state = Math.round(s.attributes.brightness / 2.55) + '%';
        const ic = spec.icon || (domain === 'media_player' ? 'film' : domain === 'switch' ? 'box' : 'bulb');
        let fill = [1, 0.98, 0.94];
        const rgb = on && s && s.attributes.rgb_color;
        t.el.style.setProperty('--icon-on', rgb ? 'rgb(' + rgb.join(',') + ')' : '#ffb340');
        t.el.classList.toggle('offline', offline);
        t.setOn(on && !offline, fill);
        t.html('<div class="icon">' + icon(ic) + '</div><div class="name">' + esc(name) + '</div><div class="state">' + esc(room ? room + ' · ' + state : state) + '</div>');
      },
    };
    return h;
  }

  // ---- devices page: every light, switch-like light and media player ---------------------------
  function buildDevices() {
    const ids = Object.keys(ha.states).filter((id) => /^(light|media_player)\./.test(id) && !/indicator/.test(id))
      .sort((a, b) => {
        const ua = ha.get(a).state === 'unavailable', ub = ha.get(b).state === 'unavailable';
        if (ua !== ub) return ua ? 1 : -1;
        return a < b ? -1 : 1;
      });
    const key = ids.join(',');
    if (key === devicesBuiltFor) return;
    devicesBuiltFor = key;
    clearPage(devicesPage);
    devicesPage.el.innerHTML = '<div class="page-title">全部设备</div>';
    const top = L.m + 56, cols = L.cols;
    const rows = Math.max(1, Math.ceil(ids.length / cols));
    const ch = Math.min(L.u * 0.78, (L.H - top - L.m - (rows - 1) * L.g) / rows);
    const cw = L.u;
    devicesPage.devs = ids.map((id, i) => {
      const rect = { x: L.mx + (i % cols) * (cw + L.g), y: top + Math.floor(i / cols) * (ch + L.g), w: cw, h: ch };
      return deviceTile(devicesPage, rect, { entity: id }, 'k-acc');
    });
    devicesPage.devs.forEach((d) => d.render());
  }

  // ---- weather: Home Assistant first; Open-Meteo straight from the iPad while HA's is unavailable ----
  const fallback = { state: null, daily: [], hourly: [], at: 0 };
  function haWeather() {
    const id = weatherEntity();
    const s = id && ha && ha.get(id);
    return s && s.state !== 'unavailable' && s.state !== 'unknown' && s.attributes.temperature != null ? s : null;
  }
  /** The weather as an HA-style state ({state: condition, attributes: {...}}), or null. */
  function weatherNow() { return haWeather() || fallback.state; }

  // WMO weather codes -> HA conditions
  function wmo(code, day) {
    if (code === 0) return day ? 'sunny' : 'clear-night';
    if (code <= 2) return 'partlycloudy';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code === 65 || code === 82) return 'pouring';
    if (code === 66 || code === 67) return 'snowy-rainy';
    if ((code >= 51 && code <= 64) || code === 80 || code === 81) return 'rainy';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy';
    if (code === 95) return 'lightning-rainy';
    if (code >= 96) return 'hail';
    return 'cloudy';
  }
  async function fetchOpenMeteo() {
    const c = (ha && ha.config) || {};
    const lat = CFG.latitude || c.latitude, lon = CFG.longitude || c.longitude;
    if (lat == null || lon == null) return false;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,dew_point_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,surface_pressure' +
      '&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto&forecast_days=7';
    const r = await fetch(url);
    if (!r.ok) throw new Error('open-meteo ' + r.status);
    const d = await r.json(), cur = d.current;
    fallback.state = { entity_id: 'weather.open_meteo', state: wmo(cur.weather_code, cur.is_day === 1), attributes: {
      temperature: cur.temperature_2m, humidity: cur.relative_humidity_2m, dew_point: cur.dew_point_2m, wind_speed: cur.wind_speed_10m,
      wind_bearing: cur.wind_direction_10m, pressure: cur.surface_pressure, uv_index: d.daily.uv_index_max ? d.daily.uv_index_max[0] : null, source: 'Open-Meteo' } };
    fallback.daily = d.daily.time.map((t, i) => ({ datetime: t + 'T12:00:00', condition: wmo(d.daily.weather_code[i], true),
      temperature: d.daily.temperature_2m_max[i], templow: d.daily.temperature_2m_min[i] }));
    const now = Date.now();
    fallback.hourly = d.hourly.time.map((t, i) => ({ datetime: t, condition: wmo(d.hourly.weather_code[i], d.hourly.is_day[i] === 1), temperature: d.hourly.temperature_2m[i] }))
      .filter((h) => new Date(h.datetime).getTime() > now - 3600000).slice(0, 24);
    fallback.at = performance.now();
    return true;
  }

  async function refreshForecast(force) {
    if (!ha || ha.status !== 'ready') return;
    if (!force && performance.now() - forecast.at < 30 * 60 * 1000 && forecast.list.length) return;
    const id = weatherEntity();
    if (haWeather()) {
      // only ask HA for forecasts while its weather entity is up (otherwise HA logs an error per call)
      try { forecast.list = await ha.forecast(id, 'daily'); } catch (e) { log({ event: 'forecast_error', message: String(e.message || e) }); }
      try { hourly.list = await ha.forecast(id, 'hourly'); } catch (e) { hourly.list = []; }
      fallback.state = null;
    } else {
      try {
        if (await fetchOpenMeteo()) { forecast.list = fallback.daily; hourly.list = fallback.hourly; log({ event: 'weather_fallback', source: 'open-meteo' }); }
      } catch (e) { log({ event: 'weather_fallback_error', message: String(e.message || e) }); }
    }
    forecast.at = performance.now();
    renderHome();
    if (faces) faces.update();
  }

  // What the faces need from the rest of the app.
  function weatherEntity() {
    return (homeSpec().find((s) => s.type === 'weather') || {}).entity || Object.keys((ha && ha.states) || {}).find((k) => k.startsWith('weather.'));
  }
  function appContext() {
    return {
      L, Tile, glass, get ha() { return ha; }, esc, icon, wxIcon, WX, isDay, log, openApp,
      kick: () => loop.kick(), forecast: () => forecast.list, hourly: () => hourly.list, weatherEntity, weather: weatherNow,
    };
  }
  function buildAppsPage() {
    clearPage(appsPage);
    appsPage.el.innerHTML = '<div class="page-title">应用</div>';
    const list = apps.list(), size = 136 * L.k, g = 48 * L.k, cols = Math.min(list.length, 5);
    const x0 = (L.W - cols * size - (cols - 1) * g) / 2, y0 = L.H * 0.36 - size / 2;
    list.forEach((a, i) => {
      const t = new Tile(appsPage, { x: x0 + (i % cols) * (size + g), y: y0 + Math.floor(i / cols) * (size + 90 * L.k), w: size, h: size }, 'appicon', { r: size * 0.26, glass: false, onTap: () => openApp(a.id) });
      t.html('<div class="ai" style="background:' + a.bg + '">' + icon(a.icon) + '</div><div class="an">' + a.name + '</div>');
    });
  }
  function faceContext() {
    return {
      L, Tile, glass, get ha() { return ha; }, get photos() { return photos; }, esc, icon, wxIcon, WX, isDay, log, clearPage, goTo,
      kick: () => loop.kick(),
      forecast: () => forecast.list,
      hourly: () => hourly.list,
      weatherEntity, weather: weatherNow,
      climateSpec: () => homeSpec().find((s) => s.type === 'climate'),
      lightsOn: () => {
        if (!ha) return [];
        const spec = homeSpec().filter((s) => s.type === 'light');
        const ids = spec.length ? spec.map((s) => s.entity) : Object.keys(ha.states).filter((id) => id.startsWith('light.') && !/indicator/.test(id));
        return ids.filter((id) => { const st = ha.get(id); return st && st.state === 'on'; })
          .map((id) => { const sp = spec.find((s) => s.entity === id); return (sp && sp.name) || HA.cleanName(ha.get(id).attributes.friendly_name); });
      },
    };
  }

  // ---- remote self-test: config.json "selftest": "<id>" runs scripted swipes and presses once ----
  // Touch-like timing (16.7 ms timers, not vsync), same code path as a finger; results go to perf logs.
  function selftest(id) {
    let seen = '';
    try { seen = localStorage.getItem('hv_selftest') || ''; } catch (e) {}
    if (seen === id) return;
    try { localStorage.setItem('hv_selftest', id); } catch (e) {}
    log({ event: 'selftest_start', id });
    const swipe = (to, done) => {
      const t0 = performance.now(), from = pager.offset.value, dur = 300;
      drag.active = true;
      perf.kind = 'selftest-drag';
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / dur);
        pager.offset.set(from + (to * L.W - from) * 0.55 * (1 - Math.pow(1 - p, 2)));
        loop.now();
        if (p < 1) { setTimeout(tick, 16.7); return; }
        drag.active = false;
        goTo(to, (to * L.W > from ? 1 : -1) * 1600);
        setTimeout(done, 1000);
      };
      tick();
    };
    const press = (tile, done) => {
      perf.kind = 'selftest-press';
      tile.press.to(0.95);
      setTimeout(() => { tile.press.to(1); setTimeout(done, 700); }, 140);
    };
    const steps = [];
    for (let i = 0; i < 4; i++) { steps.push((d) => swipe(1, d)); steps.push((d) => swipe(0, d)); }
    const clock = homeTiles[0] && homeTiles[0].tile;
    if (clock) for (let i = 0; i < 3; i++) steps.push((d) => press(clock, d));
    const next = () => { const f = steps.shift(); if (f) f(next); else log({ event: 'selftest_done', id }); };
    next();
  }

  // ---- connection banner -------------------------------------------------------------------
  function setBanner(text) {
    const b = $('#banner');
    b.textContent = text || '';
    b.classList.toggle('show', !!text);
  }

  // ---- boot --------------------------------------------------------------------------------
  function boot() {
    layout();
    try {
      glass = new Glass($('#gl'), { scale: CFG.render_scale || 1.25 });
      const wp = CFG.wallpaper || {};
      glass.setWallpaper({ style: wp.style == null ? 2 : wp.style, tint: wp.tint || [0.82, 0.72, 0.58], animated: wp.animated !== false, speed: wp.speed || 1, dim: wp.dim || 0 });
    } catch (e) {
      log({ event: 'glass_error', message: String(e.message || e) });
      document.body.classList.add('no-gl');
    }
    facePage = new Page('face');
    homePage = new Page('home');
    devicesPage = new Page('devices');
    appsPage = new Page('apps');
    pages.push(facePage, homePage, devicesPage, appsPage);
    $('#ui').insertBefore(Object.assign(document.createElement('div'), { id: 'overlay' }), $('#dots'));
    apps = new HVApps(appContext());
    buildAppsPage();
    $('#ui').appendChild(Object.assign(document.createElement('div'), { id: 'gallery' }));
    photos = new HVPhotos(log);
    faces = new HVFaces(faceContext());
    // the photo picker must open inside a real click (iOS user gesture), not our pointerup handler
    $('#gallery').addEventListener('click', (e) => { if (e.target.closest('[data-add]')) faces.pickPhotos(); });
    photos.ready.then(() => { if (faces.face().background === 'photo') faces.startPhotos(); });
    if (!HVNative.available()) window.__hv = { faces, photos, stepShift, shift, fetchOpenMeteo, weatherNow, fallback, night, isNight, nightTick };   // Mac preview only: test hooks
    dotsEl = $('#dots');
    dotsEl.innerHTML = pages.map(() => '<i></i>').join('');
    setupInput();

    if (!CFG.ha_url || !CFG.token) {
      setBanner('缺少 Home Assistant 配置（config.json）');
      ha = new HA('http://invalid', '');
      faces.build(facePage);
      buildHome();
      loop.kick();
      return;
    }
    ha = new HA(CFG.ha_url, CFG.token);
    ha.on('status', (s) => {
      setBanner(s === 'ready' ? '' : s === 'auth_invalid' ? 'Home Assistant 令牌无效' : '正在连接 Home Assistant…');
      log({ event: 'ha_status', status: s });
      if (s === 'ready') { faces.build(facePage); buildHome(); buildDevices(); refreshForecast(true); if (CFG.selftest) setTimeout(() => selftest(String(CFG.selftest)), 3000); }
    });
    let renderQueued = false;
    let weatherUp = null;
    ha.on('state', (id, st) => {
      if (id === weatherEntity() || id === '*') {
        const up = !!haWeather();
        if (weatherUp !== null && up !== weatherUp) { log({ event: 'weather_source', ha: up }); refreshForecast(true); }
        weatherUp = up;
      }
      if (id !== '*' && pendingToggle[id] && st) {
        const on = st.state === 'on' || st.state === 'playing';
        if ((pendingToggle[id].want === 'on') === on || st.state === 'unavailable') delete pendingToggle[id];
      }
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        renderHome();
        faces.update();
        if (devicesPage.devs) { buildDevices(); devicesPage.devs.forEach((d) => d.render()); }
      });
    });
    faces.build(facePage);
    buildHome();
    ha.connect();
    loop.kick();

    // minute tick for the clock; forecast every 30 minutes
    let lastMinute = -1;
    setInterval(() => {
      const m = new Date().getMinutes();
      if (m !== lastMinute) { lastMinute = m; renderHome(); faces.update(); refreshForecast(false); }
      // back to the face after two minutes untouched elsewhere
      if (pager.index !== 0 && !drag.active && !faces.gallery && performance.now() - lastTouch > 120000) goTo(0);
    }, 1000);
    // the hands' CSS clocks drift a little against the system clock: rebuild hourly
    setInterval(() => { if (!faces.gallery) faces.build(facePage); }, 3600000);
    setInterval(() => { log({ event: 'stats', frames: stats.frames, ha: ha.status }); stats.frames = 0; }, 60000);
    setInterval(stepShift, 90000);
    nightTick();
    setInterval(nightTick, 15000);
    log({ event: 'boot', w: L.W, h: L.H, dpr: window.devicePixelRatio, scale: glass ? glass.scale : 0 });
  }

  // Rotation: rebuild every layout for the new size; an open app is rebuilt in place.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const W0 = L.W, H0 = L.H;
      layout();
      if (W0 === L.W && H0 === L.H) return;
      if (glass) glass.resize();
      if (faces) { const g = faces.gallery; faces.build(facePage); if (g) { faces.gallery = false; faces.openGallery(); } }
      if (ha && ha.status === 'ready') { buildHome(); devicesBuiltFor = ''; buildDevices(); }
      if (apps) buildAppsPage();
      if (overlay.page && overlay.show.target === 1) { const id = overlay.id; finishClose(); overlay.id = ''; openApp(id); overlay.show.set(1); }
      pager.offset.set(pager.index * L.W);
      log({ event: 'rotate', w: L.W, h: L.H });
      loop.kick();
    }, 60);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.kick(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
