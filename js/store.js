(function () {
  'use strict';
  window.HB = window.HB || {};

  var LEGACY_KEY = 'hundred-board-save-v1';
  var SELECTED_KEY = 'currentPlayerId';
  var MIGRATED_KEY = 'legacyMigrated';
  var MAX_SCORE = 1000000000;
  var db = null;
  var ready = false;
  var initialization = null;
  var activeId = '';
  var queue = Promise.resolve();
  var pending = 0;
  var failure = null;

  function own(object, key) {
    return object && typeof object === 'object' && !Array.isArray(object) &&
      Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
  }

  function integer(value, min, max, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ?
      Math.max(min, Math.min(max, Math.floor(value))) : fallback;
  }

  function levelCount() {
    return integer(HB.levels && HB.levels.total, 1, 10000, 1);
  }

  function text(value, max, fallback) {
    if (typeof value !== 'string') return fallback;
    return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, '').trim())
      .slice(0, max).join('') || fallback;
  }

  function validId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) &&
      id !== '__proto__' && id !== 'constructor' && id !== 'prototype';
  }

  function newId() {
    var bytes = new Uint32Array(4);
    window.crypto.getRandomValues(bytes);
    return 'p-' + Array.from(bytes, function (n) { return n.toString(16); }).join('-');
  }

  function sanitize(raw, id) {
    var total = levelCount();
    var version = integer(HB.levels && HB.levels.progressVersion, 1, 10000, 1);
    var rawVersion = integer(own(raw, 'progressVersion'), 1, 10000, 1);
    // 先按存档版本校验范围，再依次插关，避免无效旧关卡变成有效进度。
    var sourceTotal = rawVersion < 2 ? 200 : rawVersion < 3 ? 210 : total;
    function mapLevel(level) {
      if (version >= 2 && rawVersion < 2 && level > 20) level += 10;
      if (version >= 3 && rawVersion < 3 && level > 35) level += 5;
      if (version >= 4 && rawVersion < 4) {
        if (level >= 116 && level <= 135) level -= 55;
        else if (level >= 61 && level <= 115) level += 20;
      }
      return level;
    }
    var unlocked = integer(own(raw, 'unlocked'), 1, sourceTotal, 1);
    var currentLevel = integer(own(raw, 'currentLevel'), 1, sourceTotal, 1);
    var sourceStars = own(raw, 'stars');
    var settings = own(raw, 'settings');
    var material = own(settings, 'material');
    var stars = {}, mappedUnlocked = 1;
    for (var i = 1; i <= sourceTotal; i++) {
      var value = integer(own(sourceStars, String(i)), 0, 3, 0);
      var level = mapLevel(i);
      if (value && level <= total) stars[level] = value;
      // 线性解锁范围取旧前缀映射的最大值，避免章节重排后重新锁住已开放的关卡。
      if (i <= unlocked) mappedUnlocked = Math.max(mappedUnlocked, level);
    }
    var player = {
      id: id,
      progressVersion: Math.max(version, rawVersion),
      name: text(own(raw, 'name'), 8, text(own(raw, 'nickname'), 8, '小玩家')),
      avatar: text(own(raw, 'avatar'), 16, '\uD83D\uDC3B'),
      score: integer(own(raw, 'score'), 0, MAX_SCORE, 0),
      unlocked: Math.min(total, mappedUnlocked),
      currentLevel: Math.min(total, mapLevel(currentLevel)),
      stars: stars,
      settings: {
        material: ['wood', 'acrylic', 'macaron', 'starry'].indexOf(material) >= 0 ? material : 'wood',
        sound: typeof own(settings, 'sound') === 'boolean' ? own(settings, 'sound') : true,
        motion: own(settings, 'motion') === 'lite' ? 'lite' : 'full'
      }
    };
    if (own(raw, 'deactivated') === true) player.deactivated = true;
    if (total > 215 && player.unlocked === 215 && stars[215]) player.unlocked = 216;
    return player;
  }

  function isDeactivated(player) {
    return player && player.deactivated === true;
  }

  var data = sanitize({}, '');
  var players = [];

  function apply(player) {
    activeId = player.id;
    data.id = player.id;
    data.progressVersion = player.progressVersion;
    data.name = player.name;
    data.avatar = player.avatar;
    data.score = player.score;
    data.unlocked = player.unlocked;
    data.currentLevel = player.currentLevel;
    data.stars = player.stars;
    data.settings = player.settings;
  }

  function updatePlayer(player) {
    var index = players.findIndex(function (p) { return p.id === player.id; });
    var summary = { id: player.id, name: player.name, avatar: player.avatar };
    if (isDeactivated(player)) summary.deactivated = true;
    if (index < 0) players.push(summary);
    else players[index] = summary;
  }

  function removePlayer(id) {
    var index = players.findIndex(function (player) { return player.id === id; });
    if (index >= 0) players.splice(index, 1);
  }

  function ignore() {}

  function notify(status) {
    store.status = status;
    store.error = failure;
    if (typeof store.onStatus === 'function') {
      try { Promise.resolve(store.onStatus(status, failure)).catch(ignore); } catch (e) {}
    }
  }

  function fail(error) {
    failure = error && typeof error.message === 'string' ? error : new Error('本地存档操作失败');
    notify('error');
    return failure;
  }

  function requireReady() {
    if (!ready) throw failure || new Error('本地存档尚未初始化，请重新加载页面');
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('本地存档请求失败')); };
    });
  }

  async function transaction(stores, action) {
    var tx = db.transaction(stores, 'readwrite');
    var completed = new Promise(function (resolve, reject) {
      tx.oncomplete = resolve;
      tx.onabort = function () { reject(tx.error || new Error('本地存档事务已取消')); };
      tx.onerror = ignore;
    });
    completed.catch(ignore);
    try {
      var result = await action(tx);
      await completed;
      return result;
    } catch (error) {
      try { tx.abort(); } catch (e) {}
      await completed.catch(ignore);
      throw error;
    }
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('此环境无法使用 IndexedDB 本地存档'));
        return;
      }
      var request = window.indexedDB.open('hundred-board-db', 1);
      var rejected = false;
      request.onupgradeneeded = function () {
        if (rejected) {
          request.transaction.abort();
          return;
        }
        var database = request.result;
        database.createObjectStore('players', { keyPath: 'id' });
        database.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onblocked = function () {
        rejected = true;
        reject(new Error('本地存档被其他窗口占用，请关闭其他游戏窗口后重新加载'));
      };
      request.onerror = function () {
        rejected = true;
        reject(request.error || new Error('无法打开本地存档'));
      };
      request.onsuccess = function () {
        if (rejected) request.result.close();
        else resolve(request.result);
      };
    });
  }

  function legacyData() {
    var raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }

  function init() {
    if (initialization) return initialization;
    notify('loading');
    initialization = (async function () {
      try {
        db = await openDatabase();
        db.onversionchange = function () {
          db.close();
          ready = false;
          fail(new Error('本地存档版本已变化，请重新加载页面'));
        };
        db.onclose = function () {
          ready = false;
          fail(new Error('本地存档连接已关闭，请重新加载页面'));
        };
        var loaded = await transaction(['players', 'meta'], async function (tx) {
          var table = tx.objectStore('players');
          var meta = tx.objectStore('meta');
          var values = await Promise.all([
            requestResult(table.getAll()),
            requestResult(meta.get(SELECTED_KEY)),
            requestResult(meta.get(MIGRATED_KEY))
          ]);
          var profiles = values[0].map(function (raw) {
            var id = own(raw, 'id');
            if (!validId(id)) throw new Error('本地玩家编号无效，无法安全载入存档');
            return sanitize(raw, id);
          });
          if (!profiles.length) {
            var source = own(values[2], 'value') === true ? {} : legacyData();
            profiles.push(sanitize(source, newId()));
          }
          var activeProfiles = profiles.filter(function (player) { return !isDeactivated(player); });
          if (!activeProfiles.length) {
            var replacement = sanitize({}, newId());
            profiles.push(replacement);
            activeProfiles.push(replacement);
          }
          var selectedId = own(values[1], 'value');
          var selected = activeProfiles.find(function (p) { return p.id === selectedId; }) || activeProfiles[0];
          var writes = profiles.map(function (p) { return requestResult(table.put(p)); });
          writes.push(requestResult(meta.put({ key: SELECTED_KEY, value: selected.id })));
          writes.push(requestResult(meta.put({ key: MIGRATED_KEY, value: true })));
          await Promise.all(writes);
          return { profiles: profiles, selected: selected };
        });
        players.length = 0;
        loaded.profiles.forEach(updatePlayer);
        apply(loaded.selected);
        ready = true;
        failure = null;
        notify('saved');
        return data;
      } catch (error) {
        ready = false;
        if (db) db.close();
        throw fail(error);
      }
    })();
    initialization.catch(ignore);
    return initialization;
  }

  function enqueue(action, retry) {
    pending++;
    var operation = queue.then(async function () {
      requireReady();
      if (failure && !retry) throw failure;
      var previousFailure = failure;
      var result = await action();
      requireReady();
      if (retry && failure === previousFailure) failure = null;
      return result;
    });
    queue = operation.then(function () {
      pending--;
      notify(failure ? 'error' : pending ? 'saving' : 'saved');
    }, function (error) {
      pending--;
      fail(error);
    });
    notify(failure && !retry ? 'error' : 'saving');
    return operation;
  }

  function save() {
    try {
      requireReady();
      var snapshot = sanitize(data, activeId);
      updatePlayer(snapshot);
      enqueue(function () {
        return transaction(['players'], function (tx) {
          return requestResult(tx.objectStore('players').put(snapshot));
        });
      }, !!failure);
    } catch (error) { fail(error); }
  }

  async function flush() {
    if (initialization) await initialization;
    var last;
    do {
      last = queue;
      await last;
    } while (last !== queue);
    requireReady();
    if (failure) throw failure;
    return data;
  }

  function createPlayer(name) {
    var player = sanitize({ name: name }, '');
    return enqueue(async function () {
      player.id = newId();
      await transaction(['players', 'meta'], function (tx) {
        return Promise.all([
          requestResult(tx.objectStore('players').add(player)),
          requestResult(tx.objectStore('meta').put({ key: SELECTED_KEY, value: player.id }))
        ]);
      });
      apply(sanitize(player, player.id));
      updatePlayer(player);
      return player;
    }, false);
  }

  function switchPlayer(id) {
    return enqueue(async function () {
      if (!validId(id)) throw new Error('玩家编号无效');
      var player = await transaction(['players', 'meta'], async function (tx) {
        var table = tx.objectStore('players');
        var raw = await requestResult(table.get(id));
        if (!raw) throw new Error('未找到此本地玩家');
        var selected = sanitize(raw, id);
        if (isDeactivated(selected)) throw new Error('已注销账户不能直接切换');
        await Promise.all([
          requestResult(table.put(selected)),
          requestResult(tx.objectStore('meta').put({ key: SELECTED_KEY, value: id }))
        ]);
        return selected;
      });
      apply(sanitize(player, player.id));
      updatePlayer(player);
      return player;
    }, false);
  }

  function deactivatePlayer(id) {
    return enqueue(async function () {
      if (!validId(id)) throw new Error('玩家编号无效');
      var result = await transaction(['players', 'meta'], async function (tx) {
        var table = tx.objectStore('players');
        var raw = await requestResult(table.get(id));
        if (!raw) throw new Error('未找到此本地玩家');
        var player = sanitize(raw, id);
        if (isDeactivated(player)) throw new Error('此账户已经注销');
        player.deactivated = true;
        var profiles = (await requestResult(table.getAll())).map(function (item) {
          return sanitize(item, item.id);
        });
        var selected = profiles.find(function (item) {
          return item.id !== id && !isDeactivated(item);
        });
        if (!selected) selected = sanitize({}, newId());
        var writes = [
          requestResult(table.put(player)),
          requestResult(tx.objectStore('meta').put({ key: SELECTED_KEY, value: selected.id }))
        ];
        if (!profiles.some(function (item) { return item.id === selected.id; })) {
          writes.push(requestResult(table.add(selected)));
        }
        await Promise.all(writes);
        return { player: player, selected: selected };
      });
      updatePlayer(result.player);
      updatePlayer(result.selected);
      apply(result.selected);
      return result.selected;
    }, false);
  }

  function deleteDeactivatedPlayer(id) {
    return enqueue(async function () {
      if (!validId(id)) throw new Error('玩家编号无效');
      var player = await transaction(['players'], async function (tx) {
        var table = tx.objectStore('players');
        var raw = await requestResult(table.get(id));
        if (!raw) throw new Error('未找到此本地玩家');
        var selected = sanitize(raw, id);
        if (!isDeactivated(selected)) throw new Error('请先注销账户再删除');
        await requestResult(table.delete(id));
        return selected;
      });
      removePlayer(player.id);
      return player;
    }, false);
  }

  var store = {
    data: data,
    players: players,
    status: 'loading',
    error: null,
    onStatus: null,
    get: function () { return data; },
    init: init,
    save: save,
    flush: flush,
    createPlayer: createPlayer,
    switchPlayer: switchPlayer,
    deactivatePlayer: deactivatePlayer,
    deleteDeactivatedPlayer: deleteDeactivatedPlayer,
    reset: function () {
      apply(sanitize({ name: data.name, avatar: data.avatar, settings: data.settings }, activeId));
      save();
      return data;
    },
    addScore: function (delta) {
      data.score = integer(integer(data.score, 0, MAX_SCORE, 0) +
        integer(delta, -MAX_SCORE, MAX_SCORE, 0), 0, MAX_SCORE, 0);
      save();
      return data.score;
    },
    totalStars: function () {
      var stars = sanitize(data, activeId).stars;
      return Object.keys(stars).reduce(function (sum, key) { return sum + stars[key]; }, 0);
    },
    doneCount: function () {
      return Object.keys(sanitize(data, activeId).stars).length;
    },
    recordLevel: function (id, stars) {
      if (!Number.isInteger(id) || id < 1 || id > levelCount()) return;
      data.stars = sanitize(data, activeId).stars;
      data.stars[id] = Math.max(data.stars[id] || 0, integer(stars, 0, 3, 0));
      data.unlocked = Math.max(integer(data.unlocked, 1, levelCount(), 1), Math.min(levelCount(), id + 1));
      save();
    },
    title: function () {
      var done = store.doneCount();
      if (HB.levels && done >= HB.levels.total) return '百数板大师';
      if (done >= 20) return '数字小博士';
      if (done >= 14) return '数感小达人';
      if (done >= 8) return '百数小侦探';
      if (done >= 3) return '认真小选手';
      return '数字新星';
    }
  };

  HB.store = store;
})();
