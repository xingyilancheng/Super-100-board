const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

if (!app) {
  console.error('Run with the existing Electron binary: electron tools/test-store.cjs');
  process.exit(1);
}

function isolate(root) {
  for (const key of ['userData', 'sessionData', 'crashDumps', 'logs']) {
    const directory = path.join(root, key);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(key, directory);
  }
}

if (process.argv[2] !== '--store-test-worker') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hundred-board-store-test-'));
  let code = 1;
  try {
    // Keep the launcher synchronous so Chromium never opens a profile before worker cleanup.
    isolate(path.join(scratch, 'launcher'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, [__filename, '--store-test-worker', scratch], {
      env, stdio: 'inherit', windowsHide: true, timeout: 90000
    });
    if (result.error) throw result.error;
    code = result.status === 0 ? 0 : 1;
    if (result.signal) console.error('Test worker terminated:', result.signal);
  } catch (error) {
    console.error(error.stack || error);
  } finally {
    try {
      fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
      assert.equal(fs.existsSync(scratch), false);
      console.log('Cleaned isolated test artifacts.');
    } catch (error) {
      code = 1;
      console.error('Cleanup failed for ' + scratch + ':', error.stack || error);
    }
  }
  app.exit(code);
} else {
  runWorker(process.argv[3]);
}

function runWorker(scratch) {
  isolate(path.join(scratch, 'browser'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const fixture = path.join(scratch, 'fixture.html');
  const sources = ['levels.js', 'store.js'].map(name =>
    pathToFileURL(path.resolve(__dirname, '../js', name)).href);
  fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src file:">' +
    sources.map(src => '<script src="' + src.replace(/&/g, '&amp;') + '"></script>').join(''));

  let current = 'startup';
  let count = 0;
  let partition = 0;
  let finished = false;
  const timer = setTimeout(() => finish(new Error('Timed out after 60 seconds')), 60000);

  function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (error) console.error('FAIL ' + current + '\n' + (error.stack || error));
    else console.log('Store integration checks passed: ' + count + '.');
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(error ? 1 : 0);
  }

  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);

  async function test(name, action) {
    current = name;
    await action();
    count++;
    console.log('PASS ' + name);
  }

  async function withFixture(action, target = { total: 215, progressVersion: 3 }) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:store-test-' + (++partition)
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('render-process-gone', (_event, details) =>
      finish(new Error('Fixture renderer exited: ' + JSON.stringify(details))));
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(window.isVisible(), false);

    async function page(fn, ...args) {
      const result = await window.webContents.executeJavaScript(
        '(async () => { try { return { ok: true, value: await (' + fn.toString() +
        ')(...' + JSON.stringify(args) + ') }; } catch (error) { return { ok: false, ' +
        'error: String(error.stack || error) }; } })()');
      if (!result.ok) throw new Error(result.error);
      return result.value;
    }

    async function prepare() {
      const environment = await page(installHarness, target);
      assert.deepEqual(environment, { protocol: 'file:', scripts: sources,
        modules: ['levels', 'store'], node: 'undefined', errors: [] });
    }

    async function reload() {
      const loaded = once(window.webContents, 'did-finish-load');
      window.webContents.reload();
      await loaded;
      await prepare();
      return page(async () => { await HB.store.init(); return __storeTest.snapshot(); });
    }

    try {
      await window.loadFile(fixture);
      await prepare();
      await action({ page, reload });
      assert.equal(window.isVisible(), false);
      assert.deepEqual(await page(() => __storeTest.errors), []);
      await window.webContents.session.flushStorageData();
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  function defaults(id, name = '小玩家', progressVersion = 3) {
    return { id, progressVersion, name, avatar: '\uD83D\uDC3B', score: 0, unlocked: 1, currentLevel: 1,
      stars: {}, settings: { material: 'wood', sound: true, motion: 'full' } };
  }

  function committed(state, profiles, selected) {
    assert.equal(state.status, 'saved');
    assert.equal(state.error, null);
    assert.deepEqual(state.errors, []);
    assert.equal(state.db.version, 1);
    assert.deepEqual(state.db.stores, ['meta', 'players']);
    assert.deepEqual(state.db.keyPaths, { players: 'id', meta: 'key' });
    const byId = list => [...list].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId(state.db.players), byId(profiles), 'committed players');
    assert.deepEqual(state.db.meta.sort((a, b) => a.key.localeCompare(b.key)), [
      { key: 'currentPlayerId', value: selected }, { key: 'legacyMigrated', value: true }
    ]);
    assert.deepEqual(byId(state.players), byId(profiles.map(profile => {
      const summary = { id: profile.id, name: profile.name, avatar: profile.avatar };
      if (profile.deactivated) summary.deactivated = true;
      return summary;
    })));
    assert.deepEqual(state.data, profiles.find(profile => profile.id === selected));
    assert.equal(state.sameReference, true);
  }

  async function versionTwoRegression(withFixture, defaults) {
    await withFixture(async ({ page, reload }) => {
      let expected;
      await test('fresh init commits default player and metadata without legacy storage', async () => {
        const before = await page(() => indexedDB.databases());
        assert.deepEqual(before, []);
        const result = await page(async () => {
          const first = HB.store.init();
          const second = HB.store.init();
          await first;
          return { samePromise: first === second, state: await __storeTest.snapshot() };
        });
        assert.equal(result.samePromise, true);
        assert.match(result.state.data.id, /^p-[a-f0-9]+(?:-[a-f0-9]+){3}$/);
        expected = defaults(result.state.data.id);
        committed(result.state, [expected], expected.id);
        assert.equal(result.state.legacy, null);
      });
      await test('fresh default profile survives fixture reload', async () => {
        committed(await reload(), [expected], expected.id);
      });
    });

    for (const oldTotal of [150, 200]) {
      await withFixture(async ({ page, reload }) => {
        await test('version-1 ' + oldTotal + '-level API migrates once and persists through level 210', async () => {
          const old = await page(async total => {
            HB.levels.total = total;
            HB.levels.progressVersion = 1;
            await HB.store.init();
            HB.store.data.score = 1234;
            HB.store.data.currentLevel = total;
            HB.store.recordLevel(20, 1);
            HB.store.recordLevel(21, 2);
            HB.store.recordLevel(total, 3);
            await HB.store.flush();
            return __storeTest.snapshot();
          }, oldTotal);
          const original = { ...defaults(old.data.id), progressVersion: 1, score: 1234,
            unlocked: oldTotal, currentLevel: oldTotal, stars: { 20: 1, 21: 2, [oldTotal]: 3 } };
          committed(old, [original], original.id);
          const expected = { ...original, progressVersion: 2,
            unlocked: oldTotal + 10, currentLevel: oldTotal + 10,
            stars: { 20: 1, 31: 2, [oldTotal + 10]: 3 } };
          committed(await reload(), [expected], expected.id);
          assert.deepEqual(await page(() => ({ total: HB.levels.total, version: HB.levels.progressVersion })),
            { total: 210, version: 2 });
          committed(await reload(), [expected], expected.id);
          const expanded = await page(async id => {
            HB.store.recordLevel(id, 2);
            await HB.store.flush();
            return __storeTest.snapshot();
          }, oldTotal + 10);
          expected.unlocked = Math.min(210, oldTotal + 11);
          committed(expanded, [expected], expected.id);
          const completed = await page(async () => {
            HB.store.recordLevel(21, 1);
            HB.store.recordLevel(161, 2);
            HB.store.recordLevel(210, 3);
            HB.store.data.currentLevel = 210;
            HB.store.save();
            await HB.store.flush();
            return __storeTest.snapshot();
          });
          const final = { ...expected, unlocked: 210, currentLevel: 210,
            stars: { ...expected.stars, 21: 1, 161: 2, 210: 3 } };
          committed(completed, [final], final.id);
          committed(await reload(), [final], final.id);
          committed(await reload(), [final], final.id);
        });
      });
    }

    const rawProfiles = [
      { id: 'old-a', name: '边界玩家', avatar: 'fox', score: 4321, unlocked: 21, currentLevel: 20,
        stars: { 0: 3, 1: 1, 20: 2, 21: 3, 22: 99, 23: 2.9, 24: -1, 25: '3', 26: null,
          27: 0, 30: 1, 31: 2, 190: 2, 200: 3, 201: 2, 210: 3, '021': 3, '21.5': 3, '-1': 3 },
        settings: { material: 'acrylic', sound: false, motion: 'lite' } },
      { ...defaults('old-b', '尾关玩家'), progressVersion: 1, avatar: 'owl', score: 7654,
        unlocked: 200, currentLevel: 200, stars: { 20: 3, 21: 1, 200: 2 } },
      { ...defaults('old-hidden', '注销玩家'), progressVersion: 1, avatar: 'rabbit', score: 2468,
        unlocked: 20, currentLevel: 21, stars: { 20: 1, 21: 2, 200: 3, 201: 3 },
        settings: { material: 'starry', sound: false, motion: 'lite' }, deactivated: true },
      { ...defaults('version-two', '新版玩家'), score: 1357, unlocked: 210, currentLevel: 201,
        stars: { 20: 1, 21: 3, 30: 2, 31: 1, 200: 2, 201: 3, 210: 1, 211: 3 } }
    ];
    const migratedProfiles = [
      { ...rawProfiles[0], progressVersion: 2, unlocked: 31,
        stars: { 1: 1, 20: 2, 31: 3, 32: 3, 33: 2, 40: 1, 41: 2, 200: 2, 210: 3 } },
      { ...rawProfiles[1], progressVersion: 2, unlocked: 210, currentLevel: 210,
        stars: { 20: 3, 31: 1, 210: 2 } },
      { ...rawProfiles[2], progressVersion: 2, currentLevel: 31, stars: { 20: 1, 31: 2, 210: 3 } },
      { ...rawProfiles[3], stars: { 20: 1, 21: 3, 30: 2, 31: 1, 200: 2, 201: 3, 210: 1 } }
    ];

    await withFixture(async ({ page, reload }) => {
      let expected = migratedProfiles;
      await test('IndexedDB migration covers active and deactivated profiles, boundaries and invalid stars', async () => {
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, 'old-a');
          localStorage.setItem('hundred-board-save-v1', '{"score":999999}');
          await HB.store.init();
          return __storeTest.snapshot();
        }, rawProfiles);
        committed(state, expected, 'old-a');
        assert.equal(state.legacy, '{"score":999999}');
        assert.deepEqual(await page(() => ({ done: HB.store.doneCount(), stars: HB.store.totalStars() })),
          { done: 9, stars: 19 });
      });
      await test('two reloads do not shift migrated or current-version profiles again', async () => {
        committed(await reload(), expected, 'old-a');
        committed(await reload(), expected, 'old-a');
      });
      await test('switch and save preserve version markers and newly inserted level progress', async () => {
        const state = await page(async () => {
          await HB.store.switchPlayer('old-b');
          HB.store.data.currentLevel = 201;
          HB.store.recordLevel(21, 3);
          HB.store.recordLevel(201, 1);
          await HB.store.switchPlayer('version-two');
          HB.store.recordLevel(30, 3);
          await HB.store.switchPlayer('old-a');
          HB.store.data.currentLevel = 31;
          HB.store.recordLevel(21, 2);
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        expected = expected.map(profile => {
          if (profile.id === 'old-a') return { ...profile, currentLevel: 31, stars: { ...profile.stars, 21: 2 } };
          if (profile.id === 'old-b') return { ...profile, currentLevel: 201,
            stars: { ...profile.stars, 21: 3, 201: 1 } };
          if (profile.id === 'version-two') return { ...profile, stars: { ...profile.stars, 30: 3 } };
          return profile;
        });
        committed(state, expected, 'old-a');
        committed(await reload(), expected, 'old-a');
        committed(await reload(), expected, 'old-a');
      });
    });

    await withFixture(async ({ page, reload }) => {
      await test('aborted migration rolls back every profile and both metadata writes before reload retry', async () => {
        const result = await page(async profiles => {
          await __storeTest.seed(profiles, 'old-hidden', false);
          const before = await __storeTest.snapshot();
          const original = IDBObjectStore.prototype.put;
          let written = 0;
          let aborted = false;
          IDBObjectStore.prototype.put = function (...args) {
            const request = Reflect.apply(original, this, args);
            if (this.transaction.db.name === 'hundred-board-db') {
              if (this.name === 'players') request.addEventListener('success', () => { written++; });
              if (this.name === 'meta' && args[0].key === 'legacyMigrated') {
                request.addEventListener('success', () => {
                  aborted = true;
                  this.transaction.abort();
                });
              }
            }
            return request;
          };
          let rejection;
          try { rejection = await __storeTest.rejection(HB.store.init()); }
          finally { IDBObjectStore.prototype.put = original; }
          const flush = await __storeTest.rejection(HB.store.flush());
          return { before, failed: await __storeTest.snapshot(), rejection, flush, written, aborted };
        }, rawProfiles);
        assert.equal(result.aborted, true);
        assert.equal(result.written, rawProfiles.length);
        assert.ok(result.rejection.message.length > 0);
        assert.deepEqual(result.flush, result.rejection);
        assert.equal(result.failed.status, 'error');
        assert.equal(result.failed.error, result.rejection.message);
        assert.deepEqual(result.failed.db, result.before.db, 'no partial migration or marker commits');
        assert.deepEqual(result.failed.data, result.before.data, 'failed init must not publish migrated progress');
        assert.deepEqual(result.failed.players, []);
        assert.deepEqual(result.failed.errors, []);
        committed(await reload(), migratedProfiles, 'old-a');
        committed(await reload(), migratedProfiles, 'old-a');
      });
    });

    await withFixture(async ({ page, reload }) => {
      await test('all-deactivated legacy profiles migrate before creating a version-2 replacement', async () => {
        const state = await page(async profile => {
          await __storeTest.seed([profile], profile.id);
          await HB.store.init();
          return __storeTest.snapshot();
        }, rawProfiles[2]);
        const replacement = defaults(state.data.id);
        assert.notEqual(replacement.id, rawProfiles[2].id);
        const expected = [migratedProfiles[2], replacement];
        committed(state, expected, replacement.id);
        committed(await reload(), expected, replacement.id);
        committed(await reload(), expected, replacement.id);
      });
    });

    await withFixture(async ({ page, reload }) => {
      const legacy = JSON.stringify({ nickname: '旧玩家', avatar: 'fox', score: 4321,
        unlocked: 42, currentLevel: 31, stars: { 1: 3, 25: 2, 100: 1 },
        settings: { material: 'acrylic', sound: false, motion: 'lite' } });
      const changedLegacy = JSON.stringify({ nickname: '不得迁移', score: 999999 });
      let a, b;

      await test('legacy migration preserves every supported field and localStorage', async () => {
        const state = await page(async raw => {
          localStorage.setItem('hundred-board-save-v1', raw);
          localStorage.setItem('unrelated-test-key', 'keep-me');
          await HB.store.init();
          return __storeTest.snapshot();
        }, legacy);
        a = { ...defaults(state.data.id, '旧玩家'), avatar: 'fox', score: 4321,
          unlocked: 52, currentLevel: 41, stars: { 1: 3, 35: 2, 110: 1 },
          settings: { material: 'acrylic', sound: false, motion: 'lite' } };
        committed(state, [a], a.id);
        assert.equal(state.legacy, legacy);
        assert.equal(state.unrelated, 'keep-me');
      });

      await test('create commits a separate selected profile and reload preserves selection', async () => {
        const state = await page(async () => {
          await HB.store.createPlayer('新玩家');
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        b = defaults(state.data.id, '新玩家');
        assert.notEqual(a.id, b.id);
        committed(state, [a, b], b.id);
        await page(raw => localStorage.setItem('hundred-board-save-v1', raw), changedLegacy);
        const reloaded = await reload();
        committed(reloaded, [a, b], b.id);
        assert.equal(reloaded.legacy, changedLegacy);
        assert.equal(reloaded.unrelated, 'keep-me');
      });

      await test('rapid save snapshots and immediate switches isolate both profiles', async () => {
        const state = await page(async (aId, bId) => {
          const store = HB.store;
          await store.switchPlayer(aId);
          for (let i = 1; i <= 40; i++) {
            store.data.score = 1000 + i;
            store.data.stars[2] = i % 3 + 1;
            store.data.settings.material = i % 2 ? 'starry' : 'macaron';
            store.save();
          }
          store.data.score = 999999;
          store.data.stars[2] = 3;
          store.data.settings.material = 'wood';
          await store.switchPlayer(bId);
          if (store.data.score !== 0) throw new Error('A score leaked into B');
          for (let i = 1; i <= 20; i++) {
            store.data.score = 2000 + i;
            store.data.stars[3] = i % 3;
            store.save();
          }
          store.data.score = 888888;
          store.data.stars[3] = 3;
          await store.switchPlayer(aId);
          await store.flush();
          return __storeTest.snapshot();
        }, a.id, b.id);
        a = { ...a, score: 1040, stars: { ...a.stars, 2: 2 },
          settings: { ...a.settings, material: 'macaron' } };
        b = { ...b, score: 2020, stars: { 3: 2 } };
        committed(state, [a, b], a.id);
      });

      await test('switch selection persists on reload without repeating changed legacy migration', async () => {
        const state = await reload();
        committed(state, [a, b], a.id);
        assert.equal(state.legacy, changedLegacy);
        assert.equal(state.unrelated, 'keep-me');
      });

      await test('transaction fault rejects flush, blocks queued writes, and requires explicit save retry', async () => {
        const result = await page(async () => {
          const store = HB.store;
          const events = [];
          store.onStatus = (status, error) => events.push({ status, error: error && error.message });
          const original = IDBDatabase.prototype.transaction;
          let hits = 0;
          IDBDatabase.prototype.transaction = function (...args) {
            if (this.name === 'hundred-board-db' && args[1] === 'readwrite') {
              hits++;
              throw new DOMException('store-test-save-fault', 'InvalidStateError');
            }
            return Reflect.apply(original, this, args);
          };
          let first;
          try {
            for (let score = 5555; score <= 5557; score++) {
              store.data.score = score;
              store.save();
            }
            first = await __storeTest.rejection(store.flush());
          } finally {
            IDBDatabase.prototype.transaction = original;
          }
          const second = await __storeTest.rejection(store.flush());
          const blocked = await __storeTest.rejection(store.createPlayer('不可创建'));
          const failed = await __storeTest.snapshot();
          store.save();
          await store.flush();
          const recovered = await __storeTest.snapshot();
          store.onStatus = null;
          return { hits, first, second, blocked, failed, recovered, events };
        });
        assert.equal(result.hits, 1);
        for (const error of [result.first, result.second, result.blocked]) {
          assert.equal(error.message, 'store-test-save-fault');
          assert.equal(error.name, 'InvalidStateError');
        }
        assert.equal(result.failed.status, 'error');
        assert.equal(result.failed.error, 'store-test-save-fault');
        assert.deepEqual(result.failed.data, { ...a, score: 5557 });
        const failedPlayers = result.failed.db.players.sort((x, y) => x.id.localeCompare(y.id));
        assert.deepEqual(failedPlayers, [a, b].sort((x, y) => x.id.localeCompare(y.id)));
        assert.equal(result.failed.db.meta.find(row => row.key === 'currentPlayerId').value, a.id);
        assert.equal(result.failed.players.length, 2);
        a = { ...a, score: 5557 };
        committed(result.recovered, [a, b], a.id);
        assert.ok(result.events.some(event => event.status === 'error' && event.error === 'store-test-save-fault'));
        assert.deepEqual(result.events.at(-1), { status: 'saved', error: null });
      });

      await test('failed selection preserves current profile and persisted active metadata', async () => {
        const result = await page(async bId => {
          const original = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (...args) {
            if (this.name === 'hundred-board-db' && args[1] === 'readwrite') {
              throw new DOMException('store-test-selection-fault', 'InvalidStateError');
            }
            return Reflect.apply(original, this, args);
          };
          let rejection;
          try { rejection = await __storeTest.rejection(HB.store.switchPlayer(bId)); }
          finally { IDBDatabase.prototype.transaction = original; }
          const flush = await __storeTest.rejection(HB.store.flush());
          const failed = await __storeTest.snapshot();
          HB.store.save();
          await HB.store.flush();
          return { rejection, flush, failed, recovered: await __storeTest.snapshot() };
        }, b.id);
        assert.equal(result.rejection.message, 'store-test-selection-fault');
        assert.deepEqual(result.flush, result.rejection);
        assert.deepEqual(result.failed.data, a);
        assert.equal(result.failed.status, 'error');
        assert.deepEqual(result.failed.db, result.recovered.db);
        committed(result.recovered, [a, b], a.id);
      });

      await test('missing and prototype-like selections reject without changing profile', async () => {
        for (const id of ['missing-profile', '__proto__', 'constructor']) {
          const result = await page(async id => {
            const rejection = await __storeTest.rejection(HB.store.switchPlayer(id));
            const flush = await __storeTest.rejection(HB.store.flush());
            const failed = await __storeTest.snapshot();
            HB.store.save();
            await HB.store.flush();
            return { rejection, flush, failed, recovered: await __storeTest.snapshot() };
          }, id);
          assert.ok(result.rejection.message.length > 0);
          assert.deepEqual(result.flush, result.rejection);
          assert.deepEqual(result.failed.data, a);
          assert.equal(result.failed.status, 'error');
          assert.deepEqual(result.failed.db, result.recovered.db);
          committed(result.recovered, [a, b], a.id);
        }
      });

      await test('reset retains id, name, avatar and settings while clearing only active progress', async () => {
        const state = await page(async () => {
          const store = HB.store;
          store.data.name = '保留名字';
          store.data.avatar = 'owl';
          store.data.settings = { material: 'starry', sound: false, motion: 'lite' };
          store.save();
          await store.flush();
          if (store.reset() !== store.data) throw new Error('reset replaced the public data reference');
          await store.flush();
          return __storeTest.snapshot();
        });
        a = { ...defaults(a.id, '保留名字'), avatar: 'owl',
          settings: { material: 'starry', sound: false, motion: 'lite' } };
        committed(state, [a, b], a.id);
        const reloaded = await reload();
        committed(reloaded, [a, b], a.id);
        assert.equal(reloaded.legacy, changedLegacy);
      });

      await test('deactivation preserves hidden data and permanent deletion removes it', async () => {
        const deactivated = await page(async id => {
          const store = HB.store;
          await store.switchPlayer(id);
          await store.deactivatePlayer(id);
          await store.flush();
          return __storeTest.snapshot();
        }, b.id);
        b = { ...b, deactivated: true };
        committed(deactivated, [a, b], a.id);
        assert.equal(deactivated.data.id, a.id);
        assert.equal(deactivated.db.players.find(player => player.id === b.id).deactivated, true);
        assert.equal(deactivated.players.find(player => player.id === b.id).deactivated, true);
        committed(await reload(), [a, b], a.id);

        const deleted = await page(async id => {
          await HB.store.deleteDeactivatedPlayer(id);
          await HB.store.flush();
          return __storeTest.snapshot();
        }, b.id);
        committed(deleted, [a], a.id);
        assert.equal(deleted.db.players.some(player => player.id === b.id), false);
        committed(await reload(), [a], a.id);
      });
    });

    await withFixture(async ({ page, reload }) => {
      await test('migration marker prevents importing changed legacy even if players become empty', async () => {
        const old = await page(async () => {
          localStorage.setItem('hundred-board-save-v1', '{"score":111}');
          await HB.store.init();
          await __storeTest.clearPlayers();
          localStorage.setItem('hundred-board-save-v1', '{"score":999}');
          return HB.store.data.id;
        });
        const state = await reload();
        assert.notEqual(state.data.id, old);
        committed(state, [defaults(state.data.id)], state.data.id);
        assert.equal(state.legacy, '{"score":999}');
      });
    });

    const legacyCases = [
      ['invalid JSON', '{not-json', {}],
      ['null', 'null', {}],
      ['array root', '[{"name":"wrong","score":99}]', {}],
      ['version-1 boundaries', JSON.stringify({ progressVersion: 1, unlocked: 20, currentLevel: 21,
        stars: { 20: 1, 21: 2, 200: 3, 201: 3 } }),
        { unlocked: 20, currentLevel: 31, stars: { 20: 1, 31: 2, 210: 3 } }],
      ['already current version', JSON.stringify({ progressVersion: 2, unlocked: 210, currentLevel: 21,
        stars: { 20: 1, 21: 2, 200: 3, 201: 1, 210: 2, 211: 3 } }),
        { unlocked: 210, currentLevel: 21, stars: { 20: 1, 21: 2, 200: 3, 201: 1, 210: 2 } }],
      ['wrong field types', JSON.stringify({ name: [], nickname: '后备名', avatar: {},
        score: '99', unlocked: null, currentLevel: '20', stars: [3, 3, 3],
        settings: ['starry', false, 'lite'] }), { name: '后备名' }],
      ['bounded values and prototype keys',
        '{"id":"__proto__","name":" \\u0000<ABCDEFGHIJKLM>\\u202e ","avatar":"<abcdefghijklmnopqrst>\\u2066",' +
        '"score":1e30,"unlocked":1e8,"currentLevel":-10,' +
        '"stars":{"1":99,"2":2.9,"3":-2,"4":"3","0":3,"201":3,"__proto__":{"5":3},"constructor":3},' +
        '"settings":{"material":"evil","sound":"false","motion":"fast"},' +
        '"__proto__":{"polluted":true,"score":777},"constructor":{"prototype":{"polluted":true}}}',
        { name: 'ABCDEFGH', avatar: 'abcdefghijklmnop', score: 1000000000,
          unlocked: 210, stars: { 1: 3, 2: 2 } }]
    ];
    for (const [name, raw, overrides] of legacyCases) {
      await withFixture(async ({ page, reload }) => {
        await test('legacy import: ' + name, async () => {
          const state = await page(async raw => {
            localStorage.setItem('hundred-board-save-v1', raw);
            await HB.store.init();
            if (({}).polluted !== undefined) throw new Error('Object prototype was polluted');
            return __storeTest.snapshot();
          }, raw);
          const expected = { ...defaults(state.data.id), ...overrides };
          assert.match(state.data.id, /^p-/);
          committed(state, [expected], expected.id);
          assert.equal(state.legacy, raw);
          const reloaded = await reload();
          committed(reloaded, [expected], expected.id);
          assert.equal(reloaded.legacy, raw);
        });
      });
    }

    await withFixture(async ({ page, reload }) => {
      await test('save ignores inherited stars and settings rather than persisting prototype values', async () => {
        const state = await page(async () => {
          await HB.store.init();
          HB.store.data.stars = Object.assign(Object.create({ 1: 3 }), { 2: 2 });
          HB.store.data.settings = Object.create({ material: 'starry', sound: false, motion: 'lite' });
          HB.store.save();
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        const expected = { ...defaults(state.data.id), stars: { 2: 2 } };
        assert.deepEqual(state.db.players, [expected]);
        committed(await reload(), [expected], expected.id);
      });
    });
  }

  async function versionThreeRegression() {
    await withFixture(async ({ page, reload }) => {
      let expected;
      await test('fresh v3 init, create, record and reset persist version 3 through level 215', async () => {
        assert.deepEqual(await page(() => indexedDB.databases()), []);
        const result = await page(async () => {
          const first = HB.store.init();
          const second = HB.store.init();
          await first;
          return { samePromise: first === second, state: await __storeTest.snapshot() };
        });
        assert.equal(result.samePromise, true);
        expected = defaults(result.state.data.id);
        committed(result.state, [expected], expected.id);
        assert.equal(result.state.legacy, null);
        committed(await reload(), [expected], expected.id);
        const created = await page(async () => {
          await HB.store.createPlayer('新版玩家');
          HB.store.addScore(123);
          HB.store.recordLevel(36, 1);
          HB.store.recordLevel(40, 2);
          HB.store.recordLevel(215, 3);
          HB.store.recordLevel(216, 3);
          HB.store.data.currentLevel = 215;
          HB.store.save();
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        const other = { ...defaults(created.data.id, '新版玩家'), score: 123, unlocked: 215,
          currentLevel: 215, stars: { 36: 1, 40: 2, 215: 3 } };
        committed(created, [expected, other], other.id);
        committed(await reload(), [expected, other], other.id);
        const reset = await page(async () => {
          HB.store.reset();
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        const cleared = defaults(other.id, other.name);
        committed(reset, [expected, cleared], cleared.id);
        committed(await reload(), [expected, cleared], cleared.id);
      });
    });

    const rawProfiles = [
      { id: 'v1-active', name: '第一版', avatar: 'fox', score: 4321, unlocked: 21, currentLevel: 20,
        stars: { 20: 1, 21: 2, 25: 3, 26: 2, 35: 1, 36: 3, 200: 2, 201: 3, 210: 3, 215: 3 },
        settings: { material: 'acrylic', sound: false, motion: 'lite' } },
      { ...defaults('v2-active', '第二版', 2), score: 7654, unlocked: 36, currentLevel: 35,
        stars: { 20: 1, 21: 3, 30: 2, 31: 1, 35: 3, 36: 2, 200: 1, 210: 3, 211: 3, 215: 3 } },
      { ...defaults('v1-hidden', '旧注销', 1), avatar: 'owl', score: 2468, unlocked: 25,
        currentLevel: 26, stars: { 20: 1, 21: 2, 25: 3, 26: 1, 200: 2, 201: 3 }, deactivated: true },
      { ...defaults('v2-hidden', '新注销', 2), avatar: 'rabbit', score: 3579, unlocked: 35,
        currentLevel: 36, stars: { 35: 2, 36: 3, 210: 1, 211: 3 }, deactivated: true,
        settings: { material: 'starry', sound: false, motion: 'lite' } },
      { ...defaults('v3-current', '第三版'), score: 1357, unlocked: 215, currentLevel: 40,
        stars: { 20: 1, 21: 2, 35: 3, 36: 1, 37: 2, 38: 3, 39: 1, 40: 2, 41: 3, 215: 2, 216: 3 } }
    ];
    const migratedProfiles = [
      { ...rawProfiles[0], progressVersion: 3, unlocked: 31,
        stars: { 20: 1, 31: 2, 35: 3, 41: 2, 50: 1, 51: 3, 215: 2 } },
      { ...rawProfiles[1], progressVersion: 3, unlocked: 41,
        stars: { 20: 1, 21: 3, 30: 2, 31: 1, 35: 3, 41: 2, 205: 1, 215: 3 } },
      { ...rawProfiles[2], progressVersion: 3, unlocked: 35, currentLevel: 41,
        stars: { 20: 1, 31: 2, 35: 3, 41: 1, 215: 2 } },
      { ...rawProfiles[3], progressVersion: 3, currentLevel: 41, stars: { 35: 2, 41: 3, 215: 1 } },
      { ...rawProfiles[4],
        stars: { 20: 1, 21: 2, 35: 3, 36: 1, 37: 2, 38: 3, 39: 1, 40: 2, 41: 3, 215: 2 } }
    ];

    await withFixture(async ({ page, reload }) => {
      let expected = migratedProfiles;
      await test('v1 and v2 IndexedDB profiles migrate to v3 atomically, including deactivated accounts', async () => {
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, 'v2-active');
          localStorage.setItem('hundred-board-save-v1', '{"score":999999}');
          const first = HB.store.init();
          if (first !== HB.store.init()) throw new Error('init promise changed');
          await first;
          await HB.store.init();
          return __storeTest.snapshot();
        }, rawProfiles);
        committed(state, expected, 'v2-active');
        assert.equal(state.legacy, '{"score":999999}');
        assert.deepEqual(await page(() => ({ done: HB.store.doneCount(), stars: HB.store.totalStars() })),
          { done: 8, stars: 16 });
        committed(await reload(), expected, 'v2-active');
        committed(await reload(), expected, 'v2-active');
      });
      await test('v3 repeated init, switch and save never remap either insertion or the version marker', async () => {
        const state = await page(async () => {
          for (let i = 0; i < 3; i++) {
            await HB.store.init();
            for (const id of ['v1-active', 'v2-active', 'v3-current']) {
              await HB.store.switchPlayer(id);
              HB.store.data.currentLevel = 36;
              HB.store.recordLevel(36, 2);
              HB.store.recordLevel(40, 3);
              HB.store.save();
            }
          }
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        expected = expected.map(profile => profile.deactivated ? profile : {
          ...profile, currentLevel: 36, unlocked: Math.max(41, profile.unlocked),
          stars: { ...profile.stars, 36: 2, 40: 3 }
        });
        committed(state, expected, 'v3-current');
        committed(await reload(), expected, 'v3-current');
        committed(await reload(), expected, 'v3-current');
      });
      await test('migrated deactivated profiles stay unavailable without losing retained progress', async () => {
        for (const id of ['v1-hidden', 'v2-hidden']) {
          const result = await page(async id => {
            const before = await __storeTest.snapshot();
            const rejection = await __storeTest.rejection(HB.store.switchPlayer(id));
            const failed = await __storeTest.snapshot();
            HB.store.save();
            await HB.store.flush();
            return { before, failed, rejection, recovered: await __storeTest.snapshot() };
          }, id);
          assert.ok(result.rejection.message.includes('注销'));
          assert.deepEqual(result.failed.db, result.before.db);
          assert.deepEqual(result.failed.data, result.before.data);
          committed(result.recovered, expected, 'v3-current');
        }
      });
    });

    await withFixture(async ({ page, reload }) => {
      await test('v3 mapping checks both sides of 20/21 and 35/36 in each source coordinate system', async () => {
        const cases = [
          [1, 20, 20], [1, 21, 31], [1, 25, 35], [1, 26, 41], [1, 35, 50], [1, 36, 51], [1, 200, 215],
          [2, 20, 20], [2, 21, 21], [2, 35, 35], [2, 36, 41], [2, 210, 215],
          [3, 20, 20], [3, 21, 21], [3, 35, 35], [3, 36, 36], [3, 40, 40], [3, 215, 215]
        ];
        const profiles = cases.map(([version, level]) => ({
          ...defaults('boundary-' + version + '-' + level, '边界', version),
          unlocked: level, currentLevel: level, stars: { [level]: 2 }
        }));
        const expected = cases.map(([, , level], i) => ({ ...profiles[i], progressVersion: 3,
          unlocked: level, currentLevel: level, stars: { [level]: 2 } }));
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, profiles[0].id);
          await HB.store.init();
          return __storeTest.snapshot();
        }, profiles);
        committed(state, expected, expected[0].id);
        committed(await reload(), expected, expected[0].id);
      });
    });

    for (const oldVersion of [1, 2]) {
      await withFixture(async ({ page, reload }) => {
        await test('version-' + oldVersion + ' public API progress upgrades directly to v3 once', async () => {
          const oldTotal = oldVersion === 1 ? 200 : 210;
          const result = await page(async (version, total) => {
            HB.levels.progressVersion = version;
            HB.levels.total = total;
            await HB.store.init();
            HB.store.data.currentLevel = 36;
            HB.store.addScore(1234);
            for (const level of [20, 21, 35, 36, total]) HB.store.recordLevel(level, 2);
            await HB.store.flush();
            return __storeTest.snapshot();
          }, oldVersion, oldTotal);
          const original = { ...defaults(result.data.id, '小玩家', oldVersion), score: 1234,
            unlocked: oldTotal, currentLevel: 36, stars: { 20: 2, 21: 2, 35: 2, 36: 2, [oldTotal]: 2 } };
          committed(result, [original], original.id);
          const expected = { ...original, progressVersion: 3, unlocked: 215,
            currentLevel: oldVersion === 1 ? 51 : 41,
            stars: oldVersion === 1 ? { 20: 2, 31: 2, 50: 2, 51: 2, 215: 2 } :
              { 20: 2, 21: 2, 35: 2, 41: 2, 215: 2 } };
          committed(await reload(), [expected], expected.id);
          committed(await reload(), [expected], expected.id);
        });
      });
    }

    await withFixture(async ({ page, reload }) => {
      await test('all-deactivated v1/v2 accounts migrate and retain data beside one fresh v3 replacement', async () => {
        const profiles = rawProfiles.slice(2, 4);
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, 'v2-hidden');
          await HB.store.init();
          return __storeTest.snapshot();
        }, profiles);
        const replacement = defaults(state.data.id);
        assert.ok(!profiles.some(profile => profile.id === replacement.id));
        const expected = [...migratedProfiles.slice(2, 4), replacement];
        committed(state, expected, replacement.id);
        committed(await reload(), expected, replacement.id);
        committed(await reload(), expected, replacement.id);
      });
    });

    for (const allDeactivated of [false, true]) {
      await withFixture(async ({ page, reload }) => {
        await test('v3 aborted migration rolls back profiles, metadata and ' +
          (allDeactivated ? 'replacement creation' : 'active selection'), async () => {
          const profiles = allDeactivated ? rawProfiles.slice(2, 4) : rawProfiles;
          const result = await page(async profiles => {
            await __storeTest.seed(profiles, 'v2-hidden', false);
            const before = await __storeTest.snapshot();
            const original = IDBObjectStore.prototype.put;
            let written = 0;
            let markers = 0;
            IDBObjectStore.prototype.put = function (...args) {
              const request = Reflect.apply(original, this, args);
              if (this.transaction.db.name === 'hundred-board-db') {
                request.addEventListener('success', () => {
                  if (this.name === 'players') written++;
                  if (this.name === 'meta') markers++;
                  if (this.name === 'meta' && args[0].key === 'legacyMigrated') this.transaction.abort();
                });
              }
              return request;
            };
            let rejection;
            try { rejection = await __storeTest.rejection(HB.store.init()); }
            finally { IDBObjectStore.prototype.put = original; }
            const flush = await __storeTest.rejection(HB.store.flush());
            const repeated = await __storeTest.rejection(HB.store.init());
            return { before, failed: await __storeTest.snapshot(), rejection, flush, repeated, written, markers };
          }, profiles);
          assert.equal(result.written, profiles.length + (allDeactivated ? 1 : 0));
          assert.equal(result.markers, 2);
          assert.ok(result.rejection.message.length > 0);
          assert.deepEqual(result.flush, result.rejection);
          assert.deepEqual(result.repeated, result.rejection);
          assert.equal(result.failed.status, 'error');
          assert.equal(result.failed.error, result.rejection.message);
          assert.deepEqual(result.failed.db, result.before.db, 'all old version markers and metadata roll back');
          assert.deepEqual(result.failed.data, result.before.data, 'no migrated data is published before commit');
          assert.deepEqual(result.failed.players, []);
          assert.deepEqual(result.failed.errors, []);
          const recovered = await reload();
          const expected = allDeactivated ? [...migratedProfiles.slice(2, 4), defaults(recovered.data.id)] : migratedProfiles;
          const selected = allDeactivated ? recovered.data.id : 'v1-active';
          committed(recovered, expected, selected);
          committed(await reload(), expected, selected);
        });
      });
    }

    await withFixture(async ({ page, reload }) => {
      await test('v3 validates source ranges, fractional positions, star keys and field types before mapping', async () => {
        const result = await page(async () => {
          const profiles = [
            { id: 'invalid-v1', progressVersion: 1, score: Infinity, unlocked: 201, currentLevel: 25.9,
              stars: { 0: 3, 20: 99, 21: 2.9, 25: -1, 26: '3', 27: null, 28: NaN,
                201: 3, 210: 3, 211: 3, 215: 3, '020': 3, '21.5': 3 },
              settings: { material: 'invalid', sound: 'false', motion: [] } },
            { id: 'invalid-v2', progressVersion: 2, score: -1, unlocked: 211, currentLevel: 35.9,
              stars: { 35: 2.9, 36: 99, 37: -1, 38: '3', 211: 3, 212: 3, 215: 3, '036': 3 } },
            { id: 'invalid-v3', progressVersion: 3, unlocked: 216, currentLevel: 36.9,
              stars: { 35: 2, 36: 3, 215: 1, 216: 3, '36.5': 3 } },
            { id: 'invalid-types', progressVersion: '3', name: [], score: '99', unlocked: NaN,
              currentLevel: Infinity, stars: [3, 3, 3], settings: [false] },
            { id: 'missing-version', unlocked: 26, currentLevel: 21, stars: { 26: 2 } }
          ];
          await __storeTest.seed(profiles, profiles[0].id);
          await HB.store.init();
          return __storeTest.snapshot();
        });
        const expected = [
          { ...defaults('invalid-v1'), unlocked: 215, currentLevel: 35, stars: { 20: 3, 31: 2 } },
          { ...defaults('invalid-v2'), unlocked: 215, currentLevel: 35, stars: { 35: 2, 41: 3 } },
          { ...defaults('invalid-v3'), unlocked: 215, currentLevel: 36, stars: { 35: 2, 36: 3, 215: 1 } },
          defaults('invalid-types'),
          { ...defaults('missing-version'), unlocked: 41, currentLevel: 31, stars: { 41: 2 } }
        ];
        committed(result, expected, 'invalid-v1');
        committed(await reload(), expected, 'invalid-v1');
      });
    });

    const legacyCases = [
      ['v1', { nickname: '旧玩家', score: 4321, unlocked: 26, currentLevel: 25,
        stars: { 20: 1, 21: 2, 25: 3, 26: 2, 200: 1, 201: 3 },
        settings: { material: 'acrylic', sound: false, motion: 'lite' } },
        { name: '旧玩家', score: 4321, unlocked: 41, currentLevel: 35,
          stars: { 20: 1, 31: 2, 35: 3, 41: 2, 215: 1 },
          settings: { material: 'acrylic', sound: false, motion: 'lite' } }],
      ['v2', { progressVersion: 2, score: 7654, unlocked: 36, currentLevel: 35,
        stars: { 20: 1, 21: 2, 35: 3, 36: 2, 210: 1, 211: 3 } },
        { score: 7654, unlocked: 41, currentLevel: 35, stars: { 20: 1, 21: 2, 35: 3, 41: 2, 215: 1 } }],
      ['v3', { progressVersion: 3, score: 1357, unlocked: 215, currentLevel: 36,
        stars: { 35: 1, 36: 2, 40: 3, 215: 2, 216: 3 } },
        { score: 1357, unlocked: 215, currentLevel: 36, stars: { 35: 1, 36: 2, 40: 3, 215: 2 } }],
      ['deactivated v1', { progressVersion: 1, score: 987, unlocked: 26, currentLevel: 21,
        stars: { 25: 2, 26: 3, 200: 1 }, deactivated: true },
        { score: 987, unlocked: 41, currentLevel: 31, stars: { 35: 2, 41: 3, 215: 1 }, deactivated: true }],
      ['malformed JSON', '{invalid-json', {}],
      ['null', null, {}],
      ['array', [{ score: 99 }], {}],
      ['prototype keys', JSON.parse('{"stars":{"__proto__":{"35":3},"constructor":3,"36":2},' +
        '"__proto__":{"score":999,"polluted":true}}'), { stars: { 51: 2 } }]
    ];
    for (const [name, raw, overrides] of legacyCases) {
      await withFixture(async ({ page, reload }) => {
        await test('v3 legacy import: ' + name + ' preserves data and imports only once', async () => {
          const legacy = typeof raw === 'string' ? raw : JSON.stringify(raw);
          const state = await page(async legacy => {
            localStorage.setItem('hundred-board-save-v1', legacy);
            localStorage.setItem('unrelated-test-key', 'keep-me');
            await HB.store.init();
            if (({}).polluted !== undefined) throw new Error('Object prototype was polluted');
            return __storeTest.snapshot();
          }, legacy);
          const importedId = overrides.deactivated ? state.db.players.find(profile => profile.deactivated).id : state.data.id;
          const imported = { ...defaults(importedId), ...overrides };
          const expected = overrides.deactivated ? [imported, defaults(state.data.id)] : [imported];
          committed(state, expected, state.data.id);
          assert.equal(state.legacy, legacy);
          assert.equal(state.unrelated, 'keep-me');
          const changed = '{"score":999999,"unlocked":200}';
          await page(value => localStorage.setItem('hundred-board-save-v1', value), changed);
          const again = await reload();
          committed(again, expected, state.data.id);
          assert.equal(again.legacy, changed);
          assert.equal(again.unrelated, 'keep-me');
          committed(await reload(), expected, state.data.id);
        });
      });
    }
  }

  async function append220Regression() {
    const appendFixture = action => withFixture(action, { total: 220, progressVersion: 3 });
    const sources = [
      { version: 1, total: 200, currentLevel: 36, mappedCurrent: 51,
        stars: { 20: 1, 21: 2, 36: 1, 40: 2, 200: 3 },
        mappedStars: { 20: 1, 31: 2, 51: 1, 55: 2, 215: 3 } },
      { version: 2, total: 210, currentLevel: 36, mappedCurrent: 41,
        stars: { 20: 1, 21: 2, 36: 1, 40: 2, 210: 2 },
        mappedStars: { 20: 1, 21: 2, 41: 1, 45: 2, 215: 2 } },
      { version: 3, total: 215, currentLevel: 40, mappedCurrent: 40,
        stars: { 20: 1, 21: 2, 35: 3, 36: 1, 40: 2, 215: 1 },
        mappedStars: { 20: 1, 21: 2, 35: 3, 36: 1, 40: 2, 215: 1 } }
    ];
    const rawProfiles = sources.flatMap(source => [false, true].map(deactivated => ({
      ...defaults('append-v' + source.version + (deactivated ? '-hidden' : '-active'),
        '尾关玩家', source.version),
      avatar: 'owl', score: 4321 + source.version, unlocked: source.total,
      currentLevel: source.currentLevel, stars: source.stars,
      settings: { material: 'starry', sound: false, motion: 'lite' },
      ...(deactivated ? { deactivated: true } : {})
    })));
    const migratedProfiles = rawProfiles.map((profile, i) => ({
      ...profile, progressVersion: 3, unlocked: 216, currentLevel: sources[Math.floor(i / 2)].mappedCurrent,
      stars: sources[Math.floor(i / 2)].mappedStars
    }));

    await appendFixture(async ({ page, reload }) => {
      await test('append220 keeps 216 locked without valid completion and requires unlocked exactly 215', async () => {
        const profiles = [];
        const expected = [];
        for (const source of sources) {
          for (const [i, value] of [undefined, 0, -1, '3'].entries()) {
            const stars = { ...source.stars };
            delete stars[source.total];
            if (value !== undefined) stars[source.total] = value;
            const profile = { ...defaults('incomplete-v' + source.version + '-' + i, '未通关', source.version),
              unlocked: source.total, currentLevel: source.currentLevel, stars };
            const mappedStars = { ...source.mappedStars };
            delete mappedStars[215];
            profiles.push(profile);
            expected.push({ ...profile, progressVersion: 3, unlocked: 215,
              currentLevel: source.mappedCurrent, stars: mappedStars });
          }
        }
        for (const unlocked of [214, 218]) {
          const profile = { ...defaults('exact-unlocked-' + unlocked), unlocked,
            currentLevel: 36, stars: { 36: 2, 40: 3, 215: 1 } };
          profiles.push(profile);
          expected.push(profile);
        }
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, profiles[0].id);
          await HB.store.init();
          return __storeTest.snapshot();
        }, profiles);
        committed(state, expected, profiles[0].id);
        committed(await reload(), expected, profiles[0].id);
        committed(await reload(), expected, profiles[0].id);
      });
    });

    await appendFixture(async ({ page, reload }) => {
      const selected = 'append-v3-active';
      await test('append220 unlocks completed v1/v2/v3 tails including deactivated profiles without changing other fields', async () => {
        const state = await page(async (profiles, selected) => {
          await __storeTest.seed(profiles, selected);
          await HB.store.init();
          return __storeTest.snapshot();
        }, rawProfiles, selected);
        committed(state, migratedProfiles, selected);
      });
      await test('append220 reload, switch and save never unlock again or move existing 36/40 stars', async () => {
        committed(await reload(), migratedProfiles, selected);
        committed(await reload(), migratedProfiles, selected);
        for (const profile of migratedProfiles.filter(profile => !profile.deactivated)) {
          const state = await page(async id => {
            await HB.store.init();
            await HB.store.switchPlayer(id);
            HB.store.save();
            await HB.store.flush();
            return __storeTest.snapshot();
          }, profile.id);
          committed(state, migratedProfiles, profile.id);
          committed(await reload(), migratedProfiles, profile.id);
        }
      });
    });

    for (const source of sources) {
      await appendFixture(async ({ page, reload }) => {
        await test('append220 legacy v' + source.version + ' completed deactivated import unlocks once and stays deactivated', async () => {
          const raw = { ...rawProfiles.find(profile => profile.progressVersion === source.version && profile.deactivated) };
          if (source.version === 1) delete raw.progressVersion;
          const legacy = JSON.stringify(raw);
          const state = await page(async legacy => {
            localStorage.setItem('hundred-board-save-v1', legacy);
            await HB.store.init();
            return __storeTest.snapshot();
          }, legacy);
          const hidden = state.db.players.find(profile => profile.deactivated);
          const expected = [
            { ...migratedProfiles.find(profile => profile.id === raw.id), id: hidden.id },
            defaults(state.data.id)
          ];
          committed(state, expected, state.data.id);
          assert.equal(state.legacy, legacy);
          for (let i = 0; i < 2; i++) {
            const again = await reload();
            committed(again, expected, state.data.id);
            assert.equal(again.legacy, legacy);
          }
        });
      });
    }

    await appendFixture(async ({ page, reload }) => {
      let expected = migratedProfiles.find(profile => profile.id === 'append-v3-active');
      const hidden = migratedProfiles.find(profile => profile.id === 'append-v3-hidden');
      await page(async profiles => {
        await __storeTest.seed(profiles, profiles[0].id);
        await HB.store.init();
      }, [expected, hidden]);
      for (let level = 216; level <= 220; level++) {
        await test('append220 records and reloads level ' + level + ' without moving old progress', async () => {
          const stars = level % 3 + 1;
          const state = await page(async (level, stars) => {
            HB.store.data.currentLevel = level;
            HB.store.recordLevel(level, stars);
            HB.store.recordLevel(level, 1);
            await HB.store.flush();
            return __storeTest.snapshot();
          }, level, stars);
          expected = { ...expected, currentLevel: level, unlocked: Math.min(220, level + 1),
            stars: { ...expected.stars, [level]: stars } };
          committed(state, [expected, hidden], expected.id);
          committed(await reload(), [expected, hidden], expected.id);
        });
      }
      await test('append220 rejects recordLevel 221 without changing any progress', async () => {
        const result = await page(async () => {
          const before = await __storeTest.snapshot();
          HB.store.recordLevel(221, 3);
          await HB.store.flush();
          return { before, after: await __storeTest.snapshot() };
        });
        assert.deepEqual(result.after, result.before);
        committed(result.after, [expected, hidden], expected.id);
        committed(await reload(), [expected, hidden], expected.id);
      });
      await test('append220 reset clears new and old progress but retains identity, settings and other accounts', async () => {
        const state = await page(async () => {
          if (HB.store.reset() !== HB.store.data) throw new Error('reset replaced public data');
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        expected = { ...defaults(expected.id, expected.name), avatar: expected.avatar, settings: expected.settings };
        committed(state, [expected, hidden], expected.id);
        committed(await reload(), [expected, hidden], expected.id);
        committed(await reload(), [expected, hidden], expected.id);
      });
    });

    await appendFixture(async ({ page, reload }) => {
      await test('append220 clamps positions at 220 and drops out-of-range stars on init and reload', async () => {
        const raw = { ...defaults('append-clamp'), unlocked: 221, currentLevel: 221,
          stars: { 36: 1, 40: 2, 215: 3, 220: 2, 221: 3 } };
        const state = await page(async raw => {
          await __storeTest.seed([raw], raw.id);
          await HB.store.init();
          HB.store.recordLevel(220, 3);
          await HB.store.flush();
          return __storeTest.snapshot();
        }, raw);
        const expected = { ...raw, unlocked: 220, currentLevel: 220,
          stars: { 36: 1, 40: 2, 215: 3, 220: 3 } };
        committed(state, [expected], expected.id);
        committed(await reload(), [expected], expected.id);
        committed(await reload(), [expected], expected.id);
      });
    });
  }

  async function versionFourRegression() {
    const v4Fixture = action => withFixture(action, { total: 220, progressVersion: 4 });
    const v4Defaults = (id, name) => defaults(id, name, 4);
    const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
    // Independent oracle: enumerate the old IDs in their new chapter order.
    const chapterOrder = [...range(1, 60), ...range(116, 135), ...range(61, 115), ...range(136, 220)];
    const newIdByOldId = new Map(chapterOrder.map((oldId, index) => [oldId, index + 1]));
    function mappedId(version, oldId) {
      if (version === 4) return oldId;
      let inserted = oldId;
      if (version === 1 && inserted > 20) inserted += 10;
      if (version <= 2 && inserted > 35) inserted += 5;
      return newIdByOldId.get(inserted);
    }

    await v4Fixture(async ({ page, reload }) => {
      await test('v4 batched exhaustive old-ID stars/current and every unlocked prefix for v1/v2/v3/v4', async () => {
        assert.deepEqual(await page(() => ({ total: HB.levels.total, progressVersion: HB.levels.progressVersion })),
          { total: 220, progressVersion: 4 });
        const profiles = [];
        const expected = [];
        for (const [version, total] of [[1, 200], [2, 210], [3, 220], [4, 220]]) {
          let prefixMax = 1;
          const allStars = {};
          const mappedStars = {};
          for (let oldId = 1; oldId <= total; oldId++) {
            const mapped = mappedId(version, oldId);
            prefixMax = Math.max(prefixMax, mapped);
            const value = oldId % 3 + 1;
            allStars[oldId] = value;
            mappedStars[mapped] = value;
            // Tail completion is tested separately; isolate the exact prefix maximum here.
            const profile = { ...defaults('prefix-v' + version + '-' + oldId, '逐关校验', version),
              score: version * 1000 + oldId, unlocked: oldId, currentLevel: oldId,
              stars: mapped === 215 ? {} : { [oldId]: value },
              ...(oldId % 7 === 0 ? { deactivated: true } : {}) };
            profiles.push(profile);
            expected.push({ ...profile, progressVersion: 4, unlocked: prefixMax, currentLevel: mapped,
              stars: mapped === 215 ? {} : { [mapped]: value } });
          }
          const complete = { ...defaults('all-stars-v' + version, '全部星星', version),
            unlocked: 1, currentLevel: total, stars: allStars };
          profiles.push(complete);
          expected.push({ ...complete, progressVersion: 4, currentLevel: mappedId(version, total), stars: mappedStars });
        }
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, 'prefix-v3-116');
          await HB.store.init();
          return __storeTest.snapshot();
        }, profiles);
        // Explicit sentinels guard against incorrectly mapping only the prefix endpoint.
        for (const [oldId, currentLevel, unlocked] of [
          [60, 60, 60], [61, 81, 81], [115, 135, 135], [116, 61, 135],
          [125, 70, 135], [126, 71, 135], [135, 80, 135], [136, 136, 136], [215, 215, 215]
        ]) {
          const actual = state.db.players.find(profile => profile.id === 'prefix-v3-' + oldId);
          assert.equal(actual.currentLevel, currentLevel, 'v3 currentLevel ' + oldId);
          assert.equal(actual.unlocked, unlocked, 'v3 accessible prefix ' + oldId);
        }
        assert.equal(profiles.length, 854);
        committed(state, expected, 'prefix-v3-116');
        committed(await reload(), expected, 'prefix-v3-116');
        committed(await reload(), expected, 'prefix-v3-116');
      });
    });

    const sources = [
      { version: 1, total: 200, unlocked: 101, currentLevel: 101,
        stars: { 20: 1, 21: 2, 25: 3, 26: 1, 45: 2, 46: 3, 100: 1, 101: 2,
          110: 3, 111: 1, 120: 2, 121: 3, 200: 1 },
        mappedStars: { 20: 1, 31: 2, 35: 3, 41: 1, 60: 2, 81: 3, 135: 1, 61: 2,
          70: 3, 71: 1, 80: 2, 136: 3, 215: 1 } },
      { version: 2, total: 210, unlocked: 111, currentLevel: 111,
        stars: { 35: 1, 36: 2, 55: 3, 56: 1, 110: 2, 111: 3, 120: 1, 121: 2, 130: 3, 131: 1, 210: 2 },
        mappedStars: { 35: 1, 41: 2, 60: 3, 81: 1, 135: 2, 61: 3, 70: 1, 71: 2, 80: 3, 136: 1, 215: 2 } },
      { version: 3, total: 215, unlocked: 116, currentLevel: 116,
        stars: { 60: 1, 61: 2, 115: 3, 116: 1, 125: 2, 126: 3, 135: 1, 136: 2, 215: 3 },
        mappedStars: { 60: 1, 81: 2, 135: 3, 61: 1, 70: 2, 71: 3, 80: 1, 136: 2, 215: 3 } }
    ];
    const rawProfiles = sources.flatMap(source => [false, true].map(deactivated => ({
      ...defaults('reorder-v' + source.version + (deactivated ? '-hidden' : '-active'),
        '第' + source.version + '版玩家', source.version),
      avatar: deactivated ? 'owl' : 'fox', score: 4321 + source.version,
      unlocked: source.unlocked, currentLevel: source.currentLevel, stars: source.stars,
      settings: { material: deactivated ? 'starry' : 'acrylic', sound: false, motion: 'lite' },
      ...(deactivated ? { deactivated: true } : {})
    })));
    const migratedProfiles = rawProfiles.map(profile => ({
      ...profile, progressVersion: 4, unlocked: 135, currentLevel: 61,
      stars: sources.find(source => source.version === profile.progressVersion).mappedStars
    }));
    const currentProfile = { ...v4Defaults('reorder-v4-current', '当前版本'), score: 9753,
      unlocked: 126, currentLevel: 116, stars: { 61: 1, 81: 2, 116: 3, 126: 1, 135: 2 } };
    rawProfiles.push(currentProfile);
    migratedProfiles.push(currentProfile);

    await v4Fixture(async ({ page, reload }) => {
      let expected = migratedProfiles;
      await test('v4 mixed active/inactive migration preserves identity, score, settings and selected account', async () => {
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, 'reorder-v3-active');
          localStorage.setItem('hundred-board-save-v1', '{"score":999999}');
          const first = HB.store.init();
          if (first !== HB.store.init()) throw new Error('init promise changed');
          await first;
          await HB.store.init();
          return __storeTest.snapshot();
        }, rawProfiles);
        committed(state, expected, 'reorder-v3-active');
        assert.equal(state.legacy, '{"score":999999}');
        assert.deepEqual(await page(() => ({ done: HB.store.doneCount(), stars: HB.store.totalStars() })),
          { done: 9, stars: 18 });
        committed(await reload(), expected, 'reorder-v3-active');
      });
      await test('v4 repeated init/save/switch never remaps migrated or newly earned reordered stars twice', async () => {
        for (let round = 0; round < 3; round++) {
          for (const profile of expected.filter(profile => !profile.deactivated)) {
            const state = await page(async id => {
              await HB.store.init();
              await HB.store.switchPlayer(id);
              HB.store.data.currentLevel = 116;
              HB.store.recordLevel(61, 2);
              HB.store.recordLevel(116, 3);
              HB.store.save();
              HB.store.save();
              await HB.store.flush();
              return __storeTest.snapshot();
            }, profile.id);
            expected = expected.map(item => item.id !== profile.id ? item : {
              ...item, currentLevel: 116, unlocked: Math.max(117, item.unlocked),
              stars: { ...item.stars, 61: Math.max(item.stars[61] || 0, 2), 116: 3 }
            });
            committed(state, expected, profile.id);
          }
          committed(await reload(), expected, currentProfile.id);
        }
      });
      await test('v4 migrated inactive accounts reject switching without changing retained progress or selection', async () => {
        for (const profile of expected.filter(profile => profile.deactivated)) {
          const result = await page(async id => {
            const before = await __storeTest.snapshot();
            const rejection = await __storeTest.rejection(HB.store.switchPlayer(id));
            const failed = await __storeTest.snapshot();
            HB.store.save();
            await HB.store.flush();
            return { before, failed, rejection, recovered: await __storeTest.snapshot() };
          }, profile.id);
          assert.ok(result.rejection.message.includes('注销'));
          assert.deepEqual(result.failed.db, result.before.db);
          assert.deepEqual(result.failed.data, result.before.data);
          committed(result.recovered, expected, currentProfile.id);
        }
        committed(await reload(), expected, currentProfile.id);
      });
    });

    for (const source of sources) {
      await v4Fixture(async ({ page, reload }) => {
        await test('v' + source.version + ' public API progress upgrades directly to v4 and keeps the accessible prefix', async () => {
          const old = await page(async source => {
            HB.levels.total = source.total;
            HB.levels.progressVersion = source.version;
            await HB.store.init();
            HB.store.addScore(1234);
            HB.store.data.currentLevel = source.currentLevel;
            HB.store.recordLevel(source.unlocked - 1, 1);
            HB.store.save();
            await HB.store.flush();
            return __storeTest.snapshot();
          }, source);
          const original = { ...defaults(old.data.id, '小玩家', source.version), score: 1234,
            unlocked: source.unlocked, currentLevel: source.currentLevel, stars: { [source.unlocked - 1]: 1 } };
          committed(old, [original], original.id);
          const expected = { ...original, progressVersion: 4, unlocked: 135, currentLevel: 61, stars: { 135: 1 } };
          committed(await reload(), [expected], expected.id);
          committed(await reload(), [expected], expected.id);
        });
      });
    }

    await v4Fixture(async ({ page, reload }) => {
      await test('v4 validates original positions and stars before insertion/reorder; stars never expand the prefix', async () => {
        const state = await page(async () => {
          const profiles = [
            { id: 'fraction-v3', progressVersion: 3, unlocked: 116.9, currentLevel: 125.9,
              stars: { 115: 99, 116: 2.9, 125: -1, 126: '3', 135: 1, 136: 2, '0116': 3, '116.5': 3 } },
            { id: 'underflow-v3', progressVersion: 3, unlocked: -10, currentLevel: 0, stars: { 0: 3, 221: 3 } },
            { id: 'nonfinite-v3', progressVersion: 3, unlocked: NaN, currentLevel: Infinity, stars: [3, 3, 3] },
            { id: 'types-v3', progressVersion: 3, unlocked: '116', currentLevel: null },
            { id: 'overflow-v3', progressVersion: 3, unlocked: 221, currentLevel: 221, stars: { 220: 2, 221: 3 } },
            { id: 'overflow-v1', progressVersion: 1, unlocked: 201, currentLevel: 101.9,
              stars: { 101: 2.9, 200: 1, 201: 3, 220: 3 } },
            { id: 'overflow-v2', progressVersion: 2, unlocked: 211, currentLevel: 111.9,
              stars: { 111: 99, 210: 2, 211: 3, 220: 3 } },
            { id: 'missing-version', unlocked: 101, currentLevel: 111, stars: { 101: 2 } },
            { id: 'independent-prefix', progressVersion: 3, unlocked: 1, currentLevel: 135, stars: { 115: 3 } }
          ];
          await __storeTest.seed(profiles, profiles[0].id);
          await HB.store.init();
          return __storeTest.snapshot();
        });
        const expected = [
          { ...v4Defaults('fraction-v3'), unlocked: 135, currentLevel: 70, stars: { 135: 3, 61: 2, 80: 1, 136: 2 } },
          v4Defaults('underflow-v3'), v4Defaults('nonfinite-v3'), v4Defaults('types-v3'),
          { ...v4Defaults('overflow-v3'), unlocked: 220, currentLevel: 220, stars: { 220: 2 } },
          { ...v4Defaults('overflow-v1'), unlocked: 216, currentLevel: 61, stars: { 61: 2, 215: 1 } },
          { ...v4Defaults('overflow-v2'), unlocked: 216, currentLevel: 61, stars: { 61: 3, 215: 2 } },
          { ...v4Defaults('missing-version'), unlocked: 135, currentLevel: 71, stars: { 61: 2 } },
          { ...v4Defaults('independent-prefix'), currentLevel: 80, stars: { 135: 3 } }
        ];
        committed(state, expected, 'fraction-v3');
        committed(await reload(), expected, 'fraction-v3');
      });
    });

    await v4Fixture(async ({ page, reload }) => {
      await test('v4 preserves the completed 215-to-216 append rule for every version and inactive account', async () => {
        const profiles = [];
        const expected = [];
        for (const [version, total] of [[1, 200], [2, 210], [3, 215], [4, 215]]) {
          for (const [index, value] of [undefined, 0, -1, '3', 1, 2.9, 3, 99].entries()) {
            for (const deactivated of [false, true]) {
              const profile = { ...defaults('tail-v' + version + '-' + index + (deactivated ? '-hidden' : '-active'),
                '尾关玩家', version), unlocked: total, currentLevel: total,
                stars: value === undefined ? {} : { [total]: value },
                ...(deactivated ? { deactivated: true } : {}) };
              const valid = typeof value === 'number' && value > 0;
              profiles.push(profile);
              expected.push({ ...profile, progressVersion: 4, unlocked: valid ? 216 : 215, currentLevel: 215,
                stars: valid ? { 215: Math.min(3, Math.floor(value)) } : {} });
            }
          }
        }
        for (const version of [3, 4]) {
          for (const unlocked of [214, 216, 218, 220]) {
            const profile = { ...defaults('tail-exact-v' + version + '-' + unlocked, '保留进度', version),
              unlocked, currentLevel: 215, stars: { 215: 1 } };
            profiles.push(profile);
            expected.push({ ...profile, progressVersion: 4 });
          }
        }
        const state = await page(async profiles => {
          await __storeTest.seed(profiles, profiles[0].id);
          await HB.store.init();
          HB.store.save();
          await HB.store.flush();
          return __storeTest.snapshot();
        }, profiles);
        committed(state, expected, profiles[0].id);
        committed(await reload(), expected, profiles[0].id);
        committed(await reload(), expected, profiles[0].id);
      });
    });

    for (const source of sources) {
      await v4Fixture(async ({ page, reload }) => {
        await test('v4 legacy v' + source.version + ' import reorders once and preserves original localStorage', async () => {
          const raw = { ...rawProfiles.find(profile => profile.progressVersion === source.version && !profile.deactivated) };
          if (source.version === 1) delete raw.progressVersion;
          const legacy = JSON.stringify(raw);
          const state = await page(async legacy => {
            localStorage.setItem('hundred-board-save-v1', legacy);
            localStorage.setItem('unrelated-test-key', 'keep-me');
            await HB.store.init();
            return __storeTest.snapshot();
          }, legacy);
          const expected = { ...migratedProfiles.find(profile => profile.id === raw.id), id: state.data.id };
          committed(state, [expected], expected.id);
          assert.equal(state.legacy, legacy);
          assert.equal(state.unrelated, 'keep-me');
          await page(() => localStorage.setItem('hundred-board-save-v1', '{"score":999999}'));
          for (let i = 0; i < 2; i++) {
            const again = await reload();
            committed(again, [expected], expected.id);
            assert.equal(again.legacy, '{"score":999999}');
            assert.equal(again.unrelated, 'keep-me');
          }
        });
      });
    }

    for (const allDeactivated of [false, true]) {
      await v4Fixture(async ({ page, reload }) => {
        await test('v4 aborted migration atomically rolls back all profiles, markers and ' +
          (allDeactivated ? 'new replacement' : 'active selection'), async () => {
          const profiles = allDeactivated ? rawProfiles.filter(profile => profile.deactivated) : rawProfiles;
          const result = await page(async profiles => {
            await __storeTest.seed(profiles, 'reorder-v3-hidden', false);
            const before = await __storeTest.snapshot();
            const original = IDBObjectStore.prototype.put;
            let written = 0;
            let markers = 0;
            IDBObjectStore.prototype.put = function (...args) {
              const request = Reflect.apply(original, this, args);
              if (this.transaction.db.name === 'hundred-board-db') {
                request.addEventListener('success', () => {
                  if (this.name === 'players') written++;
                  if (this.name === 'meta') markers++;
                  if (this.name === 'meta' && args[0].key === 'legacyMigrated') this.transaction.abort();
                });
              }
              return request;
            };
            let rejection;
            try { rejection = await __storeTest.rejection(HB.store.init()); }
            finally { IDBObjectStore.prototype.put = original; }
            const flush = await __storeTest.rejection(HB.store.flush());
            const repeated = await __storeTest.rejection(HB.store.init());
            return { before, failed: await __storeTest.snapshot(), rejection, flush, repeated, written, markers };
          }, profiles);
          assert.equal(result.written, profiles.length + (allDeactivated ? 1 : 0));
          assert.equal(result.markers, 2);
          assert.ok(result.rejection.message.length > 0);
          assert.deepEqual(result.flush, result.rejection);
          assert.deepEqual(result.repeated, result.rejection);
          assert.equal(result.failed.status, 'error');
          assert.equal(result.failed.error, result.rejection.message);
          assert.deepEqual(result.failed.db, result.before.db, 'no partial reorder, version markers or selection commits');
          assert.deepEqual(result.failed.data, result.before.data, 'no reordered public data before commit');
          assert.deepEqual(result.failed.players, []);
          assert.deepEqual(result.failed.errors, []);
          const recovered = await reload();
          const expected = allDeactivated ? [
            ...migratedProfiles.filter(profile => profile.deactivated), v4Defaults(recovered.data.id)
          ] : migratedProfiles;
          const selected = allDeactivated ? recovered.data.id : 'reorder-v1-active';
          if (allDeactivated) assert.ok(!profiles.some(profile => profile.id === selected));
          committed(recovered, expected, selected);
          committed(await reload(), expected, selected);
        });
      });
    }

    await v4Fixture(async ({ page, reload }) => {
      let first, created;
      await test('fresh v4 init and new account persist version 4 with no inherited migration progress', async () => {
        assert.deepEqual(await page(() => indexedDB.databases()), []);
        const state = await page(async () => { await HB.store.init(); return __storeTest.snapshot(); });
        first = v4Defaults(state.data.id);
        committed(state, [first], first.id);
        assert.equal(state.legacy, null);
        committed(await reload(), [first], first.id);
        const next = await page(async () => {
          await HB.store.createPlayer('全新玩家');
          return __storeTest.snapshot();
        });
        created = v4Defaults(next.data.id, '全新玩家');
        assert.notEqual(first.id, created.id);
        committed(next, [first, created], created.id);
        committed(await reload(), [first, created], created.id);
      });
      await test('v4 records reordered IDs and appended 215-to-220 sequential progress without remapping', async () => {
        const state = await page(async () => {
          HB.store.data.avatar = 'owl';
          HB.store.data.settings = { material: 'starry', sound: false, motion: 'lite' };
          HB.store.addScore(1234);
          for (const level of [60, 61, 80, 81, 115, 116, 125, 126, 135, 136]) HB.store.recordLevel(level, 2);
          HB.store.data.currentLevel = 215;
          HB.store.recordLevel(215, 3);
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        created = { ...created, avatar: 'owl', score: 1234, unlocked: 216, currentLevel: 215,
          stars: { 60: 2, 61: 2, 80: 2, 81: 2, 115: 2, 116: 2, 125: 2, 126: 2, 135: 2, 136: 2, 215: 3 },
          settings: { material: 'starry', sound: false, motion: 'lite' } };
        committed(state, [first, created], created.id);
        committed(await reload(), [first, created], created.id);
        for (let level = 216; level <= 220; level++) {
          const next = await page(async level => {
            HB.store.data.currentLevel = level;
            HB.store.recordLevel(level, 2);
            HB.store.recordLevel(level, 1);
            await HB.store.flush();
            return __storeTest.snapshot();
          }, level);
          created = { ...created, unlocked: Math.min(220, level + 1), currentLevel: level,
            stars: { ...created.stars, [level]: 2 } };
          committed(next, [first, created], created.id);
          committed(await reload(), [first, created], created.id);
        }
        const invalid = await page(async () => {
          const before = await __storeTest.snapshot();
          HB.store.recordLevel(221, 3);
          await HB.store.flush();
          return { before, after: await __storeTest.snapshot() };
        });
        assert.deepEqual(invalid.after, invalid.before);
      });
      await test('v4 reset clears only selected progress and retains identity/settings/version across save and reload', async () => {
        const state = await page(async () => {
          if (HB.store.reset() !== HB.store.data) throw new Error('reset replaced public data');
          await HB.store.init();
          HB.store.save();
          await HB.store.flush();
          return __storeTest.snapshot();
        });
        created = { ...v4Defaults(created.id, created.name), avatar: created.avatar, settings: created.settings };
        committed(state, [first, created], created.id);
        committed(await reload(), [first, created], created.id);
        committed(await reload(), [first, created], created.id);
      });
    });
  }

  app.whenReady().then(async () => {
    // Preserve every historical regression against its original 210-level API.
    await versionTwoRegression(
      action => withFixture(action, { total: 210, progressVersion: 2 }),
      (id, name) => defaults(id, name, 2));
    await versionThreeRegression();
    assert.equal(count, 46, 'all historical v2/v3 regressions must run unchanged');
    await append220Regression();
    assert.equal(count, 60, 'all historical append220 regressions must run unchanged');
    await versionFourRegression();
  }).then(() => finish(), finish);
}

function installHarness(target) {
  // Pin the API version across reloads, independent of concurrent level-content edits.
  if (target) Object.assign(HB.levels, target);
  const errors = [];
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const initialReference = HB.store.data;

  async function database(action, mode = 'readonly', create = false) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hundred-board-db', 1);
      request.onupgradeneeded = () => {
        if (create) {
          request.result.createObjectStore('players', { keyPath: 'id' });
          request.result.createObjectStore('meta', { keyPath: 'key' });
        } else {
          request.transaction.abort();
          reject(new Error('Expected an already committed database'));
        }
      };
      request.onblocked = () => reject(new Error('Test database open blocked'));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(['players', 'meta'], mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || new Error('Inspection transaction aborted'));
        tx.onerror = () => {};
        result = action(tx, db);
      });
    } finally {
      db.close();
    }
  }

  window.__storeTest = {
    errors,
    async rejection(promise) {
      try { await promise; }
      catch (error) { return { name: error.name, message: error.message }; }
      throw new Error('Expected operation to reject, but it resolved');
    },
    seed(profiles, selected, migrated = true) {
      return database(tx => {
        const players = tx.objectStore('players');
        const meta = tx.objectStore('meta');
        players.clear();
        meta.clear();
        for (const profile of profiles) players.put(profile);
        meta.put({ key: 'currentPlayerId', value: selected });
        meta.put({ key: 'legacyMigrated', value: migrated });
      }, 'readwrite', true);
    },
    clearPlayers() {
      return database(tx => { tx.objectStore('players').clear(); }, 'readwrite');
    },
    async snapshot() {
      const db = await database((tx, database) => {
        const result = { version: database.version, stores: Array.from(database.objectStoreNames),
          keyPaths: {}, players: [], meta: [] };
        for (const name of ['players', 'meta']) {
          const table = tx.objectStore(name);
          result.keyPaths[name] = table.keyPath;
          const request = table.getAll();
          request.onsuccess = () => { result[name] = request.result; };
        }
        return result;
      });
      return JSON.parse(JSON.stringify({ db, data: HB.store.data, players: HB.store.players,
        status: HB.store.status, error: HB.store.error && HB.store.error.message,
        sameReference: HB.store.get() === initialReference && HB.store.data === initialReference,
        legacy: localStorage.getItem('hundred-board-save-v1'),
        unrelated: localStorage.getItem('unrelated-test-key'), errors }));
    }
  };
  return { protocol: location.protocol, scripts: Array.from(document.scripts, script => script.src),
    modules: Object.keys(HB).sort(), node: typeof require, errors };
}
