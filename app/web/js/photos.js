/* Photo library for face backgrounds.
 *
 * Photos are picked with <input type=file multiple> (the iPad's photo picker),
 * scaled on the iPad to 1600 px on the long side (plus a 240 px thumbnail) and
 * stored by the native shell under Documents/photos (files.* bridge). The page
 * reads them back as data URLs (file:// images would taint WebGL).
 * Outside the app (Mac preview) an in-memory store stands in.
 */
(function () {
  'use strict';

  // ---- native bridge with replies -----------------------------------------------------------------
  const HVNative = {
    seq: 1, cb: {},
    available() { try { return !!window.webkit.messageHandlers.native; } catch (e) { return false; } },
    call(cmd, args) {
      return new Promise((resolve, reject) => {
        const id = this.seq++;
        this.cb[id] = { resolve, reject };
        try { window.webkit.messageHandlers.native.postMessage(Object.assign({ cmd, id }, args || {})); }
        catch (e) { delete this.cb[id]; reject(e); }
        setTimeout(() => { if (this.cb[id]) { delete this.cb[id]; reject(new Error('timeout')); } }, 20000);
      });
    },
    _reply(r) {
      const c = this.cb[r.id];
      if (!c) return;
      delete this.cb[r.id];
      if (r.ok) c.resolve(r.result); else c.reject(new Error(String(r.result)));
    },
  };
  window.HVNative = HVNative;

  const mem = new Map();          // Mac preview store: name -> base64
  const store = {
    list: () => (HVNative.available() ? HVNative.call('files.list', { dir: 'photos' }) : Promise.resolve([...mem.keys()].sort())),
    write: (name, data) => (HVNative.available() ? HVNative.call('files.write', { dir: 'photos', name, data }) : Promise.resolve(mem.set(name, data))),
    read: (name) => (HVNative.available() ? HVNative.call('files.read', { dir: 'photos', name }) : Promise.resolve(mem.get(name))),
    remove: (name) => (HVNative.available() ? HVNative.call('files.delete', { dir: 'photos', name }) : Promise.resolve(mem.delete(name))),
  };

  function Photos(log) {
    this.log = log || (() => {});
    this.ids = [];                // library, oldest first
    this.full = new Map();        // id -> HTMLImageElement (a few)
    this.thumbs = new Map();      // id -> data URL
    this.ready = this.refresh();
  }

  Photos.prototype.refresh = async function () {
    try {
      const names = await store.list();
      this.ids = names.filter((n) => /^p[a-z0-9]+\.jpg$/.test(n)).map((n) => n.slice(0, -4));
    } catch (e) { this.log({ event: 'photos_error', op: 'list', message: String(e.message || e) }); }
    return this.ids;
  };

  /** Full-size image for a face background (kept for the last 3 ids used). */
  Photos.prototype.image = async function (id) {
    if (this.full.has(id)) { const img = this.full.get(id); this.full.delete(id); this.full.set(id, img); return img; }
    const b64 = await store.read(id + '.jpg');
    const img = await loadImage('data:image/jpeg;base64,' + b64);
    img._id = id;
    this.full.set(id, img);
    while (this.full.size > 3) this.full.delete(this.full.keys().next().value);
    return img;
  };

  Photos.prototype.thumb = async function (id) {
    if (this.thumbs.has(id)) return this.thumbs.get(id);
    const b64 = await store.read(id + '.t.jpg');
    const url = 'data:image/jpeg;base64,' + b64;
    this.thumbs.set(id, url);
    return url;
  };

  // onload with a timeout: img.decode() can wait forever on a page that is not being drawn
  function loadImage(src, ms) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const t = setTimeout(() => reject(new Error('image load timeout')), ms || 15000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); reject(new Error('image load failed')); };
      img.src = src;
    });
  }
  Photos.loadImage = loadImage;

  function scaled(img, maxSide, quality) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality).split(',')[1];
  }

  /** Imports picked files; returns the new ids. onProgress(done, total). */
  Photos.prototype.importFiles = async function (files, onProgress) {
    const out = [];
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    for (let i = 0; i < list.length; i++) {
      const url = URL.createObjectURL(list[i]);
      try {
        const img = await loadImage(url);
        const id = await this.importImage(img, i);
        out.push(id);
      } catch (e) {
        this.log({ event: 'photos_error', op: 'import', name: list[i].name, message: String(e.message || e) });
      } finally {
        URL.revokeObjectURL(url);
      }
      if (onProgress) onProgress(i + 1, list.length);
    }
    this.log({ event: 'photos_imported', count: out.length, of: list.length });
    return out;
  };

  /** Stores one decoded image (also used by the Mac preview's test pictures). */
  Photos.prototype.importImage = async function (img, n) {
    const id = 'p' + Date.now().toString(36) + (n || 0).toString(36);
    await store.write(id + '.jpg', scaled(img, 1600, 0.86));
    const thumb = scaled(img, 240, 0.8);
    await store.write(id + '.t.jpg', thumb);
    this.thumbs.set(id, 'data:image/jpeg;base64,' + thumb);
    this.ids.push(id);
    return id;
  };

  Photos.prototype.remove = async function (ids) {
    for (const id of ids) {
      await store.remove(id + '.jpg').catch(() => {});
      await store.remove(id + '.t.jpg').catch(() => {});
      this.full.delete(id); this.thumbs.delete(id);
    }
    this.ids = this.ids.filter((x) => !ids.includes(x));
  };

  window.HVPhotos = Photos;
})();
