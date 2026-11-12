/* Watch faces for the iPad HomeView (after FrontRow's HomeView faces, laid out
 * for a 4:3 landscape screen). A face is DOM (text, SVG, hands) plus glass:
 * panels (Tiles) and glass numerals (text masks refracted by glass.js).
 * Hands turn by CSS animation on the compositor: no JS or WebGL per second.
 *
 * Settings (faces collection, current face, per-face background/colour/
 * numerals) live in localStorage under hv_faces.
 */
(function () {
  'use strict';

  const COLORS = [
    ['珊瑚', [255, 112, 67]], ['天蓝', [90, 160, 255]], ['鼠尾草', [143, 170, 140]], ['薰衣草', [165, 140, 230]],
    ['樱粉', [240, 170, 185]], ['砂色', [214, 196, 170]], ['石墨', [58, 60, 66]], ['白', [238, 238, 234]], ['雾蓝', [150, 175, 186]],
    ['草绿', [66, 150, 92]],
    // designer palette
    ['午夜蓝', [34, 48, 98]], ['酒红', [122, 32, 52]], ['墨绿', [26, 72, 58]], ['赤陶', [196, 98, 70]],
    ['雾紫', [150, 122, 168]], ['橄榄', [128, 128, 76]], ['冰川', [158, 204, 218]], ['杏色', [246, 192, 150]],
  ];
  const BACKGROUNDS = [['liquid', '流光', 0], ['aurora', '极光', 1], ['bubbles', '气泡', 2], ['mesh', '弥散', 5], ['silk', '丝绸', 6],
    ['halo', '光环', 7], ['stars', '星空', 8], ['solid', '纯色', 3], ['photo', '照片', 4]];
  const INTERVALS = [[30, '30秒'], [60, '1分钟'], [300, '5分钟']];
  const THUMBS_PER_PAGE = 8;
  const NUMERALS = [['glass', '玻璃'], ['tint', '高亮'], ['bubble', '气泡'], ['solid', '实色']];
  const TYPES = {
    widgets: '小组件', numerals: '大数字', single: '单独数字', analog: '模拟·大数字',
    bignum: '数字·指针', info: '信息', weather: '天气', calendar: '日历',
  };
  const DEFAULTS = [
    { type: 'widgets', background: 'bubbles', color: 5, numerals: 'glass' },
    { type: 'analog', background: 'solid', color: 2, numerals: 'glass' },
    { type: 'bignum', background: 'solid', color: 9, numerals: 'solid' },
    { type: 'info', background: 'solid', color: 8, numerals: 'solid' },
    { type: 'numerals', background: 'bubbles', color: 4, numerals: 'glass' },
    { type: 'single', background: 'solid', color: 7, numerals: 'solid' },
    { type: 'weather', background: 'liquid', color: 1, numerals: 'glass' },
    { type: 'calendar', background: 'solid', color: 7, numerals: 'solid' },
  ];
  const FONT = '"SF Pro Rounded", ui-rounded, -apple-system, "PingFang SC", system-ui, sans-serif';

  function Faces(ctx) {
    this.ctx = ctx;
    this.load();
    this.gallery = false;
  }

  Faces.prototype.load = function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('hv_faces') || 'null'); } catch (e) {}
    if (!s || !Array.isArray(s.faces) || !s.faces.length || s.version !== 1) s = { version: 1, faces: DEFAULTS.map((f) => Object.assign({}, f)), index: 0 };
    s.faces = s.faces.filter((f) => TYPES[f.type]);
    s.index = Math.max(0, Math.min(s.faces.length - 1, s.index | 0));
    this.s = s;
  };
  Faces.prototype.save = function () { try { localStorage.setItem('hv_faces', JSON.stringify(this.s)); } catch (e) {} };
  Faces.prototype.face = function () { return this.s.faces[this.s.index]; };

  /** Colour of the face as 0..1 rgb, its luma, and the ink for text on it. */
  function look(face) {
    const c = COLORS[face.color % COLORS.length][1];
    const rgb = c.map((v) => v / 255);
    const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const light = face.background === 'solid' && luma > 0.62;     // photos: white text, like the glass
    return { rgb, css: 'rgb(' + c.join(',') + ')', light, ink: light ? '#1c1c1e' : '#ffffff', muted: light ? 'rgba(28,28,30,.6)' : 'rgba(255,255,255,.78)' };
  }

  Faces.prototype.wallpaper = function () {
    const f = this.face();
    const bg = BACKGROUNDS.find((b) => b[0] === f.background) || BACKGROUNDS[0];
    if (bg[0] === 'photo') return { style: (f.photos || []).length ? 4 : 3, tint: [0.12, 0.12, 0.13], animated: false, dim: 0.1 };
    return { style: bg[2], tint: look(f).rgb, animated: bg[0] !== 'solid', dim: 0 };
  };

  // ---- photo backgrounds: one photo, or several cross-fading in turn -----------------------------
  Faces.prototype.stopPhotos = function () {
    clearInterval(this.photoTimer);
    cancelAnimationFrame(this.fadeRaf);
    this.photoTimer = 0;
  };
  Faces.prototype.startPhotos = function () {
    this.stopPhotos();
    const f = this.face(), ctx = this.ctx, photos = ctx.photos;
    if (f.background !== 'photo' || !photos || !ctx.glass) return;
    const list = (f.photos || []).filter((id) => photos.ids.includes(id));
    if (!list.length) return;
    const gen = this.photoGen = (this.photoGen || 0) + 1;
    let i = Math.max(0, list.indexOf(f.photoAt)) % list.length;
    photos.image(list[i]).then((img) => {
      if (gen !== this.photoGen) return;
      ctx.glass.setPhotos(img, null, 0);
      ctx.kick();
    }).catch((e) => ctx.log({ event: 'photos_error', op: 'show', message: String(e.message || e) }));
    if (f.photoMode !== 'cycle' || list.length < 2) return;
    this.photoTimer = setInterval(() => {
      const cur = list[i], next = list[(i + 1) % list.length];
      Promise.all([photos.image(cur), photos.image(next)]).then(([a, b]) => {
        if (gen !== this.photoGen) return;
        i = (i + 1) % list.length;
        f.photoAt = next;
        cancelAnimationFrame(this.fadeRaf);                // a fade still running (slow frames) gives way
        const t0 = performance.now(), dur = 1600;
        const step = (now) => {
          if (gen !== this.photoGen) return;
          const x = Math.min(1, (now - t0) / dur);
          const e = x * x * (3 - 2 * x);                     // smoothstep
          if (x < 1) { ctx.glass.setPhotos(a, b, e); this.fadeRaf = requestAnimationFrame(step); }
          else ctx.glass.setPhotos(b, null, 0);
          ctx.kick();
        };
        this.fadeRaf = requestAnimationFrame(step);
      }).catch(() => {});
    }, (f.photoInterval || 60) * 1000);
  };

  // ---- building ------------------------------------------------------------------------------

  /** (Re)builds the current face into `page`. */
  Faces.prototype.build = function (page) {
    const ctx = this.ctx, f = this.face(), lk = look(f);
    this.page = page;
    ctx.clearPage(page);
    page.texts = [];
    page.el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'face face-' + f.type + (lk.light ? ' light' : '');
    root.style.setProperty('--ink', lk.ink);
    root.style.setProperty('--muted', lk.muted);
    root.style.setProperty('--accent', lk.css);
    page.el.appendChild(root);
    this.root = root;
    this.look = lk;
    this.parts = {};
    ctx.glass && ctx.glass.setWallpaper(this.wallpaper());
    this.startPhotos();
    (BUILD[f.type] || BUILD.widgets).call(this, root, f, lk);
    this.update(true);
    ctx.kick();
  };

  /** Minute tick and data changes: rewrite text, regenerate glass numerals when they change. */
  Faces.prototype.update = function (force) {
    const f = this.face();
    const fn = UPDATE[f.type];
    if (fn) fn.call(this, f, force);
    this.ctx.kick();
  };

  // A numeral in a box, in the face's numerals style (after FrontRow's faceDigits):
  //   glass  - text mask refracting the backdrop (35% face colour on a solid background)
  //   tint   - 高亮玻璃: the same glass tinted 70% with the face colour
  //   bubble - 气泡: each digit built from glass capsules and circles (bubbleShapes)
  //   solid  - plain DOM text
  // opts: {size, weight, sx (horizontal squeeze), soft, tint}
  Faces.prototype.numeral = function (name, text, box, opts) {
    const f = this.face(), page = this.page, ctx = this.ctx;
    opts = opts || {};
    const size = opts.size || box.h * 0.9, weight = opts.weight || 600, sx = opts.sx || 1;
    let part = this.parts[name];
    if (!part) {
      part = { el: document.createElement('div'), items: [] };
      part.el.className = 'numeral';
      Object.assign(part.el.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px',
        fontSize: size + 'px', fontWeight: weight, transform: sx !== 1 ? 'scaleX(' + sx + ')' : '' });
      this.root.appendChild(part.el);
      this.parts[name] = part;
    }
    if (part.text === text) return;
    part.text = text;
    const style = !ctx.glass ? 'solid' : f.numerals;
    part.el.textContent = style === 'solid' ? text : '';
    for (const it of part.items) { const i = page.texts.indexOf(it); if (i >= 0) page.texts.splice(i, 1); }
    part.items = [];
    if (style === 'solid') return;
    const solidBg = f.background === 'solid';
    const amount = opts.tint != null ? opts.tint : style === 'tint' ? 0.7 : solidBg ? 0.35 : 0;
    if (style === 'bubble') {
      // digit height ~ the glyph's cap height in this box
      // capsule digits: as tall as the box allows (they read smaller than glyphs of the same size),
      // but no wider than the box; they keep their proportions (no squeeze, as on FrontRow)
      const widthPerH = bubbleWidthPerHeight(text);
      let digitH = Math.min(box.h * 0.94, size * 0.95, (box.w * 1.04) / widthPerH);
      if (sx < 1) digitH *= 0.86;
      for (const r of bubbleLayout(text, box.x + box.w / 2, box.y + (box.h - digitH) / 2, digitH, 1)) {
        part.items.push({ rect: r, r: r.r, fill: this.look.rgb, tintAmount: solidBg ? Math.max(amount, 0.35) : amount });
      }
      page.texts.push(...part.items);
      return;
    }
    const key = 'n|' + text + '|' + Math.round(size) + '|' + weight + '|' + sx + '|' + box.w + 'x' + box.h;
    const mask = ctx.glass.textMask(key, box.w, box.h, (c, w, h) => {
      c.font = weight + ' ' + size + 'px ' + FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.save();
      c.translate(w / 2, h / 2 + size * 0.04);
      c.scale(sx, 1);
      c.fillText(text, 0, 0);
      c.restore();
    }, opts.soft || Math.max(3, size / 40));
    part.items = [{ rect: box, mask, fill: this.look.rgb, tintAmount: amount }];
    page.texts.push(...part.items);
  };

  // ---- capsule digits (FrontRow bubbleShapes): each glyph in a 100 x 180 box ---------------------
  const BUBBLE_S = 46;
  function bubbleShapes(ch) {
    const S = BUBBLE_S, mid = 90;
    const cap = (x, y, w, h) => ({ x, y, w, h, r: Math.min(w, h) / 2 });
    const top = cap(0, 0, 100, S), bottom = cap(0, 180 - S, 100, S), middle = cap(0, mid - S / 2, 100, S);
    const leftTop = cap(0, 0, S, mid + S / 2), leftBottom = cap(0, mid - S / 2, S, 180 - mid + S / 2);
    const rightTop = cap(100 - S, 0, S, mid + S / 2), rightBottom = cap(100 - S, mid - S / 2, S, 180 - mid + S / 2);
    const right = cap(100 - S, 0, S, 180);
    return {
      0: [{ x: 0, y: 0, w: 100, h: 180, r: 50 }],
      1: [cap(54 - S / 2, 0, S, 180), { x: 6, y: 8, w: 34, h: 34, r: 17 }],
      2: [top, rightTop, middle, leftBottom, bottom],
      3: [top, right, middle, bottom],
      4: [leftTop, middle, right],
      5: [top, leftTop, middle, rightBottom, bottom],
      6: [cap(0, 0, S, 130), { x: 0, y: 80, w: 100, h: 100, r: 50 }],
      7: [top, right],
      8: [{ x: 6, y: 0, w: 88, h: 88, r: 44 }, { x: 0, y: 80, w: 100, h: 100, r: 50 }],
      9: [{ x: 0, y: 0, w: 100, h: 100, r: 50 }, cap(100 - S, 50, S, 130)],
      ':': [{ x: 30, y: 40, w: 40, h: 40, r: 20 }, { x: 30, y: 110, w: 40, h: 40, r: 20 }],
      '°': [{ x: 10, y: 0, w: 44, h: 44, r: 22 }],
      '-': [cap(10, mid - S / 2, 80, S)],
    }[ch] || [];
  }
  const bubbleWidth = (ch) => (ch === ':' ? 60 : ch === '°' ? 60 : 100);
  /** Total width of `text` in capsule digits per unit of digit height. */
  function bubbleWidthPerHeight(text) {
    const chars = [...text];
    return chars.reduce((sum, ch) => sum + bubbleWidth(ch) + 16, -16) / 180;
  }
  /** Rects ({x, y, w, h, r}) for `text` in capsule digits digitH tall, centred on cx, top at y. */
  function bubbleLayout(text, cx, y, digitH, sx) {
    const k = digitH / 180, kx = k * (sx || 1), gap = 16 * kx;
    const chars = [...text];
    const total = chars.reduce((sum, ch) => sum + bubbleWidth(ch) * kx + gap, -gap);
    let x = cx - total / 2;
    const out = [];
    for (const ch of chars) {
      const shift = ch === ':' ? -20 * kx : 0;
      for (const sh of bubbleShapes(ch)) {
        const w = sh.w * kx, h = sh.h * k;
        out.push({ x: x + shift + sh.x * kx, y: y + sh.y * k, w, h, r: Math.min(w, h) / 2 });
      }
      x += bubbleWidth(ch) * kx + gap;
    }
    return out;
  }

  /** A glass panel (a Tile without content) and a DOM box over it. */
  Faces.prototype.panel = function (rect, cls, opts) {
    const t = new this.ctx.Tile(this.page, rect, 'panel ' + (cls || ''), Object.assign({ r: Math.min(36, rect.h * 0.22) }, opts || {}));
    t.el.style.color = this.look.ink;
    t.el.classList.toggle('dark-ink', this.look.light);
    return t;
  };

  /** Analog hands turned by CSS animation (compositor only). */
  Faces.prototype.hands = function (cx, cy, r, spec) {
    const d = new Date();
    const sec = d.getSeconds() + d.getMilliseconds() / 1000;
    const min = d.getMinutes() * 60 + sec;
    const hr = (d.getHours() % 12) * 3600 + min;
    const wrap = document.createElement('div');
    wrap.className = 'hands';
    const hand = (cls, len, width, period, elapsed, color, tail) => {
      const h = document.createElement('div');
      h.className = 'hand ' + cls;
      Object.assign(h.style, { left: cx + 'px', top: cy + 'px', animationDuration: period + 's', animationDelay: (-elapsed).toFixed(2) + 's' });
      const bar = document.createElement('i');
      Object.assign(bar.style, { left: (-width / 2) + 'px', top: (-len) + 'px', width: width + 'px', height: (len + (tail || 0)) + 'px', borderRadius: width / 2 + 'px', background: color });
      h.appendChild(bar);
      wrap.appendChild(h);
    };
    hand('hr', r * spec.hr, spec.hw, 43200, hr, spec.color);
    hand('min', r * spec.min, spec.mw, 3600, min, spec.color);
    if (spec.sec) hand('sec', r * 0.96, 3, 60, sec, spec.sec, 26);
    const cap = document.createElement('div');
    cap.className = 'cap';
    Object.assign(cap.style, { left: (cx - 9) + 'px', top: (cy - 9) + 'px', background: spec.sec || spec.color, boxShadow: '0 0 0 3px ' + spec.color });
    wrap.appendChild(cap);
    this.root.appendChild(wrap);
  };

  function ticksSVG(cx, cy, r, color, numbersEvery) {
    let s = '<svg class="ticks" width="100%" height="100%">';
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30, big = i % 5 === 0;
      if (numbersEvery && i % 15 === 0) continue;
      const r0 = big ? r - 26 : r - 12;
      s += '<line x1="' + (cx + r0 * Math.sin(a)).toFixed(1) + '" y1="' + (cy - r0 * Math.cos(a)).toFixed(1) + '" x2="' + (cx + r * Math.sin(a)).toFixed(1) +
        '" y2="' + (cy - r * Math.cos(a)).toFixed(1) + '" stroke="' + color + '" stroke-width="' + (big ? 5 : 2) + '" stroke-linecap="round" opacity="' + (big ? 0.95 : 0.6) + '"/>';
    }
    return s + '</svg>';
  }

  function div(root, cls, style, html) {
    const el = document.createElement('div');
    el.className = cls;
    if (style) Object.assign(el.style, style);
    if (html != null) el.innerHTML = html;
    root.appendChild(el);
    return el;
  }
  const px = (v) => Math.round(v) + 'px';

  // ---- face layouts: 1024 x 768 (landscape) or 768 x 1024 (portrait) reference, scaled by L.k ----------
  // geo(): position helpers for the current orientation; pick(land, port) chooses the layout value.
  function geo(ctx) {
    const L = ctx.L, k = L.k;
    const ox = (L.W - L.RW * k) / 2, oy = (L.H - L.RH * k) / 2;
    return { k, P: L.portrait, X: (v) => ox + v * k, Y: (v) => oy + v * k, S: (v) => v * k,
      box: (x, y, w, h) => ({ x: ox + x * k, y: oy + y * k, w: w * k, h: h * k }),
      pick: (land, port) => (L.portrait ? port : land) };
  }

  const BUILD = {
    widgets(root) {
      const g = geo(this.ctx), P = this.parts;
      P.date = div(root, 'line big', { left: px(g.X(64)), top: px(g.Y(g.pick(54, 70))) });
      P.timeBox = g.pick(g.box(30, 100, 620, 330), g.box(40, 140, 688, 360));
      P.timeSize = g.S(g.pick(250, 250));
      P.wx = this.panel(g.pick(g.box(690, 100, 300, 200), g.box(40, 560, 334, 220)), 'p-weather');
      P.cl = this.panel(g.pick(g.box(690, 320, 300, 200), g.box(394, 560, 334, 220)), 'p-climate');
      P.li = this.panel(g.pick(g.box(40, 560, 950, 150), g.box(40, 806, 688, 170)), 'p-lights', { onTap: () => this.ctx.goTo(1) });
    },
    numerals() {
      const g = geo(this.ctx), P = this.parts;
      P.hBox = g.pick(g.box(112, 4, 800, 380), g.box(34, 70, 700, 440));
      P.mBox = g.pick(g.box(112, 384, 800, 380), g.box(34, 514, 700, 440));
      P.size = g.S(g.pick(400, 440));
    },
    single(root) {
      const g = geo(this.ctx), P = this.parts;
      P.wd = div(root, 'line center', { left: 0, right: 0, top: px(g.Y(g.pick(70, 130))), fontSize: px(g.S(46)), fontWeight: 700 });
      P.dBox = g.pick(g.box(112, 130, 800, 560), g.box(34, 220, 700, 640));
      P.size = g.S(g.pick(560, 600));
    },
    analog(root, f, lk) {
      const g = geo(this.ctx), P = this.parts;
      const cx = g.X(g.pick(512, 384)), cy = g.Y(g.pick(384, 512)), r = g.S(350);
      div(root, 'layer', null, ticksSVG(cx, cy, r, lk.ink, true));
      P.date = div(root, 'line center', { left: 0, right: 0, top: px(cy + g.S(120)), fontSize: px(g.S(26)), color: 'var(--muted)' });
      P.figs = [['12', cx, cy - r + g.S(92)], ['3', cx + r - g.S(80), cy], ['6', cx, cy + r - g.S(92)], ['9', cx - r + g.S(80), cy]];
      P.r = r; P.cx = cx; P.cy = cy;
    },
    bignum(root) {
      const g = geo(this.ctx), P = this.parts;
      // condensed figures overlapping round the centre (Apple's numerals face)
      P.figs = g.pick(
        [['12', g.X(512), g.Y(205)], ['9', g.X(300), g.Y(395)], ['3', g.X(724), g.Y(395)], ['6', g.X(512), g.Y(585)]],
        [['12', g.X(384), g.Y(300)], ['9', g.X(190), g.Y(520)], ['3', g.X(578), g.Y(520)], ['6', g.X(384), g.Y(740)]]);
      P.center = g.pick([g.X(512), g.Y(384)], [g.X(384), g.Y(512)]);
      P.handR = g.S(g.pick(330, 320));
      P.date = div(root, 'line', { left: px(g.X(60)), bottom: px(g.S(48)), fontSize: px(g.S(28)), fontWeight: 600 });
    },
    info(root, f, lk) {
      const g = geo(this.ctx), P = this.parts;
      P.wd = div(root, 'line', { left: px(g.X(70)), top: px(g.Y(g.pick(58, 70))), fontSize: px(g.S(40)), fontWeight: 700 });
      P.dBox = g.pick(g.box(40, 110, 470, 470), g.box(30, 120, 400, 420));
      P.size = g.S(g.pick(420, 380));
      const cx = g.X(g.pick(770, 585)), cy = g.Y(g.pick(285, 330)), r = g.S(g.pick(205, 160));
      let nums = '';
      for (let n = 1; n <= 12; n++) {
        const a = n * Math.PI / 6;
        nums += '<div class="dialnum" style="left:' + px(cx + (r - g.S(34)) * Math.sin(a) - 30) + ';top:' + px(cy - (r - g.S(34)) * Math.cos(a) - 20) + ';font-size:' + px(g.S(g.pick(30, 26))) + '">' + n + '</div>';
      }
      div(root, 'layer', null, ticksSVG(cx, cy, r, lk.ink, false) + nums);
      P.clock = { cx, cy, r };
      P.wx = div(root, 'info-wx', g.pick({ left: px(g.X(570)), top: px(g.Y(540)), width: px(g.S(410)) }, { left: px(g.X(70)), top: px(g.Y(640)), width: px(g.S(620)) }));
      P.next = div(root, 'info-next', g.pick({ left: px(g.X(70)), top: px(g.Y(610)), width: px(g.S(440)) }, { left: px(g.X(70)), top: px(g.Y(800)), width: px(g.S(620)) }));
    },
    weather(root) {
      const g = geo(this.ctx), P = this.parts;
      P.top = div(root, 'line center', { left: 0, right: 0, top: px(g.Y(g.pick(40, 70))), fontSize: px(g.S(30)), fontWeight: 600 });
      P.tBox = g.pick(g.box(212, 70, 600, 340), g.box(84, 110, 600, 380));
      P.size = g.S(g.pick(300, 330));
      P.sub = div(root, 'line center', { left: 0, right: 0, top: px(g.Y(g.pick(410, 500))), fontSize: px(g.S(26)), color: 'var(--muted)' });
      P.hp = this.panel(g.pick(g.box(92, 480, 840, 230), g.box(40, 600, 688, 240)), 'p-hourly');
      P.hours = g.pick(8, 6);
    },
    calendar(root) {
      const g = geo(this.ctx);
      this.parts.cal = div(root, 'cal', { left: px(g.X(g.pick(70, 40))), top: px(g.Y(g.pick(40, 60))), right: px(g.X(g.pick(70, 40))), bottom: px(g.S(g.pick(36, 80))) });
    },
  };

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => (n < 10 ? '0' : '') + n;

  function weatherInfo(ctx) {
    const s = ctx.weather();
    if (!s) return null;
    const today = ctx.forecast()[0];
    return { temp: Math.round(s.attributes.temperature), cond: s.state, name: (ctx.WX[s.state] || [s.state])[0],
      hi: today ? Math.round(today.temperature) : null, lo: today ? Math.round(today.templow) : null };
  }
  function climateInfo(ctx) {
    const spec = ctx.climateSpec();
    if (!spec || !ctx.ha) return null;
    const ok = (s) => s && s.state !== 'unavailable' && s.state !== 'unknown';
    const t = ctx.ha.get(spec.temperature), h = ctx.ha.get(spec.humidity);
    return { name: spec.name || '室内', temp: ok(t) ? Number(t.state).toFixed(1) : '--', hum: ok(h) ? Math.round(Number(h.state)) + '%' : '--' };
  }

  const UPDATE = {
    widgets(f) {
      const ctx = this.ctx, d = new Date(), P = this.parts;
      P.date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
      this.numeral('time', d.getHours() + ':' + pad(d.getMinutes()), P.timeBox, { size: P.timeSize, weight: 600 });
      const w = weatherInfo(ctx);
      P.wx.html(w ? '<div class="row"><div class="big">' + w.temp + '°</div><div class="wxi">' + ctx.wxIcon(w.cond, ctx.isDay(), 64) + '</div></div>' +
        '<div class="t">' + ctx.esc(w.name) + '</div><div class="s">' + (w.hi != null ? '最高 ' + w.hi + '° 最低 ' + w.lo + '°' : '') + '</div>' : '<div class="big">--°</div><div class="t">天气</div><div class="s">暂无数据</div>');
      const c = climateInfo(ctx);
      P.cl.html(c ? '<div class="t">' + ctx.esc(c.name) + '</div><div class="big">' + c.temp + '°</div><div class="s">湿度 ' + c.hum + '</div>' : '<div class="t">室内</div>');
      const on = ctx.lightsOn();
      P.li.html('<div class="li-icon">' + ctx.icon('bulb') + '</div><div class="li-text"><div class="t">灯光</div><div class="s">' +
        (on.length ? on.length + ' 盏开着 · ' + ctx.esc(on.slice(0, 3).join('、')) + (on.length > 3 ? ' 等' : '') : '全部关闭') + '</div></div><div class="li-go">' + ctx.icon('chevUp') + '</div>');
    },
    numerals() {
      const d = new Date(), P = this.parts;
      this.numeral('h', pad(d.getHours()), P.hBox, { size: P.size, weight: 700, sx: 0.92 });
      this.numeral('m', pad(d.getMinutes()), P.mBox, { size: P.size, weight: 700, sx: 0.92 });
    },
    single() {
      const d = new Date(), P = this.parts, k = this.ctx.L.k;
      P.wd.textContent = '星期' + WEEK[d.getDay()];
      this.numeral('d', String(d.getDate()), P.dBox, { size: P.size, weight: 700 });
    },
    analog(f, force) {
      const d = new Date(), P = this.parts, k = this.ctx.L.k;
      P.date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
      if (force) {
        for (const [n, x, y] of P.figs) this.numeral('f' + n, n, { x: x - 110 * k, y: y - 80 * k, w: 220 * k, h: 160 * k }, { size: 130 * k, weight: 600 });
        this.hands(P.cx, P.cy, P.r, { hr: 0.5, min: 0.82, hw: 16 * k, mw: 12 * k, color: this.look.ink, sec: '#ff9f0a' });
      }
    },
    bignum(f, force) {
      const d = new Date(), P = this.parts, k = this.ctx.L.k;
      P.date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
      if (force) {
        for (const [n, x, y] of P.figs) this.numeral('f' + n, n, { x: x - 210 * k, y: y - 190 * k, w: 420 * k, h: 380 * k }, { size: 360 * k, weight: 700, sx: 0.7 });
        this.hands(P.center[0], P.center[1], P.handR, { hr: 0.5, min: 0.86, hw: 17 * k, mw: 13 * k, color: '#ffffff', sec: '#ffffff' });
      }
    },
    info(f, force) {
      const ctx = this.ctx, d = new Date(), P = this.parts, k = ctx.L.k;
      P.wd.innerHTML = '星期' + WEEK[d.getDay()] + ' <span class="accent">' + (d.getMonth() + 1) + '月</span>';
      this.numeral('d', String(d.getDate()), P.dBox, { size: P.size, weight: 700 });
      if (force) this.hands(P.clock.cx, P.clock.cy, P.clock.r, { hr: 0.5, min: 0.8, hw: 12 * k, mw: 9 * k, color: this.look.ink, sec: '#ff9f0a' });
      const w = weatherInfo(ctx);
      P.wx.innerHTML = w ? '<div class="wxi">' + ctx.wxIcon(w.cond, ctx.isDay(), 54) + '</div><div><div class="big">' + w.temp + '°</div><div class="s">' +
        ctx.esc(w.name) + (w.hi != null ? ' · ' + w.hi + '° / ' + w.lo + '°' : '') + '</div></div>' : '';
      const c = climateInfo(ctx);
      P.next.innerHTML = c ? '<div class="s">' + ctx.esc(c.name) + '</div><div class="t">' + c.temp + '° · 湿度 ' + c.hum + '</div>' : '';
    },
    weather() {
      const ctx = this.ctx, P = this.parts, k = ctx.L.k;
      const w = weatherInfo(ctx);
      P.top.textContent = '我的家';
      this.numeral('t', (w ? w.temp : '--') + '°', P.tBox, { size: P.size, weight: 500 });
      P.sub.textContent = w ? w.name + (w.hi != null ? ' · 最高 ' + w.hi + '° 最低 ' + w.lo + '°' : '') : '天气暂无数据';
      const hours = ctx.hourly().slice(0, P.hours || 8);
      P.hp.html('<div class="hp-title">逐小时预报</div><div class="hours">' + hours.map((h, i) => {
        const t = new Date(h.datetime);
        const day = t.getHours() >= 6 && t.getHours() < 18;
        return '<div class="hr"><div class="s">' + (i === 0 ? '现在' : t.getHours() + '时') + '</div><div class="wxi">' + ctx.wxIcon(h.condition, day, 40) +
          '</div><div class="t">' + Math.round(h.temperature) + '°</div></div>';
      }).join('') + '</div>');
    },
    calendar() {
      const d = new Date(), P = this.parts;
      const y = d.getFullYear(), m = d.getMonth(), today = d.getDate();
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), prevDays = new Date(y, m, 0).getDate();
      const weeks = Math.ceil((first + days) / 7);
      let cells = '';
      for (let i = 0; i < weeks * 7; i++) {
        const n = i - first + 1;
        if (n < 1) cells += '<div class="c faded">' + (prevDays + n) + '</div>';
        else if (n > days) cells += '<div class="c faded">' + (n - days) + '</div>';
        else cells += '<div class="c' + (n === today ? ' today' : '') + (i % 7 === 0 || i % 7 === 6 ? ' we' : '') + '"><span>' + n + '</span></div>';
      }
      P.cal.innerHTML = '<div class="cal-head"><span class="red">' + (m + 1) + '月 ' + y + '</span><span class="red">' + d.getHours() + ':' + pad(d.getMinutes()) + '</span></div>' +
        '<div class="cal-week">' + WEEK.map((w) => '<div>' + w + '</div>').join('') + '</div><div class="cal-grid" style="grid-template-rows:repeat(' + weeks + ',1fr)">' + cells + '</div>';
    },
  };

  // ---- gallery: long press. The face shrinks; swipe for another face; edit below; tap to wear --------
  Faces.prototype.openGallery = function () {
    if (this.gallery) return;
    this.gallery = true;
    this.renderGallery();
    document.body.classList.add('gallery-open');
    this.ctx.log({ event: 'gallery_open' });
  };
  Faces.prototype.closeGallery = function () {
    if (!this.gallery) return;
    this.gallery = false;
    this.page.scale.to(1);
    this.page.ty.to(0);
    document.body.classList.remove('gallery-open');
    this.save();
  };
  Faces.prototype.step = function (dir) {
    const n = this.s.faces.length;
    this.s.index = (this.s.index + dir + n) % n;
    this.build(this.page);
    this.page.scale.set(0.5);       // a small pop as the new face arrives
    this.renderGallery();
    this.save();
  };
  Faces.prototype.edit = function (what, value) {
    const f = this.face();
    f[what] = value;
    this.build(this.page);
    this.renderGallery();
    this.save();
  };
  Faces.prototype.renderGallery = function () {
    const g = document.getElementById('gallery');
    const f = this.face();
    // the face shrinks out of the way of the controls (two more rows for photos)
    const photoRows = f.background === 'photo';
    this.page.scale.to(photoRows ? 0.5 : 0.6);
    this.page.ty.to((photoRows ? -150 : -96) * this.ctx.L.k);
    const pill = (kind, v, label, on) => '<button class="pill' + (on ? ' on' : '') + '" data-edit="' + kind + '" data-v="' + v + '">' + label + '</button>';
    g.innerHTML =
      '<div class="g-title">' + TYPES[f.type] + '<span>' + (this.s.index + 1) + ' / ' + this.s.faces.length + '</span></div>' +
      '<button class="g-arrow l" data-step="-1">‹</button><button class="g-arrow r" data-step="1">›</button>' +
      '<div class="g-bar">' +
      '<div class="g-row">' + BACKGROUNDS.map((b) => pill('background', b[0], b[1], f.background === b[0])).join('') + '</div>' +
      '<div class="g-row">' + NUMERALS.map((n) => pill('numerals', n[0], n[1], f.numerals === n[0])).join('') +
      '<span class="sep"></span><button class="pill done" data-done="1">完成</button></div>' +
      (f.background === 'photo' ? this.photoRows(f) : '') +
      '<div class="g-row colors">' + COLORS.map((c, i) => '<button class="dot' + (f.color === i ? ' on' : '') + '" data-edit="color" data-v="' + i + '" title="' + c[0] +
        '" style="background:rgb(' + c[1].join(',') + ')"></button>').join('') + '</div></div>';
    if (f.background === 'photo') this.fillThumbs();
  };

  // Photo rows: add (iPad photo picker, several at once), thumbnails to choose from, single / cycle.
  Faces.prototype.photoRows = function (f) {
    const photos = this.ctx.photos;
    const ids = photos ? photos.ids.slice().reverse() : [];       // newest first
    const pages = Math.max(1, Math.ceil(ids.length / THUMBS_PER_PAGE));
    this.thumbPage = Math.min(this.thumbPage || 0, pages - 1);
    const shown = ids.slice(this.thumbPage * THUMBS_PER_PAGE, (this.thumbPage + 1) * THUMBS_PER_PAGE);
    const chosen = new Set(f.photos || []);
    const cycle = f.photoMode === 'cycle';
    const pill = (attr, label, on) => '<button class="pill' + (on ? ' on' : '') + '" ' + attr + '>' + label + '</button>';
    let h = '<div class="g-row photos">' +
      '<button class="pill add" data-add="1">＋ 添加照片</button>' +
      (pages > 1 ? '<button class="pill" data-tpage="-1"' + (this.thumbPage === 0 ? ' disabled' : '') + '>‹</button>' : '') +
      shown.map((id) => '<button class="thumb' + (chosen.has(id) ? ' on' : '') + '" data-photo="' + id + '"><img alt=""></button>').join('') +
      (pages > 1 ? '<button class="pill" data-tpage="1"' + (this.thumbPage >= pages - 1 ? ' disabled' : '') + '>›</button>' : '') +
      (ids.length ? '' : '<span class="hint">从 iPad 相册选择照片</span>') +
      (this.importing ? '<span class="hint">' + this.importing + '</span>' : '') + '</div>';
    h += '<div class="g-row">' + pill('data-pmode="single"', '单张', !cycle) + pill('data-pmode="cycle"', '循环渐变', cycle) +
      (cycle ? '<span class="sep"></span>' + INTERVALS.map(([v, l]) => pill('data-pint="' + v + '"', l, (f.photoInterval || 60) === v)).join('') : '') +
      (chosen.size ? '<span class="sep"></span>' + pill('data-pdel="1"', this.confirmDelete ? '确认删除 ' + chosen.size + ' 张' : '删除所选', false) : '') + '</div>';
    return h;
  };
  Faces.prototype.fillThumbs = function () {
    const photos = this.ctx.photos;
    document.querySelectorAll('#gallery .thumb').forEach((b) => {
      photos.thumb(b.dataset.photo).then((url) => { const img = b.querySelector('img'); if (img) img.src = url; }).catch(() => {});
    });
  };
  Faces.prototype.pickPhotos = function () {
    let input = document.getElementById('photo-input');
    if (!input) {
      input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, id: 'photo-input' });
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = [...input.files];
        input.value = '';
        if (!files.length) return;
        const f = this.face();
        this.importing = '正在导入 0 / ' + files.length;
        this.renderGallery();
        const ids = await this.ctx.photos.importFiles(files, (d, n) => { this.importing = '正在导入 ' + d + ' / ' + n; if (this.gallery) this.renderGallery(); });
        this.importing = '';
        if (ids.length) {
          f.background = 'photo';
          if (f.photoMode === 'cycle') f.photos = [...new Set([...(f.photos || []), ...ids])];
          else { f.photos = [ids[0]]; if (ids.length > 1) { f.photoMode = 'cycle'; f.photos = ids; } }
          f.photoAt = f.photos[0];
          this.thumbPage = 0;
          this.build(this.page);
          this.save();
        }
        if (this.gallery) this.renderGallery();
      });
    }
    input.click();
  };
  Faces.prototype.photoClick = async function (b) {
    const f = this.face();
    f.photos = f.photos || [];
    if (b.dataset.photo) {
      const id = b.dataset.photo;
      if (f.photoMode === 'cycle') f.photos = f.photos.includes(id) ? f.photos.filter((x) => x !== id) : [...f.photos, id];
      else f.photos = [id];
      f.photoAt = id;
      this.confirmDelete = false;
    } else if (b.dataset.pmode) {
      f.photoMode = b.dataset.pmode;
      if (f.photoMode === 'single' && f.photos.length > 1) f.photos = [f.photoAt && f.photos.includes(f.photoAt) ? f.photoAt : f.photos[0]];
    } else if (b.dataset.pint) {
      f.photoInterval = Number(b.dataset.pint);
    } else if (b.dataset.tpage) {
      this.thumbPage = Math.max(0, (this.thumbPage || 0) + Number(b.dataset.tpage));
      this.renderGallery();
      return;
    } else if (b.dataset.pdel) {
      if (!this.confirmDelete) { this.confirmDelete = true; this.renderGallery(); setTimeout(() => { if (this.confirmDelete) { this.confirmDelete = false; if (this.gallery) this.renderGallery(); } }, 4000); return; }
      this.confirmDelete = false;
      const gone = f.photos.slice();
      await this.ctx.photos.remove(gone);
      for (const face of this.s.faces) if (face.photos) face.photos = face.photos.filter((x) => !gone.includes(x));
    }
    this.build(this.page);
    this.renderGallery();
    this.save();
  };
  Faces.prototype.galleryClick = function (target) {
    const b = target.closest('button');
    if (!b) return false;
    if (b.dataset.add) return true;                           // opened by the click listener (needs the user gesture)
    if (b.dataset.photo || b.dataset.pmode || b.dataset.pint || b.dataset.tpage || b.dataset.pdel) { this.photoClick(b); return true; }
    if (b.dataset.done) this.closeGallery();
    else if (b.dataset.step) this.step(Number(b.dataset.step));
    else if (b.dataset.edit) this.edit(b.dataset.edit, b.dataset.edit === 'color' ? Number(b.dataset.v) : b.dataset.v);
    return true;
  };

  window.HVFaces = Faces;
})();
