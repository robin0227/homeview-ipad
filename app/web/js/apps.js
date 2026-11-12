/* Apps for the iPad HomeView: Timer and Weather, opened full screen over
 * the pages (app.js zooms them in and out). Each app builds DOM and glass Tiles
 * into its page; glass numerals use the same text masks as the faces.
 *
 * Timer: state in localStorage (hv_timer) so it survives reloads; the alarm is
 * checked every second app-wide and opens the Timer when it fires.
 */
(function () {
  'use strict';

  const pad = (n) => (n < 10 ? '0' : '') + n;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const FONT = '"SF Pro Rounded", ui-rounded, -apple-system, "PingFang SC", system-ui, sans-serif';
  const ORANGE = [1, 0.62, 0.04];

  function el(root, cls, style, html) {
    const e = document.createElement('div');
    e.className = cls;
    if (style) Object.assign(e.style, style);
    if (html != null) e.innerHTML = html;
    root.appendChild(e);
    return e;
  }
  const px = (v) => Math.round(v) + 'px';

  function Apps(ctx) {
    this.ctx = ctx;
    this.timer = this.loadTimer();
    this.audio = null;
    this.ringing = false;
    setInterval(() => this.second(), 250);
  }

  Apps.prototype.list = function () {
    return [
      { id: 'weather', name: '天气', icon: 'wx_sun', bg: 'linear-gradient(160deg,#4a9cff,#1f5fd1)' },
      { id: 'timer', name: '计时器', icon: 'timer', bg: 'linear-gradient(160deg,#ffb340,#ff7a00)' },
      { id: 'faces', name: '表盘', icon: 'clock', bg: 'linear-gradient(160deg,#b58cff,#6a3fd6)' },
      { id: 'lights', name: '灯光', icon: 'bulb', bg: 'linear-gradient(160deg,#ffd60a,#ff9f0a)' },
    ];
  };

  /** Builds app `id` into `page`; returns {destroy, wallpaper}. */
  Apps.prototype.create = function (id, page) {
    const fn = BUILD[id];
    return fn ? fn.call(this, page) : null;
  };

  // A glass numeral for apps (same mask cache as the faces).
  Apps.prototype.numeral = function (page, state, name, text, box, size, weight) {
    const ctx = this.ctx;
    const part = state[name] || (state[name] = {});
    if (part.text === text) return;
    part.text = text;
    if (part.glass) { const i = page.texts.indexOf(part.glass); if (i >= 0) page.texts.splice(i, 1); }
    if (!ctx.glass) { part.el = part.el || el(page.el, 'numeral', { left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h), fontSize: px(size), fontWeight: weight }); part.el.textContent = text; return; }
    const mask = ctx.glass.textMask('a|' + text + '|' + size + '|' + weight + '|' + box.w + 'x' + box.h, box.w, box.h, (c, w, h) => {
      c.font = weight + ' ' + size + 'px ' + FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + size * 0.04);
    }, Math.max(3, size / 40));
    part.glass = { rect: box, mask, fill: [1, 1, 1], tintAmount: 0 };
    page.texts.push(part.glass);
    ctx.kick();
  };

  // ---- timer state, alarm -----------------------------------------------------------------------
  Apps.prototype.loadTimer = function () {
    try { return JSON.parse(localStorage.getItem('hv_timer') || 'null'); } catch (e) { return null; }
  };
  Apps.prototype.saveTimer = function () { try { localStorage.setItem('hv_timer', JSON.stringify(this.timer)); } catch (e) {} };
  /** Seconds left (fractional), or null without a timer. */
  Apps.prototype.left = function () {
    const t = this.timer;
    if (!t) return null;
    return t.paused ? t.left : Math.max(0, (t.end - Date.now()) / 1000);
  };
  Apps.prototype.start = function (seconds) {
    this.unlockAudio();
    this.timer = { duration: seconds, end: Date.now() + seconds * 1000, paused: false, left: seconds };
    this.saveTimer();
    this.ctx.log({ event: 'timer_start', seconds });
  };
  Apps.prototype.pause = function () {
    const t = this.timer;
    if (!t) return;
    if (t.paused) { t.end = Date.now() + t.left * 1000; t.paused = false; } else { t.left = this.left(); t.paused = true; }
    this.saveTimer();
  };
  Apps.prototype.cancel = function () { this.timer = null; this.saveTimer(); this.stopRing(); };

  Apps.prototype.unlockAudio = function () {
    try {
      if (!this.audio) this.audio = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audio.state === 'suspended') this.audio.resume();
    } catch (e) {}
  };
  Apps.prototype.beep = function () {
    const a = this.audio;
    if (!a) return;
    const t0 = a.currentTime;
    [0, 0.18, 0.36, 0.9, 1.08, 1.26].forEach((dt, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = i % 3 === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(0.35, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.16);
      o.connect(g); g.connect(a.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.18);
    });
  };
  Apps.prototype.stopRing = function () {
    this.ringing = false;
    clearInterval(this.ringTimer);
    document.body.classList.remove('alarm');
  };

  // Every 250 ms: the running timer's display, and the alarm.
  Apps.prototype.second = function () {
    const t = this.timer;
    if (t && !t.paused && !t.done && Date.now() >= t.end) {
      t.done = true;
      this.saveTimer();
      this.ringing = true;
      this.ctx.log({ event: 'timer_done', seconds: t.duration });
      this.ctx.openApp('timer');
      document.body.classList.add('alarm');
      this.beep();
      let n = 0;
      clearInterval(this.ringTimer);
      this.ringTimer = setInterval(() => { if (++n > 24 || !this.ringing) { this.stopRing(); return; } this.beep(); }, 2500);
    }
    if (this.onSecond) this.onSecond();
  };

  // ---- app builders --------------------------------------------------------------------------------
  const BUILD = {
    timer(page) {
      const ctx = this.ctx, k = ctx.L.k, W = ctx.L.W, H = ctx.L.H, self = this;
      const st = {};
      const root = el(page.el, 'app app-timer');
      const title = el(root, 'app-title', null, '计时器');
      // the ring: 64 capsules along the screen edge (inset 18 px, corners rounded)
      const N = 64, inset = 22 * k, rad = 70 * k;
      const path = edgePoints(W, H, inset, rad, N);
      let svg = '<svg class="ring" width="' + W + '" height="' + H + '">';
      path.forEach((p, i) => {
        const len = 16 * k;
        svg += '<line data-i="' + i + '" x1="' + (p.x - p.nx * len / 2).toFixed(1) + '" y1="' + (p.y - p.ny * len / 2).toFixed(1) + '" x2="' + (p.x + p.nx * len / 2).toFixed(1) + '" y2="' + (p.y + p.ny * len / 2).toFixed(1) + '"/>';
      });
      svg += '</svg>';
      const ring = el(root, 'layer', null, svg);
      const lines = ring.querySelectorAll('line');
      const label = el(root, 'timer-label', { left: 0, right: 0, top: px(H * 0.66) });
      const presets = [1, 3, 5, 10, 15, 20, 30, 45, 60];
      const pick = [];
      const bw = 210 * k, bh = 120 * k, gx = 24 * k, x0 = (W - 3 * bw - 2 * gx) / 2, y0 = 140 * k;
      presets.forEach((m, i) => {
        const t = new ctx.Tile(page, { x: x0 + (i % 3) * (bw + gx), y: y0 + Math.floor(i / 3) * (bh + gx), w: bw, h: bh }, 'preset', { r: 30 * k, onTap: () => { self.start(m * 60); render(true); } });
        t.html('<div class="big">' + m + '</div><div class="s">分钟</div>');
        pick.push(t);
      });
      const bw2 = 220 * k, by = H - 160 * k;
      const pauseBtn = new ctx.Tile(page, { x: W / 2 - bw2 - 14 * k, y: by, w: bw2, h: 84 * k }, 'btn', { r: 42 * k, onTap: () => { self.pause(); render(true); } });
      const cancelBtn = new ctx.Tile(page, { x: W / 2 + 14 * k, y: by, w: bw2, h: 84 * k }, 'btn', { r: 42 * k, onTap: () => { self.cancel(); render(true); } });
      const dismiss = new ctx.Tile(page, { x: W / 2 - 160 * k, y: by, w: 320 * k, h: 84 * k }, 'btn', { r: 42 * k, onTap: () => { self.cancel(); render(true); } });
      dismiss.html('<div class="t">关闭</div>');
      cancelBtn.html('<div class="t">取消</div>');
      const show = (t, on) => { t.glass = on; t.el.style.display = on ? '' : 'none'; };
      let mode = '';
      const render = (force) => {
        const left = self.left();
        const t = self.timer;
        const m = !t ? 'pick' : t.done ? 'done' : 'run';
        if (m !== mode || force) {
          mode = m;
          pick.forEach((p) => show(p, m === 'pick'));
          show(pauseBtn, m === 'run'); show(cancelBtn, m === 'run'); show(dismiss, m === 'done');
          ring.style.display = m === 'pick' ? 'none' : '';
          title.textContent = m === 'done' ? '时间到' : '计时器';
          if (m === 'pick') { for (const k2 in st) if (st[k2].glass) { const i = page.texts.indexOf(st[k2].glass); if (i >= 0) page.texts.splice(i, 1); st[k2].glass = null; st[k2].text = null; } }
          dismiss.setOn(m === 'done', ORANGE);
          ctx.kick();
        }
        label.style.top = px(m === 'pick' ? 78 * k : H * 0.26 + 310 * k);
        if (m === 'pick') { label.textContent = '选择时长'; return; }
        const secs = Math.ceil(left);
        const text = (secs >= 3600 ? Math.floor(secs / 3600) + ':' + pad(Math.floor(secs / 60) % 60) : Math.floor(secs / 60)) + ':' + pad(secs % 60);
        self.numeral(page, st, 'digits', m === 'done' ? '0:00' : text, { x: (W - Math.min(800 * k, W - 40 * k)) / 2, y: H * 0.26, w: Math.min(800 * k, W - 40 * k), h: 300 * k }, Math.min(260 * k, (W - 60 * k) / 3.3), 600);
        pauseBtn.html('<div class="t">' + (t.paused ? '继续' : '暂停') + '</div>');
        const end = new Date(t.end);
        label.textContent = m === 'done' ? (t.duration / 60) + ' 分钟计时结束' : t.paused ? '已暂停' : '结束于 ' + end.getHours() + ':' + pad(end.getMinutes());
        const frac = m === 'done' ? 0 : left / t.duration;
        const lit = Math.ceil(frac * N);
        lines.forEach((ln, i) => { const on = i < lit; if (ln._on !== on) { ln._on = on; ln.setAttribute('class', on ? 'on' : ''); } });
      };
      this.onSecond = () => render(false);
      render(true);
      return { destroy: () => { this.onSecond = null; }, wallpaper: { style: 3, tint: [0.12, 0.12, 0.13], animated: false } };
    },

    weather(page) {
      const ctx = this.ctx, k = ctx.L.k, W = ctx.L.W;
      const s = ctx.weather();
      const root = el(page.el, 'app app-weather');
      const st = {};
      if (!s) { el(root, 'app-title', null, '天气暂无数据'); return { destroy() {} }; }
      const a = s.attributes, day = ctx.isDay();
      const daily = ctx.forecast(), hours = ctx.hourly();
      const name = (ctx.WX[s.state] || [s.state])[0];
      el(root, 'w-city', { left: px(92 * k), top: px(28 * k) }, '我的家' + (a.source ? '<small> · ' + a.source + '</small>' : ''));
      this.numeral(page, st, 'temp', Math.round(a.temperature) + '°', { x: 20 * k, y: 70 * k, w: 470 * k, h: 200 * k }, 190 * k, 400);
      const today = daily[0];
      el(root, 'w-cond', { left: px(56 * k), top: px(270 * k) }, name + (today ? ' · 最高 ' + Math.round(today.temperature) + '° 最低 ' + Math.round(today.templow) + '°' : ''));
      // detail tiles
      const dir = (b) => b == null ? '' : ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(((b % 360) + 360) % 360 / 45) % 8] + '风';
      const details = [
        ['湿度', Math.round(a.humidity) + '%', a.dew_point != null ? '露点 ' + Math.round(a.dew_point) + '°' : ''],
        ['风', a.wind_speed != null ? Math.round(a.wind_speed) + '<small> km/h</small>' : '--', dir(a.wind_bearing)],
        ['气压', a.pressure != null ? Math.round(a.pressure) + '<small> hPa</small>' : '--', ''],
        ['紫外线', a.uv_index != null ? String(Math.round(a.uv_index)) : '--', a.uv_index == null ? '' : a.uv_index < 3 ? '低' : a.uv_index < 6 ? '中等' : a.uv_index < 8 ? '高' : '很高'],
      ];
      const port = ctx.L.portrait, g = 16 * k;
      // landscape: 2 x 2 tiles top right; portrait: a row of 4 under the temperature
      const dw = port ? (W - 80 * k - 3 * g) / 4 : 222 * k, dh = port ? 128 * k : 132 * k, dx0 = port ? 40 * k : 524 * k, dy0 = port ? 320 * k : 40 * k;
      const perRow = port ? 4 : 2;
      details.forEach((d, i) => {
        const t = new ctx.Tile(page, { x: dx0 + (i % perRow) * (dw + g), y: dy0 + Math.floor(i / perRow) * (dh + g), w: dw, h: dh }, 'panel w-detail', { r: 26 * k });
        t.html('<div class="s">' + d[0] + '</div><div class="big">' + d[1] + '</div><div class="s">' + d[2] + '</div>');
      });
      // hourly
      const hp = new ctx.Tile(page, { x: 40 * k, y: (port ? 476 : 336) * k, w: W - 80 * k, h: (port ? 200 : 180) * k }, 'panel p-hourly', { r: 30 * k });
      hp.html('<div class="hp-title">逐小时预报</div><div class="hours">' + hours.slice(0, port ? 8 : 12).map((h, i) => {
        const t = new Date(h.datetime), dd = t.getHours() >= 6 && t.getHours() < 18;
        return '<div class="hr"><div class="s">' + (i === 0 ? '现在' : t.getHours() + '时') + '</div><div class="wxi">' + ctx.wxIcon(h.condition, dd, 36) + '</div><div class="t">' + Math.round(h.temperature) + '°</div></div>';
      }).join('') + '</div>');
      // daily with range bars
      const lo = Math.min(...daily.map((d) => d.templow)), hi = Math.max(...daily.map((d) => d.temperature));
      const dp = new ctx.Tile(page, { x: 40 * k, y: (port ? 692 : 532) * k, w: W - 80 * k, h: (port ? 290 : 206) * k }, 'panel p-daily', { r: 30 * k });
      dp.html('<div class="hp-title">' + daily.length + ' 日预报</div><div class="days">' + daily.slice(0, 7).map((d, i) => {
        const t = new Date(d.datetime);
        const span = Math.max(1, hi - lo), l = (d.templow - lo) / span * 100, w = (d.temperature - d.templow) / span * 100;
        return '<div class="day"><div class="s">' + (i === 0 ? '今天' : '周' + WEEK[t.getDay()]) + '</div><div class="wxi">' + ctx.wxIcon(d.condition, true, 30) + '</div>' +
          '<div class="t">' + Math.round(d.temperature) + '°</div><div class="bar"><i style="bottom:' + l.toFixed(0) + '%;height:' + Math.max(8, w).toFixed(0) + '%"></i></div><div class="s">' + Math.round(d.templow) + '°</div></div>';
      }).join('') + '</div>');
      // sky colour by condition
      const cond = s.state;
      const tint = !day ? [0.10, 0.16, 0.36] : /rain|pour|light/.test(cond) ? [0.36, 0.44, 0.56] : /cloud|fog/.test(cond) ? [0.48, 0.58, 0.72] : [0.22, 0.5, 0.95];
      return { destroy() {}, wallpaper: { style: day ? 0 : 1, tint, animated: true } };
    },
  };

  // Points along a rounded rectangle inset from the screen edge, with outward normals.
  function edgePoints(W, H, inset, r, n) {
    const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
    const segs = [];
    const line = (ax, ay, bx, by, nx, ny) => segs.push({ len: Math.hypot(bx - ax, by - ay), at: (t) => ({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx, ny }) });
    const arc = (cx, cy, a0) => segs.push({ len: r * Math.PI / 2, at: (t) => { const a = a0 + t * Math.PI / 2; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) }; } });
    // clockwise from the top centre
    line(W / 2, y0, x1 - r, y0, 0, -1); arc(x1 - r, y0 + r, -Math.PI / 2);
    line(x1, y0 + r, x1, y1 - r, 1, 0); arc(x1 - r, y1 - r, 0);
    line(x1 - r, y1, x0 + r, y1, 0, 1); arc(x0 + r, y1 - r, Math.PI / 2);
    line(x0, y1 - r, x0, y0 + r, -1, 0); arc(x0 + r, y0 + r, Math.PI);
    line(x0 + r, y0, W / 2, y0, 0, -1);
    const total = segs.reduce((s, g) => s + g.len, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let d = (i + 0.5) / n * total;
      for (const g of segs) { if (d <= g.len) { out.push(g.at(d / g.len)); break; } d -= g.len; }
    }
    return out;
  }

  window.HVApps = Apps;
})();
