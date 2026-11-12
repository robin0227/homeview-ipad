/* Home Assistant WebSocket client: auth, full state, state_changed
 * subscription, services (optionally with a response), areas, ping and
 * reconnect. The iPad talks to HA directly; nothing in between.
 */
(function () {
  'use strict';

  function HA(url, token) {
    this.url = url.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket';
    this.token = token;
    this.states = {};
    this.areas = {};          // entity_id -> area name
    this.status = 'idle';     // idle | connecting | ready | closed | auth_invalid
    this.version = '';
    this.listeners = { state: [], status: [] };
    this.nextId = 1;
    this.pending = {};
    this.subs = {};           // id -> event callback (subscriptions other than state_changed)
    this.backoff = 1000;
  }

  HA.prototype.on = function (ev, fn) { this.listeners[ev].push(fn); };
  HA.prototype.emit = function (ev, a, b) { for (const fn of this.listeners[ev]) { try { fn(a, b); } catch (e) { console.error(e); } } };
  HA.prototype.setStatus = function (s) { this.status = s; this.emit('status', s); };

  HA.prototype.connect = function () {
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      for (const id in this.pending) this.pending[id].reject(new Error('closed'));
      this.pending = {};
      if (this.status === 'auth_invalid') return;
      this.setStatus('closed');
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15000);
    };
  };

  HA.prototype.send = function (msg) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) { reject(new Error('not connected')); return; }
      const id = this.nextId++;
      msg.id = id;
      this.pending[id] = { resolve, reject, t: performance.now() };
      this.ws.send(JSON.stringify(msg));
    });
  };

  HA.prototype.onMessage = function (m) {
    if (m.type === 'auth_required') { this.version = m.ha_version; this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token })); return; }
    if (m.type === 'auth_invalid') { this.setStatus('auth_invalid'); this.ws.close(); return; }
    if (m.type === 'auth_ok') { this.backoff = 1000; this.ready(); return; }
    if (m.type === 'event' && this.subs[m.id]) { try { this.subs[m.id](m.event); } catch (e) { console.error(e); } return; }
    if (m.type === 'event' && m.event) {
      if (m.event.event_type === 'state_changed') {
        const d = m.event.data;
        if (d.new_state) this.states[d.entity_id] = d.new_state; else delete this.states[d.entity_id];
        this.emit('state', d.entity_id, d.new_state);
        return;
      }
    }
    const p = this.pending[m.id];
    if (p) {
      delete this.pending[m.id];
      if (m.type === 'result' && m.success === false) p.reject(Object.assign(new Error(m.error && m.error.message || 'failed'), { code: m.error && m.error.code }));
      else p.resolve(m.type === 'result' ? m.result : m);
    }
  };

  HA.prototype.ready = async function () {
    const list = await this.send({ type: 'get_states' });
    this.states = {};
    for (const e of list) this.states[e.entity_id] = e;
    await this.send({ type: 'subscribe_events', event_type: 'state_changed' });
    try { this.config = await this.send({ type: 'get_config' }); } catch (e) { this.config = null; }   // home location etc.
    this.loadAreas();
    this.pingTimer = setInterval(() => { this.send({ type: 'ping' }).catch(() => {}); }, 20000);
    this.setStatus('ready');
    this.emit('state', '*', null);
  };

  /** entity_id -> area name, through a one-off template (entity area, else its device's). */
  HA.prototype.loadAreas = function () {
    const tpl = '{% for s in states %}{% set a = area_name(s.entity_id) %}{% if a %}{{ s.entity_id }}\t{{ a }}\n{% endif %}{% endfor %}';
    const id = this.nextId++;
    const done = (text) => {
      const out = {};
      for (const line of String(text || '').split('\n')) {
        const i = line.indexOf('\t');
        if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
      }
      this.areas = out;
      this.emit('state', '*', null);
    };
    // render_template answers with a result, then an event carrying the text; unsubscribe after it.
    this.pending[id] = { resolve: () => {}, reject: () => {} };
    const handler = (m) => {
      if (m.id === id && m.type === 'event' && m.event && m.event.result != null) {
        done(m.event.result);
        this.ws.removeEventListener('message', wrapped);
        this.send({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
      }
    };
    const wrapped = (ev) => handler(JSON.parse(ev.data));
    this.ws.addEventListener('message', wrapped);
    this.ws.send(JSON.stringify({ id, type: 'render_template', template: tpl, timeout: 10 }));
  };

  /** A subscription command (e.g. camera/webrtc/offer): onEvent gets each event; returns {id, done}. */
  HA.prototype.subscribe = function (msg, onEvent) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('not connected'));
    const id = this.nextId;
    this.subs[id] = onEvent;
    return this.send(msg).then(() => ({ id, close: () => { delete this.subs[id]; this.send({ type: 'unsubscribe_events', subscription: id }).catch(() => {}); } }),
      (e) => { delete this.subs[id]; throw e; });
  };

  HA.prototype.call = function (domain, service, entityId, data, wantResponse) {
    const msg = { type: 'call_service', domain, service, service_data: data || {}, target: entityId ? { entity_id: entityId } : undefined };
    if (wantResponse) msg.return_response = true;
    return this.send(msg);
  };

  /** Daily forecast for a weather entity: [{datetime, condition, temperature, templow, ...}]. */
  HA.prototype.forecast = async function (entityId, type) {
    const r = await this.call('weather', 'get_forecasts', entityId, { type: type || 'daily' }, true);
    const resp = r && r.response && r.response[entityId];
    return resp ? resp.forecast || [] : [];
  };

  HA.prototype.get = function (id) { return this.states[id]; };

  /** "左灯  灯" -> "左灯", "甜甜圈  开关 开关" -> "甜甜圈": Xiaomi names repeat the service after two spaces. */
  HA.cleanName = function (s) {
    s = String(s || '');
    const i = s.search(/\s{2,}/);
    return (i > 0 ? s.slice(0, i) : s).trim();
  };
  /** "我的家 客厅" -> "客厅" */
  HA.cleanArea = function (s) {
    s = String(s || '').trim();
    const parts = s.split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : s;
  };

  window.HA = HA;
})();
