const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

function isolate(root) {
  for (const key of ['userData', 'sessionData', 'crashDumps', 'logs']) {
    const directory = path.join(root, key);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(key, directory);
  }
}

if (process.argv[2] !== '--race-worker') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hundred-board-race-profile-'));
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'hundred-board-race-images-'));
  let code = 1;
  try {
    isolate(path.join(scratch, 'launcher'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, [__filename, '--race-worker', scratch, artifacts], {
      env, stdio: 'inherit', windowsHide: true, timeout: 900000
    });
    if (result.error) throw result.error;
    code = result.status === 0 ? 0 : 1;
  } catch (error) { console.error(error.stack || error); }
  finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
    console.log('Race screenshots: ' + artifacts);
  }
  app.exit(code);
} else {
  isolate(path.join(process.argv[3], 'browser'));
  app.disableHardwareAcceleration();
  app.whenReady().then(run).catch(error => { console.error(error.stack); app.exit(1); });
}

async function run() {
  const window = new BrowserWindow({ width: 1440, height: 1000, show: true,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const page = (fn, ...args) => window.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  async function wait(fn, label, timeout = 12000) {
    const until = Date.now() + timeout;
    while (!(await page(fn))) {
      if (Date.now() > until) throw new Error('Timed out: ' + label);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  async function click(selector, disabled = false) {
    const point = await page(async (selector, disabled) => {
      const el = document.querySelector(selector);
      if (!el || (!disabled && el.disabled) || !el.getClientRects().length) throw new Error('Not clickable: ' + selector);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      let previous = '', stable = 0;
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const r = el.getBoundingClientRect(), geometry = [r.x, r.y, r.width, r.height].join(',');
        stable = geometry === previous ? stable + 1 : 0;
        previous = geometry;
        if (stable < 2) continue;
        const point = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        if (!el.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Click target obscured: ' + selector);
        return point;
      }
      throw new Error('Click target did not settle: ' + selector);
    }, selector, disabled);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function choose(id) {
    await page(id => { document.getElementById('practiceLevel').value = id; }, id);
    await click('#startPracticeBtn');
    assert.equal(await page(() => HB.game.state.level.id), id);
  }
  async function screenshot(name) {
    await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await new Promise(resolve => setTimeout(resolve, 200));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(process.argv[4], name + '.png'), image.toPNG());
  }
  async function question(actor) {
    await wait(() => HB.game.state.race.phase === 'question', 'landing question');
    assert.equal(await page(() => HB.game.state.race.turn), actor);
    assert.equal(await page(() => document.querySelectorAll('#raceAnswers button:not(:disabled)').length), 4);
    assert.equal(await page(() => HB.game.state.busy), false);
  }
  async function answer(correct) {
    const value = await page(correct => {
      const q = HB.game.state.race.question;
      return correct ? q.answer : q.choices.find(n => n !== q.answer);
    }, correct);
    await click('#raceAnswers button[data-value="' + value + '"]');
  }
  async function pieces() {
    return page(() => {
      const info = ['player', 'ai'].map(actor => {
        const piece = document.getElementById('racePiece-' + actor);
        const r = piece.getBoundingClientRect(), n = Number(piece.dataset.cell), cell = HB.board.el(n).getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return { actor, n, x, y, width: r.width, color: getComputedStyle(piece).color,
          inside: x > cell.left && x < cell.right && y > cell.top && y < cell.bottom };
      });
      return { info, overflow: document.documentElement.scrollWidth > innerWidth };
    });
  }
  try {
    await window.loadURL(process.env.HB_TEST_URL || 'http://localhost:5173/index.html');
    await wait(() => window.HB && HB.game.state.level && document.getElementById('saveStatus').textContent.includes('已保存'), 'boot');
    await page(() => {
      window.__raceErrors = [];
      addEventListener('error', e => __raceErrors.push(e.message));
      addEventListener('unhandledrejection', e => __raceErrors.push(String(e.reason)));
      window.__nativeRandom = Math.random;
      Math.random = () => 0.55;
      window.__moves = [];
      const move = HB.board.moveRacePiece;
      HB.board.moveRacePiece = function (actor, next, duration, done) {
        const entry = { actor, from: HB.game.state.race.positions[actor], next, duration, finished: false };
        __moves.push(entry);
        const cancel = move(actor, next, duration, function () { entry.finished = true; done(); });
        entry.frames = document.getElementById('racePiece-' + actor).raceAnimation.effect.getKeyframes().map(f => ({ offset: f.offset, transform: f.transform }));
        return cancel;
      };
    });
    await click('#freeModeToggle');
    const profile = await page(() => JSON.stringify(HB.store.data));
    assert.equal(await page(() => HB.levels.total), 220);
    assert.deepEqual(await page(() => [...document.querySelectorAll('#practiceLevel optgroup')].at(-1).children.length), 5);
    if (!process.env.HB_RACE_FEATURES_ONLY && !process.env.HB_RACE_MATCH_ONLY && !process.env.HB_RACE_DUEL_ONLY) {
    await choose(216);
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
    assert.equal(await page(() => document.querySelectorAll('#grid .cell:disabled').length), 100);
    assert.equal(await page(() => document.getElementById('hintBtn').hidden), true);
    const initialPieces = await pieces();
    assert(initialPieces.info.every(p => p.inside));
    assert(initialPieces.info[1].x - initialPieces.info[0].x >= initialPieces.info[0].width);
    assert.equal(await page(() => {
      for (let n = 1; n < 100; n++) {
        const a = HB.board.el(n), b = HB.board.el(n + 1);
        if (Math.abs(Number(a.style.gridRow) - Number(b.style.gridRow)) + Math.abs(Number(a.style.gridColumn) - Number(b.style.gridColumn)) !== 1) return false;
      }
      return true;
    }), true);
    await screenshot('race-start');
    await click('#raceRoll');
    await click('#raceRoll', true);
    await question('player');
    assert.equal(await page(() => HB.game.state.race.positions.player), 5);
    assert.deepEqual(await page(() => __moves.map(m => m.next)), [2, 3, 4, 5]);
    assert.equal(await page(() => __moves.every(m => m.finished && m.duration === 260)), true);
    await screenshot('race-question');
    await answer(true);
    await question('ai');
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 7, ai: 5 });
    await screenshot('race-ai-question');
    await answer(true);
    await wait(() => HB.game.state.race.phase === 'roll', 'AI retreat');
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 7, ai: 3 });
    await click('#raceRoll');
    await question('player');
    assert.equal(await page(() => HB.game.state.race.positions.player), 11);
    await answer(false);
    await question('ai');
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 10, ai: 7 });
    await answer(false);
    await wait(() => HB.game.state.race.phase === 'roll', 'AI advance');
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 10, ai: 10 });
    assert.equal(await page(() => HB.game.state.mistakes), 2);
    assert.equal(await page(() => __moves.every(m => m.finished && Math.abs(m.next - m.from) === 1)), true);
    assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
    for (const material of ['wood', 'acrylic', 'macaron', 'starry']) {
      await page(material => HB.board.applyMaterial(material), material);
      const state = await pieces();
      assert(state.info.every(p => p.inside));
      assert.equal(await page(() => !!document.querySelector('#racePiece-player path[fill="#e45165"]') && !!document.querySelector('#racePiece-ai path[fill="#368fd4"]')), true);
      assert(!state.overflow);
      await screenshot('race-' + material);
    }
    for (const [width, height] of [[1366, 768], [800, 900], [400, 800]]) {
      window.setSize(width, height);
      await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await pieces();
      assert(state.info.every(p => p.inside), 'Pieces track their cells after resize');
      assert(!state.overflow, 'No horizontal overflow at ' + width);
      await page(() => document.getElementById('board').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await screenshot('race-board-' + width);
      await page(() => document.getElementById('racePanel').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await screenshot('race-panel-' + width);
    }
    window.setSize(1440, 1000);
    await page(() => HB.board.applyMaterial('wood'));
    console.log('PASS race UI: native dice, every animated step, snake row crossings, four answer consequences, shared cells, four materials and 400/800/1366 layouts');

    for (const id of [217, 218, 219, 220]) {
      await choose(id);
      await click('#raceRoll');
      await question('player');
      assert.equal(await page(() => HB.game.state.level.maxNumber), 20);
      await answer(true);
      await click('#replayBtn');
      assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
      assert.equal(await page(() => HB.game.state.race.phase), 'roll');
    }
    await choose(216);
    await click('#raceRoll');
    await wait(() => HB.game.state.race.phase === 'moving', 'in-flight reset');
    await click('#replayBtn');
    await page(() => new Promise(resolve => setTimeout(resolve, 2200)));
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
    assert.equal(await page(() => HB.game.state.race.phase), 'roll');
    await click('#raceRoll');
    await question('player');
    await answer(true);
    await wait(() => HB.game.state.race.phase === 'waiting', 'scheduled AI roll');
    await choose(41);
    await page(() => new Promise(resolve => setTimeout(resolve, 1800)));
    assert.equal(await page(() => HB.game.state.level.id), 41);
    assert.equal(await page(() => document.getElementById('racePanel').hidden), true);
    assert.equal(await page(() => document.querySelectorAll('.race-piece').length), 0);
    assert.equal(await page(() => HB.game.state.race), null);
    assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
    console.log('PASS race UI: all five chapters launch, replay during animation and switch during AI wait cancel stale work');

    await page(() => { Math.random = () => 0.999; });
    await choose(216);
    let turns = 0;
    while (!(await page(() => HB.game.state.done))) {
      const phase = await page(() => HB.game.state.race.phase);
      if (phase === 'roll') await click('#raceRoll');
      await wait(() => HB.game.state.done || HB.game.state.race.phase === 'question', 'full race landing');
      if (await page(() => HB.game.state.done)) break;
      await answer(true);
      await wait(() => HB.game.state.done || ['roll', 'waiting'].includes(HB.game.state.race.phase), 'full race answer');
      assert(++turns < 60);
    }
    await wait(() => !document.getElementById('overlay').hidden, 'win overlay');
    assert.equal(await page(() => HB.game.state.race.winner), 'player');
    assert.equal(await page(() => HB.game.state.race.positions.player), 100);
    assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
    assert.match(await page(() => document.getElementById('ovTitle').textContent), /获胜/);
    assert.equal(await page(() => document.getElementById('ovNext').hidden), false);
    await screenshot('race-win');
    await click('#ovNext');
    assert.equal(await page(() => HB.game.state.level.id), 217);
    console.log('PASS race UI: complete native-input race from 1 to 100, all step animations, win overlay and next level');

    for (const actor of ['player', 'ai']) {
      await choose(220);
      await page(actor => {
        const r = HB.game.state.race;
        r.positions[actor] = 98;
        HB.board.placeRacePiece(actor, 98);
      }, actor);
      await click('#raceRoll');
      if (actor === 'ai') { await question('player'); await answer(true); }
      await wait(() => !document.getElementById('overlay').hidden, actor + ' terminal dice');
      assert.equal(await page(() => HB.game.state.race.winner), actor);
      assert.equal(await page(actor => HB.game.state.race.positions[actor], actor), 100);
      assert.equal(await page(() => document.getElementById('ovNext').hidden), true);
      assert.equal(await page(() => document.getElementById('ovStars').hidden), actor === 'ai');
      assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
      if (actor === 'ai') {
        assert.match(await page(() => document.getElementById('ovTitle').textContent), /电脑先到/);
        await screenshot('race-loss');
      }
      await click('#ovReplay');
      assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
    }
    console.log('PASS race UI: terminal clamping, computer victory, final-level next button, loss/replay and profile isolation');
    }

    async function fresh(id = 219) {
      await page(() => { Math.random = () => .55; });
      await choose(id);
      await page(() => { __moves.length = 0; });
    }
    async function position(actor, cell) {
      await page((actor, cell) => {
        HB.game.state.race.positions[actor] = cell;
        HB.board.placeRacePiece(actor, cell);
      }, actor, cell);
    }
    async function safeCell() {
      return page(() => {
        const lv = HB.game.state.level;
        const special = lv.traps.concat(lv.ladders.map(l => l.from));
        return Array.from({ length: 65 }, (_, i) => i + 12).find(n =>
          [n - 2, n - 1, n, n + 2, n + 3].every(c => !special.includes(c)));
      });
    }
    async function landOn(cell, random = .01) {
      const dice = 1 + Math.floor(random * 6);
      await position('player', cell - dice);
      await page(value => { Math.random = () => value; }, random);
      await click('#raceRoll');
    }
    if (!process.env.HB_RACE_MATCH_ONLY && !process.env.HB_RACE_DUEL_ONLY) {
    for (const id of [216, 217, 218, 219, 220]) {
      await fresh(id);
      const q = await page(() => JSON.stringify(HB.game.state.level.questions));
      await click('#replayBtn');
      assert.notEqual(await page(() => JSON.stringify(HB.game.state.level.questions)), q, 'same random source still refreshes questions');
      assert.deepEqual(await page(() => [HB.game.state.level.ladders.length, HB.game.state.level.traps.length]),
        id === 216 ? [0, 0] : id === 217 ? [3, 5] : [5, 6]);
      assert.equal(await page(() => document.getElementById('raceCards').hidden), id < 219);
      assert.equal(await page(() => document.querySelectorAll('.race-piece svg').length), 2);
      assert.equal(await page(() => document.querySelectorAll('.race-ladders g[data-from]').length), id === 216 ? 0 : id === 217 ? 3 : 5);
      assert.equal(await page(() => document.querySelectorAll('.race-pit').length), id === 216 ? 0 : id === 217 ? 5 : 6);
    }

    await fresh(217);
    const ladder = await page(() => HB.game.state.level.ladders[0]);
    await landOn(ladder.from);
    await question('player');
    assert.equal(await page(() => HB.game.state.race.positions.player), ladder.to);
    assert.deepEqual(await page(() => __moves.map(m => [m.next, m.duration])), [[ladder.from, 260], [ladder.to, 560]]);
    assert.equal(await page(() => __moves.every(m => m.frames.length === 6 && m.frames[2].offset === .5 && m.frames[4].offset === .9)), true);
    assert.match(await page(() => document.getElementById('raceEvent').textContent), /梯子/);
    await screenshot('race-ladder');
    for (const [random, retreat] of [[0, 5], [.999, 10]]) {
      await fresh(217);
      const trap = await page(() => HB.game.state.level.traps[0]);
      await landOn(trap, random);
      await question('player');
      assert.equal(await page(() => HB.game.state.race.positions.player), trap - retreat);
      assert.equal(await page(() => __moves.every(m => m.finished && Math.abs(m.next - m.from) === 1)), true);
      assert.match(await page(() => document.getElementById('raceEvent').textContent), new RegExp('后退 ' + retreat));
    }
    await screenshot('race-trap');
    await fresh(218);
    const aiLadder = await page(() => HB.game.state.level.ladders[0]);
    await landOn(await safeCell());
    await question('player');
    await position('ai', aiLadder.from - 1);
    await answer(true);
    await question('ai');
    assert.equal(await page(() => HB.game.state.race.positions.ai), aiLadder.to);
    assert.equal(await page(() => __moves.some(m => m.actor === 'ai' && m.duration === 560)), true);
    console.log('PASS adventure UI: all five fresh question sets, exact obstacle counts, player/AI direct ladders and 5/10-step trap jumps.');

    for (const [random, card] of [[.01, 'sleep'], [.2, 'immune']]) {
      await fresh();
      const safe = await safeCell();
      await landOn(safe, random);
      await question('player');
      await answer(true);
      assert.equal(await page(() => HB.game.state.race.phase), 'reward');
      assert.deepEqual(await page(() => HB.game.state.race.cards.player), [card]);
      assert.equal(await page(() => HB.game.state.race.positions.player), safe);
      assert.equal(await page(() => HB.game.state.busy), true);
      await screenshot('race-card-earned-' + card);
    }
    await fresh();
    const safe = await safeCell();
    await page(() => { HB.game.state.race.cards.player = ['sleep', 'immune']; });
    await landOn(safe);
    await wait(() => HB.game.state.race.phase === 'cards', 'card choice');
    await click('#raceContinue');
    await question('player');
    await answer(true);
    await wait(() => HB.game.state.race.phase === 'waiting', 'full hand normal reward');
    assert.equal(await page(() => HB.game.state.race.positions.player), safe + 2);
    assert.deepEqual(await page(() => HB.game.state.race.cards.player), ['sleep', 'immune']);

    await fresh();
    const protectedTrap = await page(() => HB.game.state.level.traps[0]);
    await page(() => { HB.game.state.race.cards.player = ['sleep', 'immune']; });
    await landOn(protectedTrap);
    await wait(() => HB.game.state.race.phase === 'cards', 'pre-trap card choice');
    assert.equal(await page(() => document.getElementById('raceAnswers').hidden), true);
    await screenshot('race-card-choice');
    for (const material of ['wood', 'acrylic', 'macaron', 'starry']) {
      await page(material => {
        HB.board.applyMaterial(material);
        document.getElementById('board').scrollIntoView({ block: 'center', behavior: 'instant' });
      }, material);
      assert((await pieces()).info.every(p => p.inside));
      await screenshot('race-adventure-' + material);
    }
    await page(() => HB.board.applyMaterial('wood'));
    for (const [width, height] of [[1366, 768], [800, 900], [400, 800]]) {
      window.setSize(width, height);
      await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(!(await pieces()).overflow);
      assert((await pieces()).info.every(p => p.inside));
      assert.equal(await page(() => [...document.querySelectorAll('.race-ladders g[data-from]')].every(group => {
        const circle = group.querySelector('circle'), svg = group.ownerSVGElement;
        const point = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))).matrixTransform(svg.getScreenCTM());
        const cell = HB.board.el(Number(group.dataset.from)).getBoundingClientRect();
        return Math.abs(point.x - cell.x - cell.width * .5) < 2 && Math.abs(point.y - cell.y - cell.height * .52) < 2;
      })), true, 'Ladder endpoints follow rendered cells after resize');
      await page(() => document.getElementById('board').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await screenshot('race-adventure-board-' + width);
      await page(() => document.getElementById('raceCards').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await screenshot('race-adventure-cards-' + width);
    }
    window.setSize(1440, 1000);
    await click('#raceHand [data-card="immune"]');
    assert.equal(await page(() => HB.game.state.race.shields.player), true);
    await click('#raceHand [data-card="sleep"]');
    assert.equal(await page(() => HB.game.state.race.sleeping.ai), true);
    await click('#raceContinue');
    await question('player');
    assert.equal(await page(() => HB.game.state.race.positions.player), protectedTrap);
    assert.equal(await page(() => HB.game.state.race.shields.player), false);
    await page(() => { Math.random = () => .55; });
    await answer(true);
    await wait(() => HB.game.state.race.phase === 'sleeping', 'AI sleep skip');
    await wait(() => HB.game.state.race.phase === 'roll', 'one skipped turn');
    assert.equal(await page(() => HB.game.state.race.turnNumber), 3);
    assert.equal(await page(() => HB.game.state.race.sleeping.ai), false);
    assert.equal(await page(() => HB.game.state.race.positions.ai), 1);
    await screenshot('race-sleep-skipped');

    await fresh();
    const safe2 = await safeCell();
    await page(() => { HB.game.state.race.cards.player = ['immune']; HB.game.state.race.cards.ai = ['sleep']; });
    await landOn(safe2);
    await wait(() => HB.game.state.race.phase === 'cards', 'activate shield');
    await click('#raceHand [data-card="immune"]');
    await click('#raceContinue');
    await question('player');
    await position('ai', safe2 - 4);
    await page(() => { Math.random = () => .55; });
    await answer(true);
    await question('ai');
    assert.deepEqual(await page(() => HB.game.state.race.cards.ai), []);
    assert.equal(await page(() => HB.game.state.race.shields.player), false);
    assert.equal(await page(() => HB.game.state.race.sleeping.player), false);
    assert.match(await page(() => document.getElementById('raceEvent').textContent), /免疫保护抵挡/);

    await fresh();
    const aiTrap = await page(() => HB.game.state.level.traps[0]);
    await page(() => { HB.game.state.race.cards.ai = ['immune']; });
    await landOn(await safeCell());
    await question('player');
    await position('ai', aiTrap - 1);
    await answer(false);
    await question('ai');
    assert.equal(await page(() => HB.game.state.race.positions.ai), aiTrap);
    assert.deepEqual(await page(() => HB.game.state.race.cards.ai), []);
    assert.equal(await page(() => HB.game.state.race.shields.ai), false);
    await answer(false);
    assert.equal(await page(() => HB.game.state.race.phase), 'reward');
    assert.deepEqual(await page(() => HB.game.state.race.cards.ai), ['sleep']);
    assert.equal(await page(() => HB.game.state.race.positions.ai), aiTrap);
    console.log('PASS cards UI: both reward types, AI beneficial rewards, full hand cap, native use/decline, one-turn sleep, trap/sleep immunity, AI automatic cards and three viewport sizes.');

    await fresh();
    await page(() => { HB.game.state.race.cards.player = ['sleep']; });
    await landOn(await safeCell());
    await wait(() => HB.game.state.race.phase === 'cards', 'reset card choice');
    await click('#replayBtn');
    assert.deepEqual(await page(() => HB.game.state.race.cards), { player: [], ai: [] });
    assert.deepEqual(await page(() => HB.game.state.race.shields), { player: false, ai: false });
    await fresh(217);
    const cancelLadder = await page(() => HB.game.state.level.ladders[0]);
    await landOn(cancelLadder.from);
    await wait(() => __moves.some(m => m.duration === 560 && !m.finished), 'mid-ladder cancellation');
    await click('#replayBtn');
    await page(() => new Promise(resolve => setTimeout(resolve, 1000)));
    assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
    assert.equal(await page(() => HB.game.state.race.phase), 'roll');
    assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
    console.log('PASS adventure cancellation: replay during cards/long jump resets all effects, no account writes.');
    }

    if (!process.env.HB_RACE_DUEL_ONLY) {
    await fresh(220);
    let actions = 0, playerAnswers = 0, cardsPlayed = 0;
    const matchStart = await page(() => __moves.length);
    while (!(await page(() => HB.game.state.done))) {
      await wait(() => HB.game.state.done || ['roll', 'cards', 'question'].includes(HB.game.state.race.phase), 'adventure match input');
      if (await page(() => HB.game.state.done)) break;
      const phase = await page(() => HB.game.state.race.phase);
      if (phase === 'roll') {
        await page(() => {
          const lv = HB.game.state.level, r = HB.game.state.race;
          const land = n => {
            const ladder = lv.ladders.find(l => l.from === n);
            return ladder ? ladder.to : lv.traps.includes(n) && !r.shields.player ? n - 10 : n;
          };
          const choices = [1, 2, 3, 4, 5, 6].map(dice => {
            const first = Math.min(100, r.positions.player + dice);
            const end = first === 100 ? 100 : Math.min(100, land(first) + 2);
            return { dice, score: end === 100 ? 100 : land(end) };
          });
          choices.sort((a, b) => b.score - a.score || b.dice - a.dice);
          Math.random = () => (choices[0].dice - .5) / 6;
        });
        await click('#raceRoll');
      } else if (phase === 'cards') {
        assert.equal(await page(() => HB.game.state.race.turn), 'player');
        for (const card of ['immune', 'sleep']) {
          if (await page(card => !!document.querySelector('#raceHand [data-card="' + card + '"]:not(:disabled)'), card)) {
            await click('#raceHand [data-card="' + card + '"]');
            cardsPlayed++;
          }
        }
        await click('#raceContinue');
      } else {
        const actor = await page(() => HB.game.state.race.turn);
        const random = actor === 'player' && playerAnswers % 4 === 0 ? (playerAnswers % 8 === 0 ? .1 : .2) : .55;
        await page(random => { Math.random = () => random; }, random);
        await answer(true);
        if (actor === 'player') playerAnswers++;
      }
      assert(++actions < 140, 'Complete adventure must terminate');
    }
    await wait(() => !document.getElementById('overlay').hidden, 'adventure final victory');
    assert.equal(await page(() => HB.game.state.race.winner), 'player');
    assert.equal(await page(() => HB.game.state.race.positions.player), 100);
    assert.equal(await page(() => document.getElementById('ovNext').hidden), true);
    assert(cardsPlayed > 0 && playerAnswers > 0, 'Full match obtains and uses cards naturally');
    assert.equal(await page(start => __moves.slice(start).every(m => m.finished), matchStart), true);
    assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
    await screenshot('race-adventure-complete');
    console.log('PASS full level-220 adventure: natural 1–100 native-input victory, real obstacles, naturally earned/used cards, final-level overlay and all animations.');
    }

    if (!process.env.HB_RACE_MATCH_ONLY && !process.env.HB_RACE_FEATURES_ONLY) {
      async function attacked(id) {
        await fresh(id);
        await click('#raceAiMode');
        const safe = await safeCell();
        await page(() => { HB.game.state.race.cards.player = ['immune']; HB.game.state.race.cards.ai = ['sleep']; });
        await landOn(safe, .55);
        await wait(() => HB.game.state.race.phase === 'cards', 'keep immune in hand');
        await click('#raceContinue');
        await question('player');
        await position('ai', safe - 4);
        await answer(true);
        await wait(() => HB.game.state.race.phase === 'defense', 'AI sleep response');
        assert.equal(await page(() => HB.game.state.race.turn), 'ai');
        assert.equal(await page(() => HB.game.state.race.positions.ai), safe);
        assert.equal(await page(() => HB.game.state.race.sleeping.player), false);
        assert.equal(await page(() => HB.game.state.race.question), null);
        assert.equal(await page(() => document.getElementById('raceDefense').hidden), false);
        assert.equal(await page(() => document.querySelectorAll('#raceDefenseActions button:not(:disabled)').length), 2);
        return safe;
      }
      for (const id of [219, 220]) {
        for (const useImmune of [true, false]) {
          const safe = await attacked(id);
          const paused = await page(() => JSON.stringify(HB.game.state.race));
          await click('#raceRoll', true);
          await page(() => new Promise(resolve => setTimeout(resolve, 1400)));
          assert.equal(await page(() => JSON.stringify(HB.game.state.race)), paused, 'Attack must wait for an explicit response');
          if (id === 219 && useImmune) {
            for (const [width, height] of [[1366, 768], [800, 900], [400, 800]]) {
              window.setSize(width, height);
              await page(() => document.getElementById('raceDefense').scrollIntoView({ block: 'center', behavior: 'instant' }));
              assert(!(await pieces()).overflow);
              assert.equal(await page(() => [...document.querySelectorAll('#raceDefenseActions button')].every(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.left >= 0 && r.right <= innerWidth;
              })), true);
              await screenshot('race-defense-' + width);
            }
            window.setSize(1440, 1000);
          }
          await click('#raceDefenseActions [data-defense="' + (useImmune ? 'immune' : 'accept') + '"]');
          await question('ai');
          assert.equal(await page(() => HB.game.state.race.positions.ai), safe);
          assert.deepEqual(await page(() => HB.game.state.race.cards.player), useImmune ? [] : ['immune']);
          assert.equal(await page(() => HB.game.state.race.shields.player), false);
          assert.equal(await page(() => HB.game.state.race.sleeping.player), !useImmune);
          assert.equal(await page(() => document.getElementById('raceDefense').hidden), true);
          await answer(true);
          if (useImmune) {
            await wait(() => HB.game.state.race.phase === 'roll', 'protected player gets turn');
            assert.equal(await page(() => HB.game.state.race.turn), 'player');
          } else {
            await wait(() => HB.game.state.race.phase === 'sleeping', 'declined defense skips exactly one turn');
            assert.equal(await page(() => HB.game.state.race.turn), 'player');
          }
          assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
        }
      }
      for (const selector of ['#replayBtn', '#raceLocalMode']) {
        await attacked(219);
        await page(() => { window.__oldDefense = [...document.querySelectorAll('#raceDefenseActions button')]; });
        await click(selector);
        await page(() => { __oldDefense.forEach(button => button.click()); });
        assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
        assert.equal(await page(() => HB.game.state.race.phase), 'roll');
        assert.equal(await page(() => HB.game.state.race.defense), null);
        assert.equal(await page(() => document.getElementById('raceDefense').hidden), true);
      }
      console.log('PASS defensive UI: 219/220 explicit use/decline, paused AI chain, actual skipped/protected turn, stale response cancellation and 400/800/1366 layouts.');

      for (const id of [216, 217, 218, 219, 220]) {
        await fresh(id);
        await click('#raceLocalMode');
        const safe = await safeCell();
        assert.equal(await page(() => document.getElementById('raceLocalMode').getAttribute('aria-pressed')), 'true');
        assert.match(await page(() => document.getElementById('raceAiName').textContent), /玩家2/);
        assert.match(await page(() => document.getElementById('racePiece-ai').getAttribute('aria-label')), /玩家2/);
        assert.match(await page(() => document.getElementById('modeNote').textContent), /不计积分/);
        await landOn(safe, .55);
        await question('player');
        await answer(true);
        await wait(() => HB.game.state.race.phase === 'roll', 'manual second player turn');
        assert.equal(await page(() => HB.game.state.race.turn), 'ai');
        assert.equal(await page(() => HB.game.state.race.positions.player), safe + 2);
        await page(() => new Promise(resolve => setTimeout(resolve, 1400)));
        assert.equal(await page(() => HB.game.state.race.phase), 'roll', 'No automatic second-player dice');
        assert.equal(await page(() => HB.game.state.race.positions.ai), 1);
        await position('ai', safe - 4);
        await click('#raceRoll');
        await question('ai');
        assert.match(await page(() => document.getElementById('raceQuestionLabel').textContent), /请玩家2/);
        await answer(false);
        await wait(() => HB.game.state.race.phase === 'roll', 'second player wrong-answer retreat');
        assert.equal(await page(() => HB.game.state.race.positions.ai), safe - 1);
        assert.equal(await page(() => HB.game.state.race.turn), 'player');
        assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
      }

      for (const id of [219, 220]) {
        await fresh(id);
        const safe = await safeCell();
        await page(() => { HB.game.state.race.cards.player = ['sleep', 'immune']; HB.game.state.race.cards.ai = ['sleep', 'immune']; });
        await landOn(safe, .55);
        await wait(() => HB.game.state.race.phase === 'cards', 'first human hand');
        await click('#raceHand [data-card="sleep"]');
        assert.equal(await page(() => HB.game.state.race.defense.defender), 'ai');
        assert.match(await page(() => document.getElementById('raceDefensePrompt').textContent), /玩家2/);
        await click('#raceDefenseActions [data-defense="immune"]');
        assert.equal(await page(() => HB.game.state.race.phase), 'cards');
        assert.deepEqual(await page(() => HB.game.state.race.cards.ai), ['sleep']);
        await click('#raceContinue');
        await question('player');
        await answer(false);
        await wait(() => HB.game.state.race.phase === 'roll', 'second human hand turn');
        await position('ai', safe - 4);
        await click('#raceRoll');
        await wait(() => HB.game.state.race.phase === 'cards', 'second human card choice');
        assert.match(await page(() => document.getElementById('raceHand').getAttribute('aria-label')), /玩家2/);
        await click('#raceHand [data-card="sleep"]');
        assert.equal(await page(() => HB.game.state.race.defense.defender), 'player');
        await screenshot('race-local-defense-' + id);
        if (id === 219) {
          for (const [width, height] of [[1366, 768], [800, 900], [400, 800]]) {
            window.setSize(width, height);
            await page(() => document.getElementById('raceDefense').scrollIntoView({ block: 'center', behavior: 'instant' }));
            assert(!(await pieces()).overflow, 'Local player labels must fit at ' + width);
            await screenshot('race-local-panel-' + width);
          }
          window.setSize(1440, 1000);
        }
        await click('#raceDefenseActions [data-defense="' + (id === 219 ? 'accept' : 'immune') + '"]');
        assert.equal(await page(() => HB.game.state.race.phase), 'cards');
        await click('#raceContinue');
        await question('ai');
        await answer(false);
        if (id === 219) {
          await wait(() => HB.game.state.race.phase === 'sleeping', 'local first player skips');
          await wait(() => HB.game.state.race.phase === 'roll', 'local skip resumes second player');
          assert.equal(await page(() => HB.game.state.race.turn), 'ai');
        } else {
          await wait(() => HB.game.state.race.phase === 'roll', 'local immune restores first player turn');
          assert.equal(await page(() => HB.game.state.race.turn), 'player');
        }
      }
      console.log('PASS local UI: five levels, symmetric answers, no AI timers, both human hands/defenders, explicit rejection, immunity and one-turn sleep.');

      for (const winner of ['player', 'ai']) {
        await fresh(220);
        let actions = 0, earned = 0, used = 0, correctAnswers = 0;
        while (!(await page(() => HB.game.state.done))) {
          await wait(() => HB.game.state.done || ['roll', 'cards', 'question', 'defense'].includes(HB.game.state.race.phase), 'local full match input');
          if (await page(() => HB.game.state.done)) break;
          const { phase, turn } = await page(() => HB.game.state.race);
          if (phase === 'roll') {
            await page(winner => {
              const lv = HB.game.state.level, r = HB.game.state.race, actor = r.turn;
              const land = n => {
                const ladder = lv.ladders.find(l => l.from === n);
                return ladder ? ladder.to : lv.traps.includes(n) && !r.shields[actor] ? Math.max(1, n - 8) : n;
              };
              const choices = [1, 2, 3, 4, 5, 6].map(dice => {
                const first = Math.min(100, r.positions[actor] + dice);
                const end = first === 100 ? 100 : Math.min(100, land(first) + 2);
                return { dice, score: end === 100 ? 100 : land(end) };
              }).sort((a, b) => b.score - a.score || b.dice - a.dice);
              Math.random = () => actor === winner ? (choices[0].dice - .5) / 6 : .01;
            }, winner);
            await click('#raceRoll');
          } else if (phase === 'cards') {
            for (const card of ['immune', 'sleep']) {
              if (await page(card => !!document.querySelector('#raceHand [data-card="' + card + '"]:not(:disabled)'), card)) {
                await click('#raceHand [data-card="' + card + '"]');
                used++;
                if (await page(() => HB.game.state.race.phase === 'defense')) break;
              }
            }
            if (await page(() => HB.game.state.race.phase === 'cards')) await click('#raceContinue');
          } else if (phase === 'defense') {
            await click('#raceDefenseActions [data-defense="immune"]');
          } else {
            const random = turn === winner && correctAnswers % 4 === 0 ? (correctAnswers % 8 ? .2 : .1) : .55;
            await page(random => { Math.random = () => random; }, random);
            await answer(turn === winner);
            if (turn === winner) correctAnswers++;
            if (await page(() => HB.game.state.race.phase === 'reward')) earned++;
          }
          assert(++actions < 220, 'Local natural game must terminate');
        }
        await wait(() => !document.getElementById('overlay').hidden, 'local winner overlay');
        assert.equal(await page(() => HB.game.state.race.winner), winner);
        assert.match(await page(() => document.getElementById('ovTitle').textContent), new RegExp(winner === 'player' ? '玩家1.*获胜' : '玩家2.*获胜'));
        assert.equal(await page(() => document.getElementById('ovStars').hidden), true);
        assert.equal(await page(() => document.getElementById('ovNext').hidden), true);
        assert.match(await page(() => document.getElementById('ovScore').textContent), /不计积分/);
        assert(earned > 0 && used > 0, 'Each human winner must naturally earn/use cards');
        assert.equal(await page(() => __moves.every(m => m.finished)), true);
        assert.equal(await page(() => JSON.stringify(HB.store.data)), profile);
        await screenshot('race-local-winner-' + winner);
        await click('#ovReplay');
        assert.equal(await page(() => HB.game.state.raceMode), 'local');
        assert.deepEqual(await page(() => HB.game.state.race.positions), { player: 1, ai: 1 });
      }
      await click('#raceAiMode');
      assert.equal(await page(() => HB.game.state.raceMode), 'ai');
      assert.match(await page(() => document.getElementById('raceAiName').textContent), /电脑/);
      assert.match(await page(() => document.getElementById('racePiece-ai').getAttribute('aria-label')), /电脑/);
      console.log('PASS local full level-220 games: both human winners from 1–100, earned/used cards, actual animations, winner/replay UI and no profile writes.');
    }
    await page(() => { Math.random = __nativeRandom; });
    assert.deepEqual(await page(() => __raceErrors), []);
    assert.deepEqual(errors, []);
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    try {
      console.error(await page(() => ({ level: HB.game.state.level.id, race: HB.game.state.race, errors: __raceErrors })));
      await screenshot('race-failure');
    } catch (_) {}
    window.destroy();
    app.exit(1);
  }
}
