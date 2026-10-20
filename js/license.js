/* 离线签名激活码：公钥验签 + 单机绑定，收钱发码在应用外完成。 */
(function () {
  'use strict';
  window.HB = window.HB || {};

  var PUBLIC_KEY_SPKI = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAECPkqWvKLNFdTGv2zbuUOcxR/Y4RB8N0iK8vgMOyLrxOVh8bQgXjSwzhSbwC9RnFA42wgAvVe4hnc1sG+fOe6+w==';
  var STORAGE_KEY = 'hundred-board-license-v1';
  var MACHINE_KEY = 'hundred-board-machine-v1';
  var record = null;
  var active = false;
  var reason = '';
  var machinePromise = null;
  var keyPromise = null;

  function bytesFromBase64(text) {
    var raw = atob(text);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function base64FromBytes(bytes) {
    var raw = '';
    for (var i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
    return btoa(raw);
  }

  function fromBase64Url(text) {
    return bytesFromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  }

  function toBase64Url(bytes) {
    return base64FromBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function publicKey() {
    if (!keyPromise) {
      keyPromise = crypto.subtle.importKey('spki', bytesFromBase64(PUBLIC_KEY_SPKI),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    }
    return keyPromise;
  }

  function machineId() {
    if (!machinePromise) {
      machinePromise = (async function () {
        if (window.HB_HOST && typeof window.HB_HOST.machineId === 'function') {
          try {
            var host = await window.HB_HOST.machineId();
            if (typeof host === 'string' && host.length >= 16) return host;
          } catch (e) { /* 主进程不可用时退回本地随机标识 */ }
        }
        var saved = localStorage.getItem(MACHINE_KEY);
        if (!saved) {
          saved = toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
          localStorage.setItem(MACHINE_KEY, saved);
        }
        return saved;
      })();
    }
    return machinePromise;
  }

  function parse(code) {
    if (typeof code !== 'string') throw new Error('激活码格式不正确');
    var clean = code.trim().replace(/\s+/g, '');
    var dot = clean.lastIndexOf('.');
    if (dot < 0) throw new Error('激活码格式不正确');
    var payload = JSON.parse(new TextDecoder().decode(fromBase64Url(clean.slice(0, dot))));
    if (!payload || typeof payload !== 'object' || payload.v !== 1 ||
        typeof payload.s !== 'string' || !payload.s.length || payload.s.length > 64 ||
        typeof payload.b !== 'string' || payload.b.length > 64 ||
        !Number.isInteger(payload.d)) throw new Error('激活码格式不正确');
    if ('m' in payload && (typeof payload.m !== 'string' || !payload.m.length || payload.m.length > 128)) {
      throw new Error('激活码格式不正确');
    }
    return { payload: payload, sig: fromBase64Url(clean.slice(dot + 1)), code: clean };
  }

  async function verify(parsed) {
    var encoded = new TextEncoder().encode(JSON.stringify(parsed.payload));
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(), parsed.sig, encoded);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }

  function status() {
    return {
      active: active,
      reason: reason,
      serial: record ? record.payload.s : '',
      batch: record ? record.payload.b : '',
      machineId: record ? record.machineId : ''
    };
  }

  async function adopt(parsed, machine) {
    if (!await verify(parsed)) throw new Error('激活码签名校验失败');
    if (parsed.payload.m && parsed.payload.m !== machine) throw new Error('该激活码绑定的是另一台设备');
    record = { payload: parsed.payload, sig: toBase64Url(parsed.sig), machineId: machine };
    active = true;
    reason = '';
    persist();
    return status();
  }

  async function load() {
    var machine = await machineId();
    record = null;
    active = false;
    reason = '';
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return status();
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return status(); }
    if (!saved || typeof saved !== 'object' || typeof saved.sig !== 'string' ||
        !saved.payload || saved.payload.v !== 1) return status();
    var parsed;
    try { parsed = { payload: saved.payload, sig: fromBase64Url(saved.sig) }; }
    catch (e) { reason = 'invalid'; return status(); }
    if (saved.machineId !== machine || (saved.payload.m && saved.payload.m !== machine)) {
      record = { payload: saved.payload, sig: saved.sig, machineId: saved.machineId };
      reason = 'machine';
      return status();
    }
    if (!await verify(parsed)) { reason = 'invalid'; return status(); }
    record = { payload: saved.payload, sig: saved.sig, machineId: machine };
    active = true;
    return status();
  }

  async function activate(code) {
    return adopt(parse(code), await machineId());
  }

  function isFree(id) {
    return HB.levels ? HB.levels.isFree(id) : id <= 20;
  }

  function canPlay(id) {
    return isFree(id) || active;
  }

  function exportFile() {
    if (!record) throw new Error('本机还没有激活记录');
    return JSON.stringify({ app: 'hundred-board-license', version: 1, record: record,
      exportedAt: new Date().toISOString() }, null, 2);
  }

  async function importFile(text) {
    var data = JSON.parse(text);
    var saved = data && data.record;
    if (!saved || typeof saved !== 'object' || typeof saved.sig !== 'string') throw new Error('授权文件格式不正确');
    var machine = await machineId();
    if (saved.machineId !== machine) throw new Error('该授权文件绑定的是另一台设备');
    return adopt({ payload: saved.payload, sig: fromBase64Url(saved.sig) }, machine);
  }

  HB.license = {
    load: load,
    activate: activate,
    status: status,
    canPlay: canPlay,
    isFree: isFree,
    exportFile: exportFile,
    importFile: importFile,
    machineId: machineId
  };
})();
