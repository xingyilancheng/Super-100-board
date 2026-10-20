const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.scrolls = [];
    this.disabled = false;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.style = { setProperty() {} };
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => this.classes.add(n)),
      remove: (...names) => names.forEach(n => this.classes.delete(n)),
      contains: name => this.classes.has(name),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  set innerHTML(value) { this.children.forEach(node => { node.parent = null; }); this.children = []; }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(node) { this.children.push(node); node.parent = this; }
  replaceWith(node) { this.parent.children.splice(this.parent.children.indexOf(this), 1, node); node.parent = this.parent; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { if (!this.disabled) this.listeners.click?.({ currentTarget: this, target: this }); }
  querySelectorAll(selector) {
    assert.ok(['button', 'button[data-card]'].includes(selector), 'implement selectors explicitly instead of returning unrelated nodes');
    return this.children.flatMap(node => [...(node.tagName === 'BUTTON' &&
      (selector === 'button' || node.dataset.card !== undefined) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  scrollIntoView(options) { this.scrolls.push(options); }
  closest() { return this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 32, height: 32 }; }
}

const els = new Map();
const get = id => {
  if (!els.has(id)) els.set(id, new Element());
  return els.get(id);
};
const cells = new Map();
let blanks = [], flight = null, overlay = null, timerId = 0;
const timers = new Map();
const raceMoves = [];
let pendingRaceMove = null, raceMoveCancellations = 0;
let saves = 0;
const HB = {
  store: {
    data: { id: 'test', score: 50, stars: {}, unlocked: 100, currentLevel: 2, settings: {} },
    save() { saves++; },
    addScore(n) { this.data.score = Math.max(0, this.data.score + n); this.save(); },
    recordLevel(id, stars) { this.data.stars[id] = stars; this.save(); },
    doneCount() { return Object.keys(this.data.stars).length; }
  },
  levels: {
    total: 100,
    list: Array.from({ length: 100 }, () => ({ kind: 'hundred' })),
    build(id) {
      return { id, name: 'test', goal: 'test', kind: 'chart', size: 10,
        blanks: [31, 39], answers: { 31: 31, 39: 39 }, values: {}, clues: {},
        candidates: [31, 39, 1, 2, 3, 4, 5, 6, 7, 8] };
    },
    candidates() { return [31, 39, 1, 2, 3, 4, 5, 6, 7, 8]; }
  },
  board: {
    render(level) { blanks = level.blanks.slice(); cells.clear(); this.target = null; this.origin = null; },
    setTarget(n) { this.target = n; }, setOrigin(n) { this.origin = n; },
    markCorrect(n, animal) { this.marked = { n, animal }; },
    moveMaze(from, to) { this.move = [from, to]; }, showAnimal() {},
    moveRacePiece(actor, next, duration, callback) {
      assert.equal(pendingRaceMove, null, 'race animations must never overlap');
      const move = { actor, next, duration, callback, from: HB.game.state.race.positions[actor],
        positions: { ...HB.game.state.race.positions }, cancelled: false, completed: false };
      raceMoves.push(move);
      pendingRaceMove = move;
      return () => {
        raceMoveCancellations++;
        move.cancelled = true;
        if (pendingRaceMove === move) pendingRaceMove = null;
      };
    },
    label: n => n === -1 ? '雷' : String(n), hueOf: () => 32,
    el(n) { if (!cells.has(n)) { const el = new Element(); el.dataset.n = n; cells.set(n, el); } return cells.get(n); },
    fill(n) { blanks = blanks.filter(v => v !== n); }, isBlank: n => blanks.includes(n)
  },
  audio: { play() {} },
  license: { canPlay: () => true, isFree: id => id <= 20 },
  ui: { hideOverlay() { overlay = null; }, renderLevels() {}, renderMode() {}, bubble() {},
    countUp() {}, say() {}, renderScore() {}, renderAccount() {}, showOverlay(opt) { overlay = opt; } },
  fx: { flyTo(opt) { flight = opt.onDone; return () => {}; }, land() {}, floatText() {}, shakeWrong() {} }
};
const context = vm.createContext({
  HB, window: { HB },
  document: {
    getElementById: get, createElement: tagName => new Element(tagName),
    querySelector(selector) { const n = Number(selector.match(/data-n="(-?\d+)"/)[1]); return get('trayGrid').children.find(t => Number(t.dataset.n) === n); },
    querySelectorAll() { return get('trayGrid').children; }
  },
  setInterval() { return ++timerId; }, clearInterval() {},
  setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/game.js'), 'utf8'), context);
HB.game.init();
const click = n => get('trayGrid').children.find(t => Number(t.dataset.n) === n).click();
const select = n => get('grid').listeners.click({ target: HB.board.el(n) });
const finish = () => { const f = flight; flight = null; f(); };
const completeTimers = () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(f => f()); };
const snapshot = () => JSON.stringify(HB.store.data);

HB.game.start(2, 'normal');
const initialTray = get('trayGrid').children.slice();
click(39);
assert.equal(HB.game.state.filledCount, 0, 'another blank answer must be wrong for selected31');
assert.equal(HB.store.data.score, 47);
assert.deepEqual(get('trayGrid').children, initialTray, 'wrong answer must not replace tiles');
select(39);
assert.equal(HB.game.state.target, 39);
click(39);
select(31);
assert.equal(HB.game.state.target, 39, 'target locked during flight');
finish();
assert.equal(HB.game.state.filled[39], 1);
assert.equal(HB.game.state.target, 31);
assert.equal(get('trayGrid').children.length, 10);
assert.ok(get('trayGrid').children.every(t => !initialTray.includes(t)), 'correct landing must refresh all tiles');
click(31); finish();
assert.equal(get('trayGrid').children.length, 10, 'last answer also refreshes ten tiles');
completeTimers();
assert.equal(overlay.practice, false);
assert.equal(HB.store.data.stars[2], 2);

for (const mode of ['free', 'random']) {
  const before = snapshot(), beforeSaves = saves;
  HB.game.start(99, mode);
  click(1);
  get('hintBtn').click();
  click(31); finish();
  click(39); finish();
  completeTimers();
  assert.equal(overlay.practice, true);
  assert.equal(overlay.gained, 0);
  assert.equal(snapshot(), before, mode + ' must not change ANY profile field');
  assert.equal(saves, beforeSaves, mode + ' must not write profile');
  overlay.onReplay();
  assert.equal(HB.game.state.mode, mode);
}
HB.game.setMode('normal');
assert.equal(HB.game.state.level.id, HB.store.data.currentLevel);

HB.game.start(2, 'normal');
click(31);
const stale = flight, beforeStale = snapshot();
HB.game.start(88, 'free');
stale();
assert.equal(snapshot(), beforeStale, 'stale landing must not score');
assert.equal(HB.game.state.filledCount, 0);

HB.game.start(2, 'free');
click(31); finish(); click(39); finish();
HB.game.start(4, 'free');
completeTimers();
assert.equal(overlay, null, 'stale completion must not open overlay');

HB.store.data.unlocked = 3;
HB.game.start(100, 'normal');
assert.equal(HB.game.state.level.id, 3, 'normal mode enforces lock');
HB.game.start(100, 'free');
assert.equal(HB.game.state.level.id, 100);
for (let i = 0; i < 120; i++) {
  const old = HB.game.state.level.id;
  HB.game.randomLevel();
  assert.ok(HB.game.state.level.id >= 1 && HB.game.state.level.id <= 100);
  assert.notEqual(HB.game.state.level.id, old);
  assert.equal(HB.game.state.mode, 'random');
}
console.log('Game checks passed: selected-cell correctness, 10-tile refresh, normal scoring, free/random isolation, cancellation and level locks.');

vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8'), context);
assert.equal(HB.levels.total, 220);
assert.equal(HB.levels.list.length, 220);
assert.equal(HB.levels.progressVersion, 4);
HB.store.data.unlocked = 220;
for (const id of [41, 44, 51, 54, 81, 95, 61, 70, 71, 80, 136, 145, 156, 165]) {
  for (const mode of ['free', 'random']) {
    const before = snapshot(), writes = saves;
    HB.game.start(id, mode);
    const state = HB.game.state;
    assert.equal(state.level.interaction, 'select');
    assert.equal(get('trayGrid').hidden, true);
    assert.equal(get('activityPanel').hidden, false);
    assert.equal(get('trayGrid').children.length, 0);
    assert.equal(HB.board.target, null, 'selection must not highlight the answer');
    assert.equal(HB.board.origin, state.level.tasks[0].start);
    const initialTarget = state.target;
    const prompt = get('targetPrompt').textContent;
    select(initialTarget === 1 ? 2 : 1);
    assert.equal(state.mistakes, 1);
    assert.equal(state.filledCount, 0);
    assert.equal(state.target, initialTarget);
    assert.equal(get('targetPrompt').textContent, prompt);
    get('hintBtn').click();
    assert.equal(HB.board.el(initialTarget).classList.contains('hint'), true);
    for (const item of state.level.tasks) {
      assert.equal(state.target, item.cell);
      select(item.cell);
      assert.equal(HB.board.marked.n, item.cell);
      assert.equal(HB.board.marked.animal, item.animal);
      assert.equal(HB.board.target, null);
    }
    assert.equal(state.done, true);
    assert.equal(state.filledCount, state.level.tasks.length);
    completeTimers();
    assert.equal(overlay.practice, true);
    assert.equal(overlay.gained, 0);
    assert.equal(overlay.last, false, 'Schulte is no longer the final chapter');
    assert.equal(get('nextBtn').hidden, false);
    if (state.level.kind === 'schulte') {
      assert.equal(typeof overlay.elapsed, 'number');
      assert.equal(get('playClock').hidden, false);
    }
    assert.equal(snapshot(), before);
    assert.equal(saves, writes);
  }
}

let equalProducts = 0;
for (let id = 196; id <= 200; id++) {
  for (const mode of ['free', 'random']) {
    const before = snapshot(), writes = saves;
    HB.game.start(id, mode);
    const state = HB.game.state, level = state.level;
    assert.equal(get('trayGrid').hidden, true);
    assert.equal(HB.board.target, null);
    const initialTarget = state.target;
    const wrong = level.activeCells.find(n => level.values[n] !== level.values[initialTarget]);
    const prompt = get('targetPrompt').textContent;
    select(wrong);
    assert.equal(state.mistakes, 1);
    assert.equal(state.filledCount, 0);
    assert.equal(get('targetPrompt').textContent, prompt);
    const empty = HB.board.el(2);
    empty.classList.add('table-void');
    select(2);
    assert.equal(state.mistakes, 1, 'upper triangle must be inert');
    get('hintBtn').click();
    assert.equal(HB.board.el(initialTarget).classList.contains('hint'), true);
    for (const item of level.tasks) {
      const alternative = level.activeCells.find(n => n !== item.cell && level.values[n] === level.values[item.cell]);
      if (alternative) equalProducts++;
      const chosen = alternative || item.cell;
      select(chosen);
      assert.equal(HB.board.marked.n, chosen);
      assert.equal(HB.board.target, null, 'no answer location leakage');
    }
    assert.equal(state.done, true);
    completeTimers();
    assert.equal(overlay.last, false);
    assert.equal(snapshot(), before);
    assert.equal(saves, writes);
  }
}
assert.ok(equalProducts > 0, 'same product at a different cell must be accepted');

for (const id of [...Array.from({ length: 10 }, (_, i) => 166 + i), ...Array.from({ length: 15 }, (_, i) => 201 + i)]) {
  for (const mode of ['free', 'random']) {
    const before = snapshot(), writes = saves;
    HB.game.start(id, mode);
    const state = HB.game.state, level = state.level;
    const multiplication = level.kind === 'multiplication';
    assert.equal(get('trayGrid').hidden, false);
    assert.equal(get('trayGrid').children.length, 10);
    assert.equal(state.target, (level.fillOrder || level.blanks)[0]);
    if (multiplication) assert.equal(level.blanks.length, 45);
    const oldTray = get('trayGrid').children.slice();
    oldTray.find(t => Number(t.dataset.n) !== level.answers[state.target]).click();
    assert.equal(state.mistakes, 1);
    assert.equal(state.filledCount, 0);
    assert.deepEqual(get('trayGrid').children, oldTray);
    const last = level.blanks.at(-1);
    select(last);
    assert.equal(state.target, last);
    assert.ok(get('trayGrid').children.some(t => Number(t.dataset.n) === level.answers[last]));
    let previousTray;
    while (!state.done) {
      const target = state.target, value = level.answers[target];
      previousTray = get('trayGrid').children.slice();
      click(value);
      assert.equal(state.filled[target], undefined, 'fill must wait for animation');
      select(level.blanks[0]);
      assert.equal(state.target, target);
      finish();
      assert.equal(state.filled[target], 1);
      assert.equal(get('trayGrid').children.length, 10);
      assert.ok(get('trayGrid').children.every(t => !previousTray.includes(t)));
    }
    assert.equal(state.filledCount, level.blanks.length);
    completeTimers();
    assert.equal(overlay.last, false, 'all 15 multiplication tables, including 215, precede the race chapter');
    assert.equal(get('nextBtn').hidden, false);
    assert.equal(snapshot(), before);
    assert.equal(saves, writes);
  }
}
HB.game.start(201, 'free');
click(HB.game.state.level.answers[HB.game.state.target]);
const staleProduct = flight;
HB.game.start(196, 'free');
staleProduct();
assert.equal(HB.game.state.filledCount, 0);
assert.equal(HB.game.state.level.id, 196);
console.log('PASS multiplication: equal products, inert upper triangle, fill values versus cell IDs, all 15 tables, ten refreshed candidates, final level and practice isolation; 10 new mines.');

HB.game.start(41, 'normal');
const beforeScore = HB.store.data.score;
const count = HB.game.state.level.tasks.length;
for (const item of HB.game.state.level.tasks) select(item.cell);
completeTimers();
assert.equal(HB.store.data.score, beforeScore + count * 10 + Math.floor(count / 3) * 5 + 35);
assert.equal(HB.store.data.stars[41], 3);
assert.equal(overlay.practice, false);

for (const id of [196, 215]) {
  HB.game.start(id, 'normal');
  const initialScore = HB.store.data.score;
  const state = HB.game.state;
  const count = state.level.interaction === 'select' ? state.level.tasks.length : state.level.blanks.length;
  while (!state.done) {
    if (state.level.interaction === 'select') select(state.target);
    else { click(state.level.answers[state.target]); finish(); }
  }
  completeTimers();
  assert.equal(HB.store.data.score, initialScore + count * 10 + Math.floor(count / 3) * 5 + 35);
  assert.equal(HB.store.data.stars[id], 3);
  assert.equal(overlay.practice, false);
  assert.equal(overlay.last, false, '215 remains a scored multiplication level, but is no longer last');
}

let alternateBranches = 0, givenSteps = 0;
const mazeIds = HB.levels.list.flatMap((level, i) => level.kind === 'maze' ? [i + 1] : []);
assert.equal(mazeIds.length, 30);
for (const id of mazeIds) {
  for (const mode of ['free', 'random']) {
    const before = snapshot(), writes = saves;
    HB.game.start(id, mode);
    const state = HB.game.state;
    assert.equal(get('trayGrid').hidden, false);
    assert.equal(get('activityPanel').hidden, true);
    assert.equal(state.head, 1);
    assert.equal(state.target, null);
    const bad = get('trayGrid').children.find(t => !HB.levels.mazeMoves(state.level, 1, 0).includes(Number(t.dataset.n)));
    const oldTray = get('trayGrid').children.slice();
    bad.click();
    assert.equal(state.head, 1);
    assert.equal(state.filledCount, 0);
    assert.equal(state.mistakes, 1);
    assert.deepEqual(get('trayGrid').children, oldTray);
    select(100);
    assert.equal(state.head, 1, 'cannot jump to exit');
    assert.equal(state.mistakes, 2);
    get('hintBtn').click();
    const firstMove = HB.levels.mazeMoves(state.level, 1, 0)[0];
    assert.equal(HB.board.el(firstMove).classList.contains('hint'), true);
    let steps = 0;
    while (!state.done) {
      const moves = HB.levels.mazeMoves(state.level, state.head, state.checkpointIndex);
      assert.ok(moves.length > 0);
      if (moves.length > 1) alternateBranches++;
      const move = mode === 'free' ? moves[0] : moves.at(-1);
      const oldHead = state.head;
      const oldFills = state.filledCount;
      if (HB.board.isBlank(move)) {
        assert.ok(get('trayGrid').children.some(t => Number(t.dataset.n) === move));
        if (steps % 2 === 0) select(move);
        click(move);
        assert.equal(state.head, oldHead, 'move commits only after landing');
        select(100);
        assert.equal(state.head, oldHead, 'board locked during flight');
        finish();
        assert.equal(state.filledCount, oldFills + 1);
      } else {
        select(move);
        assert.equal(state.filledCount, oldFills, 'existing numbers cost no fill');
        givenSteps++;
      }
      assert.equal(state.head, move);
      assert.deepEqual(HB.board.move, [oldHead, move]);
      assert.equal(get('trayGrid').children.length, 10);
      if (++steps > 18) throw new Error('maze did not terminate');
    }
    assert.equal(steps, 18);
    assert.equal(state.head, 100);
    assert.equal(state.checkpointIndex, state.level.checkpoints.length);
    assert.equal(state.filledCount, state.level.minimumFills);
    completeTimers();
    assert.equal(overlay.practice, true);
    assert.equal(snapshot(), before);
    assert.equal(saves, writes);
  }
}
assert.ok(alternateBranches > 0, 'exercise equal-cost alternative routes');
assert.ok(givenSteps > 0);

HB.game.start(146, 'free');
while (!HB.game.state.done) {
  const state = HB.game.state;
  const move = HB.levels.mazeMoves(state.level, state.head, state.checkpointIndex)[0];
  if (HB.board.isBlank(move)) {
    click(move);
    const pending = flight, before = snapshot();
    HB.game.start(156, 'free');
    pending();
    assert.equal(HB.game.state.filledCount, 0);
    assert.equal(HB.game.state.level.kind, 'schulte');
    assert.equal(snapshot(), before);
    break;
  }
  select(move);
}
const schulteValues = JSON.stringify(HB.game.state.level.values);
get('replayBtn').click();
assert.notEqual(JSON.stringify(HB.game.state.level.values), schulteValues, 'Schulte replay reshuffles');
HB.game.start(146, 'free');
const mazeLayout = JSON.stringify([HB.game.state.level.givens, HB.game.state.level.checkpoints]);
get('replayBtn').click();
assert.notEqual(JSON.stringify([HB.game.state.level.givens, HB.game.state.level.checkpoints]), mazeLayout, 'maze replay regenerates');
HB.game.start(1, 'free');
assert.equal(get('playClock').hidden, true);
assert.equal(get('trayGrid').hidden, false);
assert.equal(get('activityPanel').hidden, true);
HB.game.suspend();
console.log('New game checks passed: select tasks, no answer highlight, hints, Schulte timing, all maze levels and alternative branches, replay, mode isolation, stale flight cancellation.');

// Observe the real worksheet controller without changing the original mock-level tests.
function observeCalls(object, name) {
  const original = object[name], calls = [];
  object[name] = function (...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  return calls;
}
const boardRenders = observeCalls(HB.board, 'render');
const boardFills = observeCalls(HB.board, 'fill');
const scoreCalls = observeCalls(HB.store, 'addScore');
const recordCalls = observeCalls(HB.store, 'recordLevel');
const overlayCalls = observeCalls(HB.ui, 'showOverlay');
const scheduledTimeouts = [], scheduleTimeout = context.setTimeout;
context.setTimeout = (fn, delay) => {
  const id = scheduleTimeout(fn);
  scheduledTimeouts.push({ id, fn, delay });
  return id;
};
let flightCancellations = 0;
const originalFlyTo = HB.fx.flyTo;
HB.fx.flyTo = function (options) {
  const cancel = originalFlyTo.call(this, options);
  return () => { flightCancellations++; cancel(); };
};

function worksheetProgress() {
  const state = HB.game.state, level = state.level;
  assert.equal(get('progressText').textContent,
    `第 ${level.questionIndex + 1} / ${level.questionCount} 题 · 已填 ${state.filledCount} / ${level.blanks.length}`);
  const fraction = (level.questionIndex + state.filledCount / level.blanks.length) / level.questionCount;
  assert.equal(get('progressBar').style.width, Math.round(fraction * 100) + '%');
}

function freshWorksheet(id, mode) {
  const state = HB.game.state;
  assert.equal(state.level.id, id);
  assert.equal(state.mode, mode);
  assert.equal(state.level.kind, 'pattern');
  assert.equal(state.level.interaction, 'fill');
  assert.equal(state.level.questionIndex, 0);
  assert.equal(state.level.questionCount, id <= 25 ? 3 : 4);
  assert.equal(state.level.sourceQuestion, id <= 25 ? (id - 21) * 3 + 1 : (id - 26) * 4 + 16);
  assert.equal(state.filledCount, 0);
  assert.equal(Object.keys(state.filled).length, 0);
  assert.equal(state.mistakes, 0);
  assert.equal(state.streak, 0);
  assert.equal(state.hintUsed, false);
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.equal(state.target, state.level.fillOrder[0]);
  assert.equal(get('lvGoal').textContent, state.level.goal);
  assert.equal(get('trayGrid').hidden, false);
  assert.equal(get('activityPanel').hidden, true);
  assert.equal(get('trayGrid').children.length, 10);
  assert.equal(overlay, null);
  worksheetProgress();
}

function worksheetView() {
  return {
    state: JSON.stringify(HB.game.state), profile: snapshot(), saves,
    renders: boardRenders.length, fills: boardFills.length,
    scores: scoreCalls.length, records: recordCalls.length, overlays: overlayCalls.length,
    timeouts: scheduledTimeouts.length, cancellations: flightCancellations,
    blanks: Array.from(blanks), target: HB.board.target,
    tray: get('trayGrid').children.slice(),
    goal: get('lvGoal').textContent, prompt: get('targetPrompt').textContent,
    progress: get('progressText').textContent, width: get('progressBar').style.width,
    nextHidden: get('nextBtn').hidden, overlay
  };
}
function noLateWorksheetWork(callback, message) {
  const before = worksheetView();
  callback();
  assert.deepEqual(worksheetView(), before, message);
}

function wrongWorksheetAnswer() {
  const state = HB.game.state, oldTray = get('trayGrid').children.slice();
  const mistakes = state.mistakes, count = state.filledCount, target = state.target;
  oldTray.find(tile => Number(tile.dataset.n) !== state.level.answers[target]).click();
  assert.equal(state.mistakes, mistakes + 1);
  assert.equal(state.streak, 0);
  assert.equal(state.filledCount, count);
  assert.equal(state.target, target);
  assert.deepEqual(get('trayGrid').children, oldTray, 'wrong worksheet answers must not refresh candidates');
  worksheetProgress();
}

function fillWorksheetBlank() {
  const state = HB.game.state, level = state.level, target = state.target;
  const value = level.answers[target], count = state.filledCount;
  const tray = get('trayGrid').children.slice(), writes = saves;
  const profile = snapshot(), fills = boardFills.length, renders = boardRenders.length;
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.ok(level.blanks.includes(target));
  assert.ok(tray.some(tile => Number(tile.dataset.n) === value));
  click(value);
  assert.equal(state.busy, true);
  assert.equal(state.filledCount, count, 'worksheet answers commit only on landing');
  assert.equal(state.filled[target], undefined);
  assert.equal(boardFills.length, fills);
  assert.equal(snapshot(), profile, 'no scoring before landing');
  assert.equal(saves, writes);
  select(level.blanks.find(cell => cell !== target) || target);
  assert.equal(state.target, target, 'worksheet target is locked in flight');
  worksheetProgress();
  finish();
  assert.equal(state.level, level, 'next worksheet must wait for its timer');
  assert.equal(state.filledCount, count + 1);
  assert.equal(state.filled[target], 1);
  assert.equal(boardFills.length, fills + 1);
  assert.deepEqual(boardFills.at(-1), [target, value], 'fill receives cell ID and answer value separately');
  assert.equal(boardRenders.length, renders);
  assert.equal(get('trayGrid').children.length, 10);
  assert.equal(new Set(get('trayGrid').children.map(tile => Number(tile.dataset.n))).size, 10);
  assert.ok(get('trayGrid').children.every(tile => !tray.includes(tile)), 'every landing refreshes ten candidates');
  worksheetProgress();
}

function finishWorksheetQuestion() {
  const state = HB.game.state, remaining = state.level.blanks.length - state.filledCount;
  for (let i = 0; i < remaining; i++) fillWorksheetBlank();
  assert.equal(state.filledCount, state.level.blanks.length);
}

function pendingWorksheetTimer() {
  const job = scheduledTimeouts.at(-1);
  assert.equal(job.delay, 620, 'worksheet transition/completion delay');
  assert.equal(timers.get(job.id), job.fn);
  return job;
}

function advanceWorksheet() {
  const state = HB.game.state, level = state.level, filled = state.filled;
  assert.equal(state.filledCount, level.blanks.length);
  assert.equal(state.done, false, 'intermediate worksheets must not finish the level');
  assert.equal(state.busy, true);
  assert.equal(state.target, null);
  assert.equal(overlay, null);
  assert.equal(get('nextBtn').hidden, true);
  pendingWorksheetTimer();
  noLateWorksheetWork(() => {
    get('trayGrid').children[0].click();
    select(level.blanks[0]);
    get('hintBtn').click();
  }, 'input and hints must be inert between worksheets');
  const preserved = [state.mistakes, state.streak, state.hintUsed, state.mode, state.startedAt];
  const before = worksheetView(), width = get('progressBar').style.width;
  completeTimers();
  assert.equal(state.level.id, level.id);
  assert.equal(state.level.questionIndex, level.questionIndex + 1);
  assert.equal(state.level.questionCount, level.questionCount);
  assert.equal(state.level.sourceQuestion, level.sourceQuestion + 1);
  assert.notEqual(state.filled, filled, 'each round gets a fresh filled map');
  assert.equal(Object.keys(state.filled).length, 0);
  assert.equal(state.filledCount, 0);
  assert.deepEqual([state.mistakes, state.streak, state.hintUsed, state.mode, state.startedAt], preserved);
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.equal(state.target, state.level.fillOrder[0]);
  assert.equal(boardRenders.length, before.renders + 1);
  assert.equal(boardRenders.at(-1)[0], state.level);
  assert.equal(boardFills.length, before.fills);
  assert.equal(scoreCalls.length, before.scores, 'no inter-round bonus');
  assert.equal(recordCalls.length, before.records, 'no inter-round stars');
  assert.equal(overlayCalls.length, before.overlays);
  assert.equal(snapshot(), before.profile);
  assert.equal(saves, before.saves);
  assert.equal(get('lvGoal').textContent, state.level.goal);
  assert.equal(get('progressBar').style.width, width, 'progress must not drop when the next round starts');
  worksheetProgress();
}

for (const mode of ['free', 'random']) {
  const before = snapshot(), writes = saves;
  const records = recordCalls.length, scores = scoreCalls.length, sources = [];
  for (let id = 21; id <= 30; id++) {
    HB.game.start(id, mode);
    freshWorksheet(id, mode);
    const state = HB.game.state, rounds = id <= 25 ? 3 : 4;
    const overlays = overlayCalls.length;
    for (let question = 0; question < rounds; question++) {
      const expected = HB.levels.build(id, undefined, question);
      assert.equal(state.level.questionIndex, question);
      assert.equal(state.level.questionCount, rounds);
      assert.equal(state.level.sourceQuestion, sources.length + 1);
      assert.deepEqual(state.level.answers, expected.answers);
      assert.deepEqual(state.level.blanks, expected.blanks);
      sources.push(state.level.sourceQuestion);
      worksheetProgress();
      wrongWorksheetAnswer();
      if (question === 0) get('hintBtn').click();
      assert.equal(state.hintUsed, true, 'hint use persists across practice rounds');
      finishWorksheetQuestion();
      assert.equal(state.mistakes, question + 1, 'practice errors are cumulative');
      assert.equal(recordCalls.length, records);
      assert.equal(scoreCalls.length, scores);
      assert.equal(overlayCalls.length, overlays, 'no overlay before the final completion timer');
      assert.equal(snapshot(), before, mode + ' worksheets must not mutate any profile field');
      assert.equal(saves, writes, mode + ' worksheets must not save');
      if (question + 1 < rounds) advanceWorksheet();
    }
    assert.equal(state.done, true);
    assert.equal(state.busy, true);
    pendingWorksheetTimer();
    assert.equal(get('progressBar').style.width, '100%');
    completeTimers();
    assert.equal(overlayCalls.length, overlays + 1);
    assert.equal(overlay.levelId, id);
    assert.equal(overlay.practice, true);
    assert.equal(overlay.gained, 0);
    assert.equal(overlay.mistakes, rounds);
    assert.equal(overlay.stars, 1);
    assert.equal(overlay.last, false);
    assert.equal(get('nextBtn').hidden, false);
    overlay.onReplay();
    freshWorksheet(id, mode);
    assert.equal(snapshot(), before);
    assert.equal(saves, writes);
  }
  assert.deepEqual(sources, Array.from({ length: 35 }, (_, i) => i + 1), mode + ' completes all 35 source puzzles');
  assert.equal(recordCalls.length, records);
  assert.equal(scoreCalls.length, scores);
}
console.log('PASS worksheets: all 35 puzzles in free and random modes, 3/4 rounds, per-cell and cross-round progress, input locks, replay and zero profile writes.');

// Cover every star tier, with/without hints, and clean final rounds after earlier errors.
for (const scenario of [
  { id: 21, errors: [0, 0, 0], hint: false, stars: 3, bonus: 35 },
  { id: 26, errors: [0, 0, 0, 0], hint: true, stars: 3, bonus: 30 },
  { id: 22, errors: [1, 1, 0], hint: false, stars: 2, bonus: 25 },
  { id: 30, errors: [1, 1, 1, 0], hint: true, stars: 1, bonus: 20 }
]) {
  const initialScore = HB.store.data.score, writes = saves;
  const scores = scoreCalls.length, records = recordCalls.length, overlays = overlayCalls.length;
  const initialStars = JSON.stringify(HB.store.data.stars), expectedDeltas = [];
  let mistakes = 0, streak = 0;
  HB.game.start(scenario.id, 'normal');
  freshWorksheet(scenario.id, 'normal');
  const state = HB.game.state;
  const checkLedger = () => {
    assert.deepEqual(scoreCalls.slice(scores).map(args => args[0]), expectedDeltas);
    assert.equal(HB.store.data.score, initialScore + expectedDeltas.reduce((sum, delta) => sum + delta, 0));
  };
  for (let question = 0; question < scenario.errors.length; question++) {
    assert.equal(state.level.questionIndex, question);
    for (let i = 0; i < scenario.errors[question]; i++) {
      wrongWorksheetAnswer();
      mistakes++;
      streak = 0;
      expectedDeltas.push(-3);
      checkLedger();
    }
    if (question === 0 && scenario.hint) {
      get('hintBtn').click();
      expectedDeltas.push(-5);
      const answerTile = get('trayGrid').children.find(tile => Number(tile.dataset.n) === state.level.answers[state.target]);
      assert.equal(answerTile.classList.contains('hint'), true);
      checkLedger();
    }
    const finalRound = question + 1 === scenario.errors.length;
    for (let i = 0; i < state.level.blanks.length; i++) {
      streak++;
      expectedDeltas.push(10 + (streak % 3 === 0 ? 5 : 0));
      const finalAnswer = finalRound && i + 1 === state.level.blanks.length;
      if (finalAnswer) expectedDeltas.push(scenario.bonus);
      fillWorksheetBlank();
      assert.equal(state.streak, streak, 'streak rewards span worksheet boundaries');
      assert.equal(state.mistakes, mistakes);
      assert.equal(state.hintUsed, scenario.hint);
      assert.equal(recordCalls.length, records + (finalAnswer ? 1 : 0));
      checkLedger();
    }
    assert.equal(overlay, null);
    assert.equal(overlayCalls.length, overlays);
    if (!finalRound) {
      assert.equal(JSON.stringify(HB.store.data.stars), initialStars);
      advanceWorksheet();
      checkLedger();
    }
  }
  assert.equal(state.done, true);
  assert.equal(state.busy, true);
  assert.deepEqual(recordCalls.slice(records), [[scenario.id, scenario.stars]]);
  assert.equal(HB.store.data.stars[scenario.id], scenario.stars);
  assert.equal(expectedDeltas.filter(delta => delta >= 20).length, 1, 'exactly one completion bonus per level');
  assert.equal(saves, writes + 1 + expectedDeltas.length + 1, 'only start, score deltas and one level record save');
  pendingWorksheetTimer();
  completeTimers();
  assert.equal(overlayCalls.length, overlays + 1);
  assert.equal(overlay.practice, false);
  assert.equal(overlay.levelId, scenario.id);
  assert.equal(overlay.stars, scenario.stars);
  assert.equal(overlay.mistakes, mistakes);
  assert.equal(overlay.gained, scenario.bonus);
  assert.equal(get('progressBar').style.width, '100%');
  noLateWorksheetWork(() => {
    get('trayGrid').children[0].click();
    select(state.level.blanks[0]);
    get('hintBtn').click();
    completeTimers();
  }, 'completed worksheets cannot score, award stars or show completion twice');
  checkLedger();
}
console.log('PASS worksheet scoring: complete multi-round levels, all star tiers, one completion bonus, cumulative mistakes/hints and uninterrupted streak rewards.');

// Source 17 is questionIndex 1 of level 26: displayed values intentionally differ from cell IDs.
{
  const before = snapshot(), writes = saves;
  HB.game.start(26, 'free');
  finishWorksheetQuestion();
  advanceWorksheet();
  const state = HB.game.state, level = state.level;
  assert.equal(level.questionIndex, 1);
  assert.equal(level.sourceQuestion, 17);
  assert.ok(level.blanks.every(cell => level.answers[cell] !== cell));
  const first = state.target, last = level.blanks.at(-1);
  select(last);
  assert.equal(state.target, last);
  assert.equal(HB.board.target, last);
  assert.ok(get('trayGrid').children.some(tile => Number(tile.dataset.n) === level.answers[last]));
  assert.equal(get('targetPrompt').textContent,
    `第 ${Math.floor((last - 1) / level.size) + 1} 行，第 ${(last - 1) % level.size + 1} 列 · ${level.clues[last]}`);
  click(level.answers[first]);
  assert.equal(state.mistakes, 1, 'another blank value is wrong for the selected cell');
  assert.equal(state.filledCount, 0);
  assert.equal(state.target, last);
  get('hintBtn').click();
  assert.equal(get('trayGrid').children.find(tile => Number(tile.dataset.n) === level.answers[last]).classList.contains('hint'), true);
  fillWorksheetBlank();
  assert.deepEqual(boardFills.at(-1), [last, level.answers[last]]);
  assert.equal(HB.board.isBlank(last), false);
  assert.equal(HB.board.isBlank(first), true);
  assert.equal(state.target, first);
  select(last);
  select(level.givens[0]);
  assert.equal(state.target, first, 'filled and given worksheet cells cannot become targets');
  fillWorksheetBlank();
  assert.deepEqual(boardFills.at(-1), [first, level.answers[first]]);
  assert.equal(snapshot(), before);
  assert.equal(saves, writes);
  HB.game.suspend();
}

// Force cancelled callbacks to run: clearing timers/cancelling animation alone cannot pass these checks.
for (const phase of ['flight', 'between']) {
  for (const action of ['replay', 'level-change', 'suspend']) {
    HB.game.start(26, 'normal');
    wrongWorksheetAnswer();
    get('hintBtn').click();
    finishWorksheetQuestion();
    advanceWorksheet();
    wrongWorksheetAnswer();
    const state = HB.game.state;
    fillWorksheetBlank();
    assert.equal(state.level.questionIndex, 1);
    assert.equal(state.mistakes, 2);
    assert.equal(state.hintUsed, true);
    let staleCallback, pending;
    if (phase === 'flight') {
      click(state.level.answers[state.target]);
      staleCallback = flight;
    } else {
      finishWorksheetQuestion();
      pending = pendingWorksheetTimer();
      staleCallback = pending.fn;
    }
    assert.equal(state.busy, true);
    assert.equal(state.done, false);
    assert.equal(typeof staleCallback, 'function');
    const cancellations = flightCancellations;
    const destination = action === 'level-change' ? 27 : 26;
    if (action === 'replay') get('replayBtn').click();
    else if (action === 'level-change') HB.game.start(destination, 'normal');
    else {
      HB.game.suspend();
      assert.equal(state.busy, true);
      noLateWorksheetWork(staleCallback, phase + ' callback must be invalidated on suspend');
      HB.game.start(destination, 'normal');
    }
    freshWorksheet(destination, 'normal');
    assert.equal(flightCancellations, cancellations + (phase === 'flight' ? 1 : 0));
    if (pending) assert.equal(timers.has(pending.id), false, action + ' clears the inter-round timer');
    noLateWorksheetWork(staleCallback, `${phase}/${action}: runId must reject stale work even after start unlocks input`);
    noLateWorksheetWork(completeTimers, `${phase}/${action}: no late rendering, scoring, stars or overlay`);
    fillWorksheetBlank();
    assert.equal(state.level.questionIndex, 0);
    assert.equal(state.filledCount, 1, 'new run remains playable after forced stale callbacks');
    assert.equal(state.mistakes, 0);
    assert.equal(state.streak, 1);
    assert.equal(state.hintUsed, false);
  }
}
HB.game.suspend();
completeTimers();
console.log('PASS worksheet targeting and cancellation: source-17 values versus cell IDs; forced stale flight/inter-round callbacks after replay, level change and suspend/restart.');

// New chapters use the real level builder; the original 100-level harness above stays unchanged.
const boardMarks = observeCalls(HB.board, 'markCorrect');
const wrongCalls = observeCalls(HB.fx, 'shakeWrong');
const flightCalls = observeCalls(HB.fx, 'flyTo');
const numbers = Array.from({ length: 100 }, (_, i) => i + 1);
const sorted = values => Array.from(values).sort((a, b) => a - b);
const PRIME_INTERVALS = [
  { min: 1, max: 10, primes: [2, 3, 5, 7] },
  { min: 11, max: 20, primes: [11, 13, 17, 19] },
  { min: 21, max: 40, primes: [23, 29, 31, 37] },
  { min: 41, max: 60, primes: [41, 43, 47, 53, 59] },
  { min: 61, max: 100, primes: [61, 67, 71, 73, 79, 83, 89, 97] }
];
const allPrimes = PRIME_INTERVALS.flatMap(interval => interval.primes);

function unchangedGameInput(callback, message) {
  const before = worksheetView();
  const effects = [boardMarks.length, wrongCalls.length, flightCalls.length];
  callback();
  assert.deepEqual(worksheetView(), before, message);
  assert.deepEqual([boardMarks.length, wrongCalls.length, flightCalls.length], effects, message);
}

function trackedStart(id, mode) {
  const run = { id, mode, profile: snapshot(), writes: saves, score: HB.store.data.score,
    scores: scoreCalls.length, records: recordCalls.length, overlays: overlayCalls.length };
  HB.game.start(id, mode);
  return run;
}

function checkRunLedger(run, deltas) {
  const state = HB.game.state, normal = run.mode === 'normal';
  const expected = normal ? deltas : [];
  assert.deepEqual(scoreCalls.slice(run.scores).map(args => args[0]), expected);
  assert.equal(HB.store.data.score, run.score + expected.reduce((sum, delta) => sum + delta, 0));
  const stars = state.mistakes === 0 ? 3 : state.mistakes <= 2 ? 2 : 1;
  assert.deepEqual(recordCalls.slice(run.records), normal && state.done ? [[run.id, stars]] : []);
  assert.equal(saves, run.writes + (normal ? 1 + expected.length + Number(state.done) : 0),
    'only normal start, answer/error/hint deltas and one completion record may save');
  if (!normal) assert.equal(snapshot(), run.profile, run.mode + ' must preserve every profile field');
}

function chapterProgress(interaction, count, total) {
  assert.equal(get('progressText').textContent, `${interaction === 'select' ? '已答' : '已填'} ${count} / ${total}`);
  assert.equal(get('progressBar').style.width, Math.round(count / total * 100) + '%');
}

function landedAnswer() {
  const state = HB.game.state, level = state.level, target = state.target;
  const value = level.answers[target], count = state.filledCount;
  const tray = get('trayGrid').children.slice(), fills = boardFills.length, flights = flightCalls.length;
  const profile = snapshot(), writes = saves, scores = scoreCalls.length;
  assert.ok(level.blanks.includes(target));
  assert.ok(tray.some(tile => Number(tile.dataset.n) === value), 'selected answer must be a real candidate');
  click(value);
  assert.equal(state.busy, true);
  assert.equal(flightCalls.length, flights + 1);
  assert.equal(flightCalls.at(-1)[0].toEl, HB.board.el(target));
  assert.equal(flightCalls.at(-1)[0].num, String(value));
  assert.equal(state.filledCount, count);
  assert.equal(state.filled[target], undefined, 'do not mark a cell before its flight lands');
  assert.equal(boardFills.length, fills);
  assert.equal(snapshot(), profile);
  assert.equal(saves, writes);
  assert.equal(scoreCalls.length, scores);
  select(level.blanks.find(cell => cell !== target) || target);
  assert.equal(state.target, target, 'target cannot switch in flight');
  finish();
  assert.equal(state.filledCount, count + 1);
  assert.equal(state.filled[target], 1);
  assert.equal(boardFills.length, fills + 1);
  assert.deepEqual(boardFills.at(-1), [target, value]);
  assert.equal(HB.board.isBlank(target), false);
  assert.equal(get('trayGrid').children.length, 10);
  assert.equal(new Set(get('trayGrid').children.map(tile => Number(tile.dataset.n))).size, 10);
  assert.ok(get('trayGrid').children.every(tile => !tray.includes(tile)), 'landing refreshes all candidates');
  const firstUnfilled = (level.fillOrder || level.blanks).find(cell => !state.filled[cell]);
  assert.equal(state.target, firstUnfilled ?? null);
  chapterProgress('fill', count + 1, level.blanks.length);
}

function expectWrongInput(callback) {
  const state = HB.game.state, count = state.filledCount, target = state.target, mistakes = state.mistakes;
  const filled = JSON.stringify(state.filled), prompt = get('targetPrompt').textContent;
  const tray = get('trayGrid').children.slice(), effects = [boardFills.length, boardMarks.length, flightCalls.length];
  const wrong = wrongCalls.length;
  callback();
  assert.equal(state.mistakes, mistakes + 1);
  assert.equal(wrongCalls.length, wrong + 1);
  assert.equal(state.streak, 0);
  assert.equal(state.filledCount, count);
  assert.equal(state.target, target);
  assert.equal(JSON.stringify(state.filled), filled);
  assert.equal(state.done, false);
  assert.equal(state.busy, false);
  assert.equal(get('targetPrompt').textContent, prompt);
  assert.deepEqual(get('trayGrid').children, tray);
  assert.deepEqual([boardFills.length, boardMarks.length, flightCalls.length], effects);
  chapterProgress(state.level.interaction, count,
    state.level.interaction === 'select' ? state.level.tasks.length : state.level.blanks.length);
}

function settleChapter(run, deltas) {
  const state = HB.game.state;
  assert.equal(state.done, true);
  assert.equal(state.target, null);
  checkRunLedger(run, deltas);
  assert.equal(overlayCalls.length, run.overlays, 'completion overlay waits for the timer');
  completeTimers();
  assert.equal(overlayCalls.length, run.overlays + 1);
  assert.equal(overlay.levelId, run.id);
  assert.equal(overlay.practice, run.mode !== 'normal');
  assert.equal(overlay.stars, state.mistakes === 0 ? 3 : state.mistakes <= 2 ? 2 : 1);
  assert.equal(overlay.mistakes, state.mistakes);
  assert.equal(overlay.gained, run.mode === 'normal' ? deltas.at(-1) : 0);
  assert.equal(overlay.last, false);
  assert.equal(get('nextBtn').hidden, false);
  unchangedGameInput(() => {
    numbers.forEach(select);
    get('trayGrid').children.forEach(tile => tile.click());
    get('hintBtn').click();
    completeTimers();
  }, 'completed chapters must not change progress, score, stars or completion count');
  checkRunLedger(run, deltas);
}

const reverseDefinitions = [
  { id: 36, kind: 'hundred', gen: ['scatter', 3], count: 3 },
  { id: 37, kind: 'hundred', gen: ['fullRow'], count: 10 },
  { id: 38, kind: 'hundred', gen: ['mixJump'], count: 6 },
  { id: 39, kind: 'pattern', shape: 'plus', count: 4 },
  { id: 40, kind: 'pattern', shape: 'block', count: 8 }
];
for (const expected of reverseDefinitions) {
  for (const mode of ['free', 'random', 'normal']) {
    const run = trackedStart(expected.id, mode), deltas = [];
    const state = HB.game.state, level = state.level, def = HB.levels.list[expected.id - 1];
    assert.equal(level.id, expected.id);
    assert.equal(level.kind, expected.kind);
    assert.equal(level.interaction, 'fill');
    assert.equal(level.size, 10);
    assert.equal(level.reverse, true);
    assert.equal(def.reverse, true);
    assert.equal(level.blanks.length, expected.count);
    assert.equal(new Set(level.blanks).size, expected.count);
    if (expected.gen) assert.deepEqual(Array.from(def.gen), expected.gen);
    else {
      assert.equal(def.shape, expected.shape);
      assert.equal(level.givens.length, 1);
      const center = level.givens[0];
      const offsets = expected.shape === 'plus' ? [-10, -1, 0, 1, 10] : [-11, -10, -9, -1, 0, 1, 9, 10, 11];
      assert.deepEqual(sorted(level.activeCells), offsets.map(offset => center + offset));
      assert.deepEqual(sorted(level.blanks), offsets.filter(offset => offset !== 0).map(offset => center + offset));
    }
    if (expected.id === 37) {
      assert.equal(new Set(Array.from(level.blanks, cell => Math.floor((cell - 1) / 10))).size, 1);
      assert.deepEqual(sorted(Array.from(level.blanks, cell => (cell - 1) % 10)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
    if (expected.id === 38) {
      assert.ok(level.blanks.some(start => {
        const horizontal = [start, start + 2, start + 4];
        const vertical = sorted(level.blanks.filter(cell => !horizontal.includes(cell)));
        return horizontal.every(cell => level.blanks.includes(cell) && Math.floor((cell - 1) / 10) === Math.floor((start - 1) / 10)) &&
          vertical.length === 3 && vertical[1] === vertical[0] + 20 && vertical[2] === vertical[0] + 40;
      }), 'mixed reverse jumps contain disjoint horizontal -2 and vertical -20 triples');
    }
    for (const cell of numbers) {
      const active = expected.kind === 'hundred' || level.activeCells.includes(cell);
      assert.equal(level.values[cell], active ? 101 - cell : null, 'reverse values and off-pattern nulls');
      assert.equal(level.answers[cell], level.blanks.includes(cell) ? 101 - cell : undefined);
    }
    assert.deepEqual(sorted(Object.keys(level.answers).map(Number)), sorted(level.blanks));
    assert.equal(get('trayGrid').hidden, false);
    assert.equal(get('activityPanel').hidden, true);
    chapterProgress('fill', 0, expected.count);
    const first = state.target, last = level.blanks.at(-1);
    select(last);
    assert.notEqual(last, first);
    assert.equal(state.target, last);
    assert.equal(HB.board.target, last);
    assert.notEqual(level.answers[last], last, 'cell ID is not the displayed reverse answer');
    // Exercise the real tray handler even when its randomized decoys do not contain the cell ID.
    expectWrongInput(() => {
      const fakeDecoy = new Element();
      fakeDecoy.dataset.n = last;
      get('trayGrid').children[0].listeners.click({ currentTarget: fakeDecoy, target: fakeDecoy });
    });
    deltas.push(-3);
    expectWrongInput(() => click(level.answers[first]));
    deltas.push(-3);
    get('hintBtn').click();
    deltas.push(-5);
    assert.equal(get('trayGrid').children.find(tile => Number(tile.dataset.n) === level.answers[last]).classList.contains('hint'), true);
    checkRunLedger(run, deltas);
    while (!state.done) {
      const target = state.target;
      landedAnswer();
      deltas.push(10 + (state.streak % 3 === 0 ? 5 : 0));
      if (state.done) deltas.push(20);
      else unchangedGameInput(() => {
        select(target);
        if (level.givens) level.givens.forEach(select);
        if (level.activeCells) numbers.filter(cell => !level.activeCells.includes(cell)).forEach(select);
      }, 'filled, given and off-pattern cells cannot become reverse targets');
      checkRunLedger(run, deltas);
    }
    assert.deepEqual(sorted(Object.keys(state.filled).map(Number)), sorted(level.blanks));
    settleChapter(run, deltas);
  }
}
console.log('PASS reverse 36–40: exact generators, reverse values/masks, switched cell-ID rejection, flight-before-fill, all completions and mode ledgers.');

function freshPrime(id, mode, index, interaction) {
  const state = HB.game.state, level = state.level, expected = PRIME_INTERVALS[index];
  const known = allPrimes.filter(n => n < expected.min), def = HB.levels.list[id - 1];
  assert.equal(level.id, id);
  assert.equal(state.mode, mode);
  assert.equal(level.kind, 'prime');
  assert.equal(level.interaction, interaction);
  assert.equal(def.interaction, interaction);
  assert.equal(level.minNumber, expected.min);
  assert.equal(level.maxNumber, expected.max);
  assert.equal(def.minNumber, expected.min);
  assert.equal(def.maxNumber, expected.max);
  assert.deepEqual(Array.from(level.knownPrimes), known);
  assert.deepEqual(Array.from(level.primeCells), expected.primes);
  assert.equal(state.filledCount, 0);
  assert.equal(Object.keys(state.filled).length, 0, 'known primes are not answered tasks');
  assert.equal(state.mistakes, 0);
  assert.equal(state.streak, 0);
  assert.equal(state.hintUsed, false);
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.equal(overlay, null);
  assert.equal(state.target, expected.primes[0]);
  assert.equal(get('trayGrid').hidden, interaction === 'select');
  assert.equal(get('activityPanel').hidden, interaction !== 'select');
  for (const n of numbers) assert.equal(level.values[n], n);
  if (interaction === 'select') {
    assert.deepEqual(Array.from(level.tasks, item => item.cell), expected.primes, 'exactly one task per current prime');
    assert.equal(new Set(level.tasks.map(item => item.cell)).size, expected.primes.length);
    assert.equal(level.blanks.length, 0);
    assert.equal(Object.keys(level.answers).length, 0);
    assert.equal(get('trayGrid').children.length, 0);
    assert.equal(HB.board.target, null, 'do not reveal an answer before hinting');
    assert.equal(get('targetPrompt').textContent, level.tasks[0].prompt);
  } else {
    assert.deepEqual(Array.from(level.blanks), expected.primes);
    assert.deepEqual(Object.entries(level.answers).map(([cell, value]) => [Number(cell), value]), expected.primes.map(n => [n, n]));
    assert.equal(HB.board.target, expected.primes[0]);
    primeTray(expected);
  }
  chapterProgress(interaction, 0, expected.primes.length);
  unchangedGameInput(() => known.forEach(select), 'previously learned primes are inert, not targets or new progress');
}

function primeTray(expected) {
  const state = HB.game.state, candidates = get('trayGrid').children.map(tile => Number(tile.dataset.n));
  assert.equal(candidates.length, 10);
  assert.equal(new Set(candidates).size, 10);
  assert.ok(candidates.every(n => n >= expected.min && n <= expected.max), 'all candidates stay inside the current interval');
  if (state.target != null) {
    assert.ok(expected.primes.includes(state.target));
    assert.equal(state.filled[state.target], undefined);
    assert.ok(candidates.includes(state.level.answers[state.target]));
  }
}

for (const [index, expected] of PRIME_INTERVALS.entries()) {
  for (const mode of ['free', 'random', 'normal']) {
    const id = 96 + index, run = trackedStart(id, mode), deltas = [];
    freshPrime(id, mode, index, 'fill');
    const state = HB.game.state, level = state.level;
    unchangedGameInput(() => numbers.filter(n => !expected.primes.includes(n)).forEach(select),
      'prime-fill targets must be blank current primes only');
    const first = state.target, last = expected.primes.at(-1);
    select(last);
    assert.equal(state.target, last);
    assert.equal(HB.board.target, last);
    primeTray(expected);
    expectWrongInput(() => click(first));
    deltas.push(-3);
    get('hintBtn').click();
    deltas.push(-5);
    assert.equal(get('trayGrid').children.find(tile => Number(tile.dataset.n) === last).classList.contains('hint'), true);
    checkRunLedger(run, deltas);
    while (!state.done) {
      const target = state.target;
      landedAnswer();
      deltas.push(10 + (state.streak % 3 === 0 ? 5 : 0));
      if (state.done) deltas.push(20);
      else unchangedGameInput(() => {
        select(target);
        level.knownPrimes.forEach(select);
      }, 'answered and previously learned primes never become fill targets');
      primeTray(expected);
      checkRunLedger(run, deltas);
    }
    assert.equal(state.filledCount, expected.primes.length, 'completion counts this interval, not cumulative primes');
    assert.deepEqual(sorted(Object.keys(state.filled).map(Number)), expected.primes);
    settleChapter(run, deltas);
    const oldFilled = state.filled;
    if (mode === 'random') {
      HB.game.start(101 + index, mode);
      freshPrime(101 + index, mode, index, 'select');
    } else {
      overlay.onReplay();
      freshPrime(id, mode, index, 'fill');
    }
    assert.notEqual(state.filled, oldFilled, 'replay/switch creates fresh answer tracking');
    if (mode !== 'normal') {
      assert.equal(snapshot(), run.profile);
      assert.equal(saves, run.writes);
    }
  }
}
console.log('PASS prime-fill 96–100: all five exact intervals, cumulative known primes, current-only blanks/candidates, targeting, hints, replay and mode isolation.');

let skippedAnsweredTargets = 0;
for (const [index, expected] of PRIME_INTERVALS.entries()) {
  for (const scenario of [
    { mode: 'free', order: 'reverse', errors: true, hints: true },
    { mode: 'random', order: 'shuffle', errors: true, hints: true },
    { mode: 'normal', order: 'shuffle', errors: true, hints: true },
    { mode: 'normal', order: 'reverse', errors: false, hints: false }
  ]) {
    const { mode } = scenario, id = 101 + index, run = trackedStart(id, mode), deltas = [];
    freshPrime(id, mode, index, 'select');
    const state = HB.game.state, level = state.level, answered = [];
    const tasks = Array.from(level.tasks, item => item.cell);
    // Answer odd-index tasks first, then even-index tasks: advancing the first target must skip earlier answers.
    const order = scenario.order === 'reverse' ? tasks.slice().reverse() :
      tasks.filter((_, i) => i % 2 === 1).concat(tasks.filter((_, i) => i % 2 === 0));
    assert.notEqual(order[0], state.target, 'exercise acceptance of a prime other than the current target');
    for (const n of order) {
      if (scenario.errors) {
        const composite = numbers.find(value => value >= expected.min && value <= expected.max && value > 1 && !allPrimes.includes(value));
        const unlearned = allPrimes.find(value => value > expected.max);
        // The final interval has no later prime on the 1–100 board; 1 and composites remain wrong.
        for (const wrong of [1, composite, ...(unlearned === undefined ? [] : [unlearned])]) {
          expectWrongInput(() => select(wrong));
          deltas.push(-3);
          checkRunLedger(run, deltas);
        }
      }
      const nextTask = level.tasks.find(item => !state.filled[item.cell]);
      assert.equal(state.target, nextTask.cell, 'target/task must choose the first unanswered task, not tasks[filledCount]');
      assert.equal(get('targetPrompt').textContent, nextTask.prompt);
      assert.equal(get('activityPrompt').textContent, nextTask.prompt);
      if (scenario.hints) {
        get('hintBtn').click();
        deltas.push(-5);
        assert.equal(state.hintUsed, true);
        assert.equal(HB.board.el(nextTask.cell).classList.contains('hint'), true);
        assert.equal(state.filled[nextTask.cell], undefined, 'hint must identify an unanswered current prime');
        assert.ok(expected.primes.includes(nextTask.cell));
        for (const known of level.knownPrimes.concat(answered)) assert.equal(HB.board.el(known).classList.contains('hint'), false);
        checkRunLedger(run, deltas);
      }
      const marks = boardMarks.length, fills = boardFills.length, flights = flightCalls.length;
      const oldTarget = state.target, streak = state.streak;
      select(n);
      answered.push(n);
      assert.equal(state.filled[n], 1, 'track the clicked prime, not the target prime');
      assert.deepEqual(sorted(Object.keys(state.filled).map(Number)), sorted(answered));
      assert.equal(state.filledCount, answered.length);
      assert.equal(state.streak, streak + 1);
      assert.equal(boardMarks.length, marks + 1);
      assert.equal(boardMarks.at(-1)[0], n);
      assert.equal(boardFills.length, fills, 'select primes are marked, never filled');
      assert.equal(flightCalls.length, flights, 'prime selection commits without a tile flight');
      assert.equal(HB.board.target, null);
      assert.equal(HB.board.el(nextTask.cell).classList.contains('hint'), false, 'answering clears the previous hint');
      const firstUnfilled = tasks.find(cell => !answered.includes(cell));
      assert.equal(state.target, firstUnfilled ?? null);
      if (n !== oldTarget) assert.equal(state.target, oldTarget, 'out-of-order answers leave the first unanswered target in place');
      if (firstUnfilled !== undefined && tasks.indexOf(firstUnfilled) > tasks.indexOf(oldTarget) + 1) skippedAnsweredTargets++;
      assert.equal(state.done, answered.length === expected.primes.length);
      chapterProgress('select', answered.length, expected.primes.length);
      deltas.push(10 + (state.streak % 3 === 0 ? 5 : 0));
      if (state.done) deltas.push(20 + (state.mistakes === 0 ? 10 : 0) + (state.hintUsed ? 0 : 5));
      checkRunLedger(run, deltas);
      unchangedGameInput(() => {
        answered.forEach(select);
        level.knownPrimes.forEach(select);
      }, 'repeated/current-answered and known-prime clicks must not mark, penalize, score, consume hints or advance');
      checkRunLedger(run, deltas);
    }
    assert.equal(state.filledCount, expected.primes.length);
    assert.deepEqual(sorted(Object.keys(state.filled).map(Number)), expected.primes);
    assert.equal(get('progressBar').style.width, '100%');
    settleChapter(run, deltas);
    const oldFilled = state.filled;
    if (scenario.order === 'reverse') {
      overlay.onReplay();
      freshPrime(id, mode, index, 'select');
    } else {
      HB.game.start(96 + index, mode);
      freshPrime(96 + index, mode, index, 'fill');
    }
    assert.notEqual(state.filled, oldFilled, 'replay and switching clear answered prime state');
    if (mode !== 'normal') {
      assert.equal(snapshot(), run.profile);
      assert.equal(saves, run.writes);
    }
  }
}
assert.ok(skippedAnsweredTargets >= PRIME_INTERVALS.length, 'each shuffled range must skip an already answered interior task');
HB.game.suspend();
completeTimers();
console.log('PASS prime-select 101–105: all ranges in reverse/shuffled order, first-unfilled targets/hints, ignored repeats/known primes, invalid clicks, exact ledgers, replay and switching after completion.');

function isLocalRace() { return HB.game.state.raceMode === 'local'; }
function isHumanRaceActor(actor) { return isLocalRace() || actor === 'player'; }
function raceActorName(actor) {
  return isLocalRace() ? (actor === 'player' ? '玩家1 · 小兔' : '玩家2 · 小熊') : actor === 'player' ? '你' : '电脑';
}
assert.equal(HB.game.state.raceMode, 'ai', 'existing games default to human versus AI');

// Preserve the original movement/finish/cancellation unit scenarios on an explicit plain-board fixture.
// Level 216 remains completely real, including its six full natural games. The expanded tests below
// restore the real builder and exercise every generated special square in 217–220 separately.
const realRaceBuild = HB.levels.build;
HB.levels.build = function (...args) {
  const level = realRaceBuild.apply(this, args);
  if (level.kind === 'race' && level.id !== 216) {
    level.ladders = [];
    level.traps = [];
    level.cardsEnabled = false;
  }
  return level;
};
// Match store.recordLevel's best-star/unlock behavior for these ledgers, without changing the older harness.
HB.store.recordLevel = function (id, stars) {
  recordCalls.push([id, stars]);
  this.data.stars[id] = Math.max(this.data.stars[id] || 0, stars);
  this.data.unlocked = Math.max(this.data.unlocked, Math.min(HB.levels.total, id + 1));
  this.save();
};
const raceTargets = observeCalls(HB.board, 'setTarget');
const raceSounds = observeCalls(HB.audio, 'play');
const raceSay = observeCalls(HB.ui, 'say');
const raceScoreRenders = observeCalls(HB.ui, 'renderScore');
const raceAccountRenders = observeCalls(HB.ui, 'renderAccount');
const gameMath = vm.runInContext('Math', context);
const diceSeen = { player: new Set(), ai: new Set() };
const adjustmentsSeen = new Set(), terminalPaths = new Set();
let raceSerial = 0, lastRaceButtons = [];
function withRaceRandom(value, callback, expectedCalls = 1) {
  const original = gameMath.random;
  let calls = 0;
  gameMath.random = () => { calls++; return value; };
  try {
    const result = callback();
    assert.equal(calls, expectedCalls, 'exact random draws: seed/die/trap/eligible card lottery only');
    return result;
  } finally { gameMath.random = original; }
}
function forceClick(button) {
  // Also bypass disabled DOM controls: phase/runId guards must protect already queued handlers.
  button.listeners.click?.({ currentTarget: button, target: button });
}
function raceView() {
  const ids = ['racePanel', 'racePlayerPosition', 'raceAiPosition', 'raceTurn', 'raceDie', 'raceRoll',
    'raceQuestion', 'raceQuestionLabel', 'raceFeedback', 'raceRule', 'hintBtn', 'raceCards', 'raceHand',
    'raceContinue', 'raceCardStatus', 'raceEvent', 'racePiece-player', 'racePiece-ai',
    'raceDefense', 'raceDefensePrompt', 'raceLocalMode', 'raceAiMode', 'raceModeNote'];
  return {
    ...worksheetView(), pendingTimers: [...timers.entries()], moves: raceMoves.length,
    defense: get('raceDefenseActions').children.map(button => [button.textContent, button.disabled, { ...button.dataset }]),
    defenseScrolls: get('raceDefense').scrolls.length,
    pendingMove: pendingRaceMove && { ...pendingRaceMove }, moveCancellations: raceMoveCancellations,
    targets: raceTargets.length, sounds: raceSounds.length, say: raceSay.length,
    scoreRenders: raceScoreRenders.length, accountRenders: raceAccountRenders.length,
    marks: boardMarks.length, wrong: wrongCalls.length, flights: flightCalls.length,
    boardScrolls: get('board').scrolls.length, panelScrolls: get('racePanel').scrolls.length,
    ui: ids.map(id => {
      const el = get(id);
      return [id, el.textContent, el.hidden, el.disabled, { ...el.dataset }, { ...el.attributes }, [...el.classes]];
    }),
    buttons: get('raceAnswers').children.map(button => [button.textContent, button.disabled, { ...button.dataset }]),
    hand: get('raceHand').children.map(button => [button.textContent, button.disabled, { ...button.dataset }])
  };
}
function noRaceWork(callback, message) {
  const before = raceView();
  callback();
  assert.deepEqual(raceView(), before, message);
}
function blockedRaceInput(roll = true, buttons = lastRaceButtons) {
  noRaceWork(() => {
    numbers.forEach(select);
    get('hintBtn').click();
    if (roll) { get('raceRoll').click(); forceClick(get('raceRoll')); }
    buttons.forEach(button => { button.click(); forceClick(button); });
    if (HB.game.state.race.phase !== 'cards' || !isHumanRaceActor(HB.game.state.race.turn)) {
      get('raceHand').children.forEach(button => { button.click(); forceClick(button); });
      get('raceContinue').click(); forceClick(get('raceContinue'));
    }
  }, 'race input must not act outside its allowed phase (including queued/double clicks)');
}
function raceUI() {
  const state = HB.game.state, r = state.race;
  assert.equal(get('racePanel').dataset.phase, r.phase);
  assert.equal(get('racePanel').dataset.turn, r.turn);
  assert.equal(Number(get('racePlayerPosition').textContent), r.positions.player);
  assert.equal(Number(get('raceAiPosition').textContent), r.positions.ai);
  assert.equal(Number(get('raceDie').dataset.value), r.dice);
  assert.equal(get('raceDie').getAttribute('aria-label'), r.dice ? `骰子 ${r.dice} 点` : '骰子等待掷出');
  assert.equal(get('raceRoll').disabled, state.busy || state.done || !isHumanRaceActor(r.turn) || r.phase !== 'roll');
  assert.equal(get('raceTurn').textContent, `第 ${r.turnNumber} 回合 · ${raceActorName(r.turn)}`);
  assert.equal(get('raceFeedback').textContent, r.feedback);
  assert.equal(get('progressText').textContent, `${raceActorName('player')} ${r.positions.player}/100 · ${raceActorName('ai')} ${r.positions.ai}/100`);
  assert.equal(get('progressBar').style.width, (r.positions.player - 1) / 99 * 100 + '%');
  assert.equal(get('raceLocalMode').getAttribute('aria-pressed'), String(isLocalRace()));
  assert.equal(get('raceAiMode').getAttribute('aria-pressed'), String(!isLocalRace()));
  assert.equal(get('raceDefense').hidden, r.phase !== 'defense');
  // Legacy lottery boundary fixtures seed hands after the question has rendered.
  if (state.level.cardsEnabled && r.phase !== 'question') {
    const actor = r.defense ? r.defense.defender : isLocalRace() ? r.turn : 'player';
    assert.deepEqual(get('raceHand').children.map(button => button.dataset.card), Array.from(r.cards[actor]));
    assert.equal(get('raceHand').getAttribute('aria-label'), raceActorName(actor) + '的道具卡');
  }
  if (isLocalRace()) {
    assert.equal(get('racePlayerName').textContent, raceActorName('player'));
    assert.equal(get('raceAiName').textContent, raceActorName('ai'));
    assert.ok([...timers.keys()].every(id => scheduledTimeouts.find(job => job.id === id).delay !== 1200), 'local play never schedules an AI roll');
  }
}
function freshRace(id, mode) {
  const state = HB.game.state, r = state.race;
  assert.equal(state.level.id, id);
  assert.equal(state.level.kind, 'race');
  assert.equal(state.level.interaction, 'race');
  assert.equal(state.mode, mode);
  assert.deepEqual({ ...r.positions }, { player: 1, ai: 1 });
  assert.deepEqual([r.turn, r.phase, r.dice, r.question, r.winner, r.turnNumber], ['player', 'roll', 0, null, null, 1]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.cards)), { player: [], ai: [] });
  assert.deepEqual({ ...r.shields }, { player: false, ai: false });
  assert.deepEqual({ ...r.sleeping }, { player: false, ai: false });
  assert.equal(r.defense, null);
  assert.equal(get('raceDefense').hidden, true);
  assert.equal(get('raceDefenseActions').children.length, 0);
  assert.equal(r.event, '');
  assert.equal(get('raceCards').hidden, !state.level.cardsEnabled);
  assert.equal(get('raceHand').children.length, 0);
  for (const actor of ['player', 'ai']) {
    assert.equal(get('racePiece-' + actor).classList.contains('race-shielded'), false);
    assert.equal(get('racePiece-' + actor).classList.contains('race-sleeping'), false);
  }
  assert.equal(typeof r.feedback, 'string');
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.equal(state.filledCount, 0);
  assert.equal(state.mistakes, 0);
  assert.equal(state.streak, 0);
  assert.equal(state.hintUsed, false);
  assert.equal(state.target, null);
  assert.equal(Object.keys(state.filled).length, 0);
  assert.equal(HB.board.target, null);
  assert.equal(get('racePanel').hidden, false);
  assert.equal(get('hintBtn').hidden, true);
  assert.equal(get('trayGrid').hidden, true);
  assert.equal(get('activityPanel').hidden, true);
  assert.equal(get('playClock').hidden, true);
  assert.equal(get('trayGrid').children.length, 0);
  assert.equal(get('raceAnswers').children.length, 0);
  assert.equal(get('nextBtn').hidden, true);
  assert.equal(overlay, null);
  assert.equal(timers.size, 0);
  assert.equal(pendingRaceMove, null);
  raceUI();
  blockedRaceInput(false);
}
function raceProfile(id, motion = 'full') {
  return { id: 'race-profile-' + (++raceSerial), name: 'Race tester', score: 500, stars: { 2: 2 },
    unlocked: id, currentLevel: 215, settings: { motion, sound: true, material: 'wood' } };
}
function startRace(id = 216, mode = 'normal', motion = 'full', raceMode = 'ai') {
  if (HB.game.state.raceMode !== raceMode) {
    if (!HB.game.state.race) withRaceRandom(.5, () => HB.game.start(id, 'free'));
    withRaceRandom(.5, () => get(raceMode === 'local' ? 'raceLocalMode' : 'raceAiMode').click());
  }
  HB.game.suspend();
  assert.equal(timers.size, 0, 'suspend clears every outstanding race/completion timeout');
  HB.store.data = raceProfile(id, motion);
  const run = withRaceRandom(0.125, () => trackedStart(id, mode));
  run.local = raceMode === 'local';
  assert.equal(HB.game.state.raceMode, raceMode);
  run.say = raceSay.length;
  run.scoreRenders = raceScoreRenders.length;
  run.accountRenders = raceAccountRenders.length;
  freshRace(id, mode);
  raceLedger(run);
  return run;
}
function raceLedger(run) {
  const state = HB.game.state, normal = run.mode === 'normal' && !run.local;
  const won = state.done && state.race.winner === 'player';
  const stars = state.mistakes === 0 ? 3 : state.mistakes <= 2 ? 2 : 1;
  const bonus = 20 + (state.mistakes === 0 ? 10 : 0) + (state.hintUsed ? 0 : 5);
  const expected = JSON.parse(run.profile);
  if (normal) expected.currentLevel = run.id;
  if (normal && won) {
    expected.score += bonus;
    expected.stars[run.id] = Math.max(expected.stars[run.id] || 0, stars);
    expected.unlocked = Math.max(expected.unlocked, Math.min(220, run.id + 1));
  }
  assert.deepEqual(JSON.parse(snapshot()), expected, `${run.mode}: race preserves the entire account except a normal start/win`);
  assert.deepEqual(scoreCalls.slice(run.scores), normal && won ? [[bonus]] : [], 'no per-question score, penalty or streak bonus');
  assert.deepEqual(recordCalls.slice(run.records), normal && won ? [[run.id, stars]] : [], 'only a normal win records stars/unlocks');
  assert.equal(saves, run.writes + (normal ? 1 + (won ? 2 : 0) : 0), 'practice/loss cannot save rewards');
  assert.equal(raceScoreRenders.length, run.scoreRenders + Number(normal && won));
  assert.equal(raceAccountRenders.length, run.accountRenders + Number(normal && won));
  assert.equal(state.hintUsed, false, 'race hints remain unavailable in every phase');
  assert.equal(state.streak, 0, 'race answers do not earn ordinary streak rewards');
  assert.equal(Object.keys(state.filled).length, 0, 'race questions are not board-fill tasks');
}
function raceJob(delay) {
  assert.equal(timers.size, 1, 'exactly one race or completion timer may be pending');
  const job = scheduledTimeouts.at(-1);
  assert.equal(job.delay, delay);
  assert.equal(timers.get(job.id), job.fn);
  return job;
}
function fireRaceJob(delay) {
  const job = raceJob(delay);
  timers.delete(job.id);
  job.fn();
  return job;
}
function beginRaceRoll(dice) {
  const state = HB.game.state, r = state.race, actor = r.turn;
  assert.ok(Number.isInteger(dice) && dice >= 1 && dice <= 6);
  assert.equal(r.phase, isHumanRaceActor(actor) ? 'roll' : 'waiting');
  assert.equal(state.busy, false);
  assert.equal(pendingRaceMove, null);
  if (!isHumanRaceActor(actor)) {
    raceJob(1200);
    blockedRaceInput();
  } else {
    assert.equal(timers.size, 0);
    noRaceWork(completeTimers, 'a human roll must wait indefinitely for a manual click');
  }
  const before = { ...r.positions }, moves = raceMoves.length;
  // Exercise the lower and upper random boundaries as well as all interior die faces.
  withRaceRandom(dice === 6 ? 1 - Number.EPSILON : (dice - 1) / 6, () => {
    if (isHumanRaceActor(actor)) get('raceRoll').click();
    else fireRaceJob(1200);
  });
  diceSeen[actor].add(dice);
  assert.equal(r.phase, 'rolling');
  assert.equal(state.busy, true);
  assert.equal(r.question, null);
  assert.equal(r.dice, dice % 6 + 1, 'first die animation frame is synchronous');
  assert.equal(get('raceAnswers').children.length, 0);
  assert.deepEqual({ ...r.positions }, before);
  assert.equal(raceMoves.length, moves);
  raceUI();
  blockedRaceInput();
}
function finishRaceDie(dice) {
  const state = HB.game.state, r = state.race, before = { ...r.positions };
  const moves = raceMoves.length, filled = state.filledCount, profile = snapshot(), writes = saves;
  const frames = [r.dice];
  for (let frame = 1; frame < 6; frame++) {
    fireRaceJob(80);
    frames.push(r.dice);
    assert.equal(r.dice, (dice + frame) % 6 + 1);
    assert.equal(r.phase, 'rolling');
    assert.equal(r.question, null);
    assert.deepEqual({ ...r.positions }, before, 'no position changes during the six die frames');
    assert.equal(raceMoves.length, moves, 'movement waits for all die frames and the final pause');
    assert.equal(get('raceAnswers').children.length, 0);
    raceUI();
    blockedRaceInput();
  }
  assert.equal(new Set(frames).size, 6);
  assert.equal(r.dice, dice);
  fireRaceJob(160);
  assert.equal(r.phase, 'moving');
  assert.equal(state.busy, true);
  assert.equal(r.question, null);
  assert.deepEqual({ ...r.positions }, before, 'the first move must also wait for its own animation callback');
  assert.equal(raceMoves.length, moves + 1);
  assert.equal(state.filledCount, filled);
  assert.equal(snapshot(), profile);
  assert.equal(saves, writes);
  assert.equal(timers.size, 0);
  assert.equal(HB.board.target, null);
  assert.deepEqual({ ...get('board').scrolls.at(-1) }, { block: 'nearest', behavior: 'smooth' });
}
function startRaceMove(dice) { beginRaceRoll(dice); finishRaceDie(dice); }
function landRaceMove(destination, { direct = false, followup = false } = {}) {
  const state = HB.game.state, r = state.race, actor = r.turn;
  const from = r.positions[actor], other = actor === 'player' ? 'ai' : 'player';
  const otherPosition = r.positions[other], question = r.question;
  const expected = direct ? [destination] : Array.from({ length: Math.abs(destination - from) }, (_, i) => from + Math.sign(destination - from) * (i + 1));
  const actual = [];
  let last = null;
  for (const next of expected) {
    const move = pendingRaceMove, moves = raceMoves.length;
    assert.ok(move, 'each step needs its own pending animation');
    assert.equal(move, raceMoves.at(-1));
    assert.equal(move.actor, actor);
    assert.equal(move.next, next, 'movement follows numeric order, including snake-row boundaries');
    assert.equal(move.from, r.positions[actor]);
    assert.deepEqual(move.positions, { ...r.positions });
    assert.equal(Math.abs(move.next - move.from), direct ? Math.abs(destination - from) : 1,
      direct ? 'a ladder makes exactly one direct jump' : 'ordinary moves never skip intermediate cells');
    assert.equal(move.duration, HB.store.data.settings.motion === 'lite' ? (direct ? 320 : 140) : (direct ? 560 : 260));
    assert.equal(move.cancelled, false);
    assert.equal(move.completed, false);
    assert.equal(state.busy, true);
    assert.equal(r.phase, 'moving');
    assert.equal(r.question, question, 'no landing question is installed before the final step');
    assert.equal(HB.board.target, null);
    assert.ok(get('raceAnswers').children.every(button => button.disabled));
    raceUI();
    blockedRaceInput();
    move.completed = true;
    pendingRaceMove = null;
    move.callback();
    assert.equal(r.positions[actor], next, 'position commits exactly when this callback completes');
    assert.equal(r.positions[other], otherPosition, 'moving one piece never changes the opponent');
    actual.push(next);
    raceUI();
    assert.equal(raceMoves.length, moves + Number(next !== destination || followup),
      'only the preceding callback may schedule the next step or one landing effect');
    if (next !== destination) {
      assert.equal(state.busy, true);
      assert.equal(r.phase, 'moving');
      assert.equal(r.question, question);
    }
    noRaceWork(() => { move.callback(); move.callback(); }, 'every movement callback is single-use, including intermediate/special steps');
    last = move;
  }
  assert.deepEqual(actual, expected);
  assert.equal(r.positions[actor], destination);
  assert.equal(!!pendingRaceMove, followup);
  return last;
}
function raceQuestion() {
  const state = HB.game.state, r = state.race;
  assert.equal(r.phase, 'question');
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.equal(r.question, state.level.questions[r.positions[r.turn]], 'use the actual landing-cell question');
  assert.equal(get('raceQuestion').textContent, r.question.prompt);
  assert.equal(HB.board.target, r.positions[r.turn]);
  assert.equal(timers.size, 0, 'even on the AI turn, an answer must wait for the human');
  const buttons = get('raceAnswers').querySelectorAll('button');
  assert.equal(buttons.length, 4);
  assert.equal(new Set(buttons.map(button => Number(button.dataset.value))).size, 4);
  assert.deepEqual(buttons.map(button => Number(button.dataset.value)), Array.from(r.question.choices));
  buttons.forEach(button => {
    assert.equal(button.disabled, false);
    assert.equal(Number(button.textContent), Number(button.dataset.value));
    assert.equal(button.getAttribute('aria-label'), '答案 ' + button.dataset.value);
  });
  assert.deepEqual({ ...get('racePanel').scrolls.at(-1) }, { block: 'nearest', behavior: 'smooth' });
  lastRaceButtons = buttons.slice();
  raceUI();
  blockedRaceInput(true, []);
  return buttons;
}
function rollToQuestion(dice) {
  const r = HB.game.state.race, destination = r.positions[r.turn] + dice;
  assert.ok(destination < 100, 'use explicit terminal tests instead of accidentally skipping a question');
  startRaceMove(dice);
  landRaceMove(destination);
  return raceQuestion();
}
function beginRaceAnswer(correct) {
  const state = HB.game.state, r = state.race, actor = r.turn;
  const buttons = raceQuestion(), question = r.question;
  const button = buttons.find(item => (Number(item.dataset.value) === question.answer) === correct);
  assert.ok(button);
  const steps = actor === 'player' ? (correct ? 2 : -1) : (correct ? -2 : 3);
  const before = { ...r.positions }, count = state.filledCount, mistakes = state.mistakes;
  const profile = snapshot(), writes = saves, turnNumber = r.turnNumber, targets = raceTargets.length;
  button.click();
  adjustmentsSeen.add(actor + ':' + (correct ? 'correct' : 'wrong'));
  assert.equal(state.filledCount, count + 1);
  assert.equal(state.mistakes, mistakes + Number(!correct));
  assert.equal(snapshot(), profile, 'answers do not directly add or subtract account points');
  assert.equal(saves, writes);
  assert.equal(r.question, question);
  assert.equal(r.turn, actor, 'turn cannot change before the adjustment finishes');
  assert.equal(r.turnNumber, turnNumber);
  assert.deepEqual({ ...r.positions }, before);
  assert.ok(buttons.every(item => item.disabled));
  assert.match(r.feedback, new RegExp((correct ? '答对了' : '答错了') + '.*' + (steps > 0 ? '前进 ' : '后退 ') + Math.abs(steps)));
  assert.deepEqual(raceSounds.at(-1), [correct ? 'correct' : 'wrong']);
  blockedRaceInput();
  return { actor, destination: Math.max(1, Math.min(100, before[actor] + steps)), count, mistakes, correct, turnNumber, targets, buttons };
}
function finishRaceAnswer(answer) {
  const state = HB.game.state, r = state.race;
  const last = landRaceMove(answer.destination);
  assert.equal(state.filledCount, answer.count + 1, 'reward/penalty landing must not trigger another question');
  assert.equal(state.mistakes, answer.mistakes + Number(!answer.correct));
  assert.ok(raceTargets.slice(answer.targets).every(args => args[0] === null), 'adjustment destinations never ask chain questions');
  assert.deepEqual(get('raceAnswers').children, answer.buttons, 'adjustments never generate extra answer buttons');
  if (answer.destination < 100) {
    assert.equal(r.turn, answer.actor === 'player' ? 'ai' : 'player');
    assert.equal(r.turnNumber, answer.turnNumber + 1);
    assert.equal(r.phase, answer.actor === 'player' ? 'waiting' : 'roll');
    assert.equal(state.busy, false);
    assert.equal(state.done, false);
    assert.equal(r.question, null);
    assert.equal(HB.board.target, null);
    assert.ok(answer.buttons.every(button => button.disabled));
    if (answer.actor === 'player') { raceJob(1200); blockedRaceInput(); }
    else { assert.equal(timers.size, 0); blockedRaceInput(false); }
  }
  raceUI();
  return last;
}
function answerRace(correct) { return finishRaceAnswer(beginRaceAnswer(correct)); }
function settleRace(run, winner, lastMove, pathName) {
  const state = HB.game.state, r = state.race, lost = !run.local && winner === 'ai';
  terminalPaths.add(run.mode + ':' + pathName);
  assert.equal(state.done, true);
  assert.equal(state.busy, true);
  assert.equal(r.phase, 'done');
  assert.equal(r.winner, winner);
  assert.equal(r.positions[winner], 100);
  assert.ok(r.positions[winner === 'player' ? 'ai' : 'player'] < 100);
  assert.equal(pendingRaceMove, null);
  assert.equal(overlay, null, 'only the completion overlay waits; winning state and rewards are immediate');
  assert.equal(overlayCalls.length, run.overlays);
  raceLedger(run);
  assert.deepEqual(raceSay.slice(run.say), lost ? [] : [['win']]);
  noRaceWork(() => { lastMove.callback(); lastMove.callback(); }, 'duplicate final movement callbacks cannot finish/reward twice');
  blockedRaceInput();
  fireRaceJob(620);
  assert.equal(state.busy, false);
  assert.equal(overlayCalls.length, run.overlays + 1);
  assert.equal(overlay.race, true);
  assert.equal(overlay.lost, lost);
  assert.equal(overlay.levelId, run.id);
  assert.equal(overlay.practice, run.mode !== 'normal');
  assert.equal(overlay.localRace, !!run.local);
  assert.equal(overlay.winnerName, run.local ? raceActorName(winner) : null);
  assert.equal(overlay.stars, lost || run.local ? 0 : state.mistakes === 0 ? 3 : state.mistakes <= 2 ? 2 : 1);
  assert.equal(overlay.gained, lost || run.local || run.mode !== 'normal' ? 0 : state.mistakes === 0 ? 35 : 25);
  assert.equal(overlay.mistakes, state.mistakes);
  assert.equal(overlay.last, !!run.local || lost || (run.id === 220 && run.mode !== 'random'));
  assert.equal(get('nextBtn').hidden, overlay.last, 'losses never offer a next level, including random practice');
  assert.equal(overlay.allDone, false);
  assert.equal(overlay.elapsed, null);
  assert.equal(timers.size, 0, 'a terminal move must not schedule another AI turn');
  blockedRaceInput();
  noRaceWork(() => { lastMove.callback(); completeTimers(); }, 'done stays idempotent after the overlay opens');
  raceLedger(run);
}

// Keep all original unit paths; validate new questions against a separate unmodified generated level.
for (const index of [0, 1, 2, 3, 4]) {
  const id = 216 + index;
  for (const mode of ['normal', 'free', 'random']) {
    const run = startRace(id, mode, index % 2 ? 'lite' : 'full');
    const state = HB.game.state, level = state.level;
    assert.equal(HB.levels.list[id - 1].kind, 'race');
    assert.equal(HB.levels.list[id - 1].interaction, 'race');
    assert.equal(level.total, 220);
    assert.equal(level.size, 10);
    assert.equal(level.maxNumber, 20);
    assert.equal(level.stage, index);
    assert.equal(level.blanks.length, 0);
    assert.equal(level.candidates.length, 0);
    assert.deepEqual(sorted(Object.keys(level.questions).map(Number)), numbers);
    const types = ['add', 'subtract', 'decompose', 'bond', ...(index >= 2 ? ['multiply'] : []), ...(index === 4 ? ['divide'] : [])];
    for (const cell of numbers) {
      const q = level.questions[cell], max = q.type === 'multiply' ? 81 : 20;
      const value = q.type === 'add' ? q.left + q.right : q.type === 'bond' ? q.right - q.left :
        q.type === 'multiply' ? q.left * q.right : q.type === 'divide' ? q.left / q.right : q.left - q.right;
      assert.ok(types.includes(q.type));
      assert.equal(level.values[cell], cell);
      assert.equal(q.answer, value);
      assert.ok(Number.isInteger(value) && value >= 0 && value <= max);
      assert.ok(q.left >= 0 && q.left <= (q.type === 'multiply' ? 9 : 20));
      assert.ok(q.right >= 0 && q.right <= (q.type === 'multiply' ? 9 : 20));
      if (q.type === 'multiply' || q.type === 'divide') assert.ok(q.left > 0 && q.right > 0);
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices).size, 4);
      assert.ok(q.choices.includes(q.answer));
      assert.ok(q.choices.every(n => Number.isInteger(n) && n >= 0 && n <= max));
    }
    assert.deepEqual([...new Set(Object.values(level.questions).map(q => q.type))].sort(), types.sort());
    assert.equal(realRaceBuild(id, level.seed).cardsEnabled, id >= 219);
    for (let turn = 0; turn < 4; turn++) {
      rollToQuestion(1 + (index + turn) % 6);
      answerRace(turn < 2);
      raceLedger(run);
    }
    assert.equal(state.filledCount, 4);
    assert.equal(state.mistakes, 2);
    // Mixed answers still only earn one completion bonus, at the reward's final landing.
    state.race.positions.player = 98;
    rollToQuestion(1);
    const last = answerRace(true);
    settleRace(run, 'player', last, 'mixed-reward-over');
    const previousQuestions = JSON.stringify(level.questions);
    withRaceRandom(0.875, () => overlay.onReplay());
    freshRace(id, mode);
    assert.notEqual(JSON.stringify(state.level.questions), previousQuestions, 'race replay uses a fresh board seed');
    if (mode !== 'normal') {
      assert.equal(snapshot(), run.profile);
      assert.equal(saves, run.writes);
    }
  }
}
assert.deepEqual([...diceSeen.player].sort(), [1, 2, 3, 4, 5, 6]);
assert.deepEqual([...diceSeen.ai].sort(), [1, 2, 3, 4, 5, 6]);
assert.deepEqual([...adjustmentsSeen].sort(), ['ai:correct', 'ai:wrong', 'player:correct', 'player:wrong']);
console.log('PASS race 216–220: real four-choice questions, both actors/dice 1–6, six frames, sequential callback-only motion, all four adjustments, no chains, hints/board/input locks and replay.');

// Entire games from 1 to 100: no position, turn, question or completion state is patched.
for (const mode of ['normal', 'free', 'random']) {
  for (const winner of ['player', 'ai']) {
    const run = startRace(216, mode), state = HB.game.state;
    let turns = 0, last;
    while (!state.done) {
      const r = state.race, actor = r.turn;
      const dice = actor === winner ? 6 : 1;
      const destination = Math.min(100, r.positions[actor] + dice);
      startRaceMove(dice);
      last = landRaceMove(destination);
      if (!state.done) {
        raceQuestion();
        last = answerRace(winner === 'player');
      }
      raceLedger(run);
      if (++turns > 30) throw new Error('natural race failed to terminate');
    }
    assert.equal(turns, winner === 'player' ? 25 : 22);
    assert.equal(state.race.turnNumber, turns);
    assert.equal(state.filledCount, winner === 'player' ? 24 : 22);
    assert.equal(state.mistakes, winner === 'player' ? 0 : 22);
    assert.equal(state.race.positions[winner === 'player' ? 'ai' : 'player'], 1,
      'AI correct answers clamp at 1; player wrong answers return to 1');
    settleRace(run, winner, last, 'natural-' + winner);
  }
}
console.log('PASS natural races: complete player wins and AI wins from 1 to 100 in all three modes, AI human answers, clamp-to-1, clean/failed account ledgers.');

const finishCases = [
  { name: 'player-die-exact', actor: 'player', from: 94, dice: 6 },
  { name: 'player-die-over', actor: 'player', from: 98, dice: 6 },
  { name: 'player-reward-exact', actor: 'player', from: 97, dice: 1, correct: true },
  { name: 'player-reward-over', actor: 'player', from: 98, dice: 1, correct: true },
  { name: 'ai-die-exact', actor: 'ai', from: 94, dice: 6 },
  { name: 'ai-die-over', actor: 'ai', from: 98, dice: 6 },
  { name: 'ai-error-exact', actor: 'ai', from: 96, dice: 1, correct: false },
  { name: 'ai-error-over', actor: 'ai', from: 98, dice: 1, correct: false }
];
for (const mode of ['normal', 'free', 'random']) {
  for (const scenario of finishCases) {
    const run = startRace(220, mode), state = HB.game.state, r = state.race;
    if (scenario.actor === 'ai') { rollToQuestion(1); answerRace(true); raceLedger(run); }
    r.positions[scenario.actor] = scenario.from;
    const filled = state.filledCount;
    let last;
    if (scenario.correct === undefined) {
      startRaceMove(scenario.dice);
      last = landRaceMove(100);
      assert.equal(r.question, null, 'dice reaching/passing 100 wins without a landing question');
      assert.equal(get('raceAnswers').children.length, 0);
      assert.equal(state.filledCount, filled);
    } else {
      rollToQuestion(scenario.dice);
      const question = r.question;
      last = answerRace(scenario.correct);
      assert.equal(state.filledCount, filled + 1);
      assert.equal(r.question, question, 'a terminal adjustment never asks the cell-100 question');
    }
    settleRace(run, scenario.actor, last, scenario.name);
    // Both victory and defeat replay preserve the chosen mode and reset every race field.
    withRaceRandom(0.625, () => overlay.onReplay());
    freshRace(220, mode);
    if (mode !== 'normal') {
      assert.equal(snapshot(), run.profile);
      assert.equal(saves, run.writes);
    }
  }
}
for (const mode of ['normal', 'free', 'random']) {
  for (const name of [...finishCases.map(item => item.name), 'natural-player', 'natural-ai', 'mixed-reward-over']) {
    assert.ok(terminalPaths.has(mode + ':' + name), 'missing explicit winner/ledger path: ' + mode + ':' + name);
  }
}
// One-star wins are reachable through real mistakes, not by seeding the error counter.
{
  const run = startRace(), state = HB.game.state;
  for (let i = 0; i < 3; i++) {
    rollToQuestion(1); answerRace(false);
    rollToQuestion(1); answerRace(true);
    raceLedger(run);
  }
  assert.equal(state.mistakes, 3);
  state.race.positions.player = 99;
  startRaceMove(1);
  settleRace(run, 'player', landRaceMove(100), 'one-star-win');
  assert.equal(overlay.stars, 1);
  assert.equal(overlay.gained, 25);
  overlay.onNext();
  freshRace(217, 'normal');
  assert.equal(HB.store.data.unlocked, 217, 'a win unlocks exactly the next level');
}
// Losing an already-completed level must not erase old stars or reduce an existing unlock.
{
  const run = startRace(), state = HB.game.state;
  HB.store.data.stars[216] = 3;
  HB.store.data.unlocked = 220;
  const expected = JSON.parse(run.profile);
  expected.stars[216] = 3;
  expected.unlocked = 220;
  run.profile = JSON.stringify(expected);
  rollToQuestion(1); answerRace(true);
  state.race.positions.ai = 99;
  startRaceMove(1);
  settleRace(run, 'ai', landRaceMove(100), 'loss-preserves-progress');
}
console.log('PASS race finishes: exact/overshoot dice, player +2 and AI +3 terminal paths in every mode; final level 220, no loss unlock/next/reward, all star tiers and idempotent done.');

// Force old callbacks to execute after cancellation, including while a new question is answerable.
const cancellationPhases = ['player-die', 'die-pause', 'player-move', 'player-answer', 'player-reward',
  'ai-wait', 'ai-die', 'ai-move', 'ai-answer', 'ai-reward', 'win-overlay', 'loss-overlay'];
for (const phase of cancellationPhases) {
  for (const action of ['replay', 'level-change', 'account-switch', 'suspend']) {
    startRace();
    const state = HB.game.state, oldRace = state.race;
    if (phase === 'player-die') beginRaceRoll(3);
    else if (phase === 'die-pause') {
      beginRaceRoll(3);
      for (let i = 0; i < 5; i++) fireRaceJob(80);
      raceJob(160);
    } else if (phase === 'player-move') startRaceMove(3);
    else if (phase === 'win-overlay') {
      oldRace.positions.player = 99;
      startRaceMove(1); landRaceMove(100); raceJob(620);
    } else {
      rollToQuestion(1);
      if (phase === 'player-reward') beginRaceAnswer(true);
      else if (phase !== 'player-answer') {
        answerRace(true);
        if (phase === 'ai-die') beginRaceRoll(3);
        else if (phase === 'ai-move') startRaceMove(3);
        else if (phase === 'loss-overlay') {
          oldRace.positions.ai = 99;
          startRaceMove(1); landRaceMove(100); raceJob(620);
        } else if (phase !== 'ai-wait') {
          rollToQuestion(1);
          if (phase === 'ai-reward') beginRaceAnswer(false);
        }
      }
    }
    // A new roll detaches the previous answers; retain those handlers as well as visible buttons.
    const oldButtons = [...new Set(get('raceAnswers').children.concat(lastRaceButtons))];
    const oldTimers = [...timers.entries()];
    const oldMove = pendingRaceMove, cancellations = raceMoveCancellations;
    const oldProfile = HB.store.data, oldProfileValue = JSON.stringify(oldProfile);
    const staleWork = () => {
      const previousRace = JSON.stringify(oldRace);
      oldTimers.forEach(([, callback]) => { callback(); callback(); });
      if (oldMove) { oldMove.callback(); oldMove.callback(); }
      oldButtons.forEach(button => { button.click(); forceClick(button); });
      assert.equal(JSON.stringify(oldRace), previousRace, 'stale work must not even mutate the detached old race object');
    };
    const destination = action === 'level-change' || action === 'account-switch' ? 217 : 216;
    if (action === 'replay') withRaceRandom(0.75, () => get('replayBtn').click());
    else if (action === 'level-change') {
      // Free switching may cross the current normal-mode lock without changing that account.
      withRaceRandom(0.75, () => HB.game.start(destination, 'free'));
    } else {
      HB.game.suspend();
      noRaceWork(staleWork, `${phase}/${action}: suspended callbacks and buttons are inert before restart`);
      if (action === 'account-switch') {
        // Mirror ui.changePlayer's suspend -> apply another profile -> normal restart sequence.
        HB.store.data = raceProfile(217, 'lite');
        HB.store.data.currentLevel = 217;
        noRaceWork(staleWork, `${phase}: old work cannot write the newly selected account during loading`);
      }
      withRaceRandom(0.75, () => HB.game.start(destination, 'normal'));
    }
    const mode = action === 'level-change' ? 'free' : 'normal';
    freshRace(destination, mode);
    assert.notEqual(state.race, oldRace);
    assert.equal(raceMoveCancellations, cancellations + Number(!!oldMove));
    if (oldMove) assert.equal(oldMove.cancelled, true, 'suspend must call the board cancellation function');
    oldTimers.forEach(([id]) => assert.equal(timers.has(id), false, 'suspend must actually clear old dice/wait/completion timers'));
    noRaceWork(staleWork, `${phase}/${action}: runId rejects old work after a fresh start unlocks input`);
    // Make an old button's value valid in the NEW question. Otherwise the choices/phase guard could mask a missing runId guard.
    let matchingButton;
    if (oldButtons.length) {
      const cell = numbers.find(n => n > 1 && n < 100 && oldButtons.some(button =>
        state.level.questions[n].choices.includes(Number(button.dataset.value))));
      assert.ok(cell, 'fixture must provide an overlapping old/new answer value');
      matchingButton = oldButtons.find(button => state.level.questions[cell].choices.includes(Number(button.dataset.value)));
      state.race.positions.player = cell - 1;
    }
    beginRaceRoll(1);
    noRaceWork(staleWork, `${phase}/${action}: old work cannot interfere with a new die timer`);
    finishRaceDie(1);
    noRaceWork(staleWork, `${phase}/${action}: old work cannot interfere with a new pending move`);
    landRaceMove(state.race.positions.player + 1);
    raceQuestion();
    if (matchingButton) assert.ok(state.race.question.choices.includes(Number(matchingButton.dataset.value)));
    noRaceWork(staleWork, `${phase}/${action}: stale answers cannot answer a valid new question`);
    noRaceWork(completeTimers, `${phase}/${action}: no deferred overlay, move or account writes remain`);
    if (action === 'account-switch') assert.equal(JSON.stringify(oldProfile), oldProfileValue, 'the previous account is unchanged');
    // The new handler, unlike every stale handler, still works normally.
    answerRace(false);
    assert.equal(state.filledCount, 1);
    assert.equal(state.mistakes, 1);
    assert.equal(state.race.phase, 'waiting');
  }
}
HB.game.suspend();
assert.equal(timers.size, 0);
assert.equal(pendingRaceMove, null);
HB.game.start(215, 'free');
assert.equal(HB.game.state.race, null);
assert.equal(get('racePanel').hidden, true);
assert.equal(get('hintBtn').hidden, false);
assert.equal(get('trayGrid').children.length, 10, 'leaving race restores the original multiplication controls');
HB.game.suspend();
console.log('PASS race cancellation: 12 phases × replay/level change/account switch/suspend, actual timer/move cancellation, forced stale handlers during new dice/moves/questions, and restored non-race UI.');

// From here on, no builder fixture: all stages use their actual generated special squares and cards.
HB.levels.build = realRaceBuild;
const otherActor = actor => actor === 'player' ? 'ai' : 'player';
const raceSteps = (actor, correct) => isLocalRace() || actor === 'player' ? (correct ? 2 : -1) : (correct ? -2 : 3);
const clampRace = n => Math.max(1, Math.min(100, n));
function specialAt(cell) {
  const level = HB.game.state.level;
  return level.ladders.some(item => item.from === cell) || level.traps.includes(cell);
}
function safeRaceCell(predicate = () => true) {
  const cell = numbers.find(n => n >= 15 && n <= 85 &&
    [-2, -1, 0, 1, 2, 3].every(delta => !specialAt(n + delta)) && predicate(n));
  assert.ok(cell, 'a generated board must supply a safe control cell');
  return cell;
}
function predictedLanding(cell, random, shield = HB.game.state.race.shields[HB.game.state.race.turn]) {
  const level = HB.game.state.level, ladder = level.ladders.find(item => item.from === cell);
  if (ladder) return { destination: ladder.to, direct: true, draws: 0, shieldConsumed: false };
  const trap = level.traps.includes(cell);
  return { destination: trap && !shield ? clampRace(cell - 5 - Math.floor(random * 6)) : cell,
    direct: false, draws: Number(trap && !shield), shieldConsumed: trap && shield };
}
function resolveRealLanding(cell, action, random = 1 - Number.EPSILON) {
  const state = HB.game.state, r = state.race, actor = r.turn;
  const expected = predictedLanding(cell, random), question = r.question, count = state.filledCount;
  let last = withRaceRandom(random, () => action(expected.destination !== cell), expected.draws);
  if (expected.destination !== cell) {
    assert.equal(r.positions[actor], cell, 'special movement must await its own callback');
    assert.equal(r.phase, 'moving');
    assert.equal(r.question, question, 'no question at the original special-square landing');
    assert.equal(HB.board.target, null);
    assert.equal(state.filledCount, count);
    last = landRaceMove(expected.destination, { direct: expected.direct });
  }
  assert.equal(r.positions[actor], expected.destination);
  if (expected.shieldConsumed) assert.equal(r.shields[actor], false);
  return last;
}
function cardsWindow() {
  const state = HB.game.state, r = state.race, human = isHumanRaceActor(r.turn);
  const actor = isLocalRace() ? r.turn : 'player', other = otherActor(actor);
  assert.equal(state.level.cardsEnabled, true);
  assert.equal(r.phase, 'cards');
  assert.equal(state.busy, !human);
  assert.equal(state.done, false);
  assert.equal(r.question, null, 'cards precede both the special square and its final question');
  assert.equal(HB.board.target, null);
  assert.equal(get('raceAnswers').children.length, 0);
  assert.equal(pendingRaceMove, null);
  assert.equal(get('raceContinue').hidden, !human);
  assert.equal(get('raceContinue').disabled, !human);
  const buttons = get('raceHand').querySelectorAll('button[data-card]');
  assert.deepEqual(buttons.map(button => button.dataset.card), Array.from(r.cards[actor]));
  for (const button of buttons) {
    assert.equal(button.disabled, !human ||
      (button.dataset.card === 'immune' ? r.shields[actor] : r.sleeping[other]));
  }
  if (!human) raceJob(900);
  else assert.equal(timers.size, 0, 'either human may decide without an automatic continuation');
  raceUI();
  blockedRaceInput();
  return buttons;
}
function landRealDie(cell, dice = 1, random = 1 - Number.EPSILON) {
  const state = HB.game.state, r = state.race;
  assert.ok(cell - dice >= 1 && cell < 100);
  r.positions[r.turn] = cell - dice;
  startRaceMove(dice);
  if (state.level.cardsEnabled && r.cards[r.turn].length) {
    withRaceRandom(random, () => landRaceMove(cell), 0);
    cardsWindow();
  } else {
    resolveRealLanding(cell, followup => landRaceMove(cell, { followup }), random);
    if (!state.done) raceQuestion();
  }
}
function continueRealCards(random = 1 - Number.EPSILON) {
  cardsWindow();
  const r = HB.game.state.race;
  assert.equal(isHumanRaceActor(r.turn), true);
  const last = resolveRealLanding(r.positions[r.turn], () => get('raceContinue').click(), random);
  if (!HB.game.state.done) raceQuestion();
  return last;
}
function clickRealAnswer(correct, chance = .9) {
  const state = HB.game.state, r = state.race, actor = r.turn, buttons = raceQuestion();
  const eligible = state.level.cardsEnabled && (isLocalRace() ? correct : correct === (actor === 'player')) && r.cards[actor].length < 2;
  const card = eligible && chance < .3 ? (chance < .15 ? 'sleep' : 'immune') : null;
  const answer = { actor, correct, card, buttons, count: state.filledCount, mistakes: state.mistakes,
    turn: r.turnNumber, positions: { ...r.positions }, question: r.question, targets: raceTargets.length,
    destination: clampRace(r.positions[actor] + raceSteps(actor, correct)), moves: raceMoves.length };
  const hands = JSON.parse(JSON.stringify(r.cards)), profile = snapshot(), writes = saves;
  const button = buttons.find(item => (Number(item.dataset.value) === r.question.answer) === correct);
  withRaceRandom(chance, () => button.click(), Number(eligible));
  assert.equal(state.filledCount, answer.count + 1);
  assert.equal(state.mistakes, answer.mistakes + Number(!correct));
  assert.equal(snapshot(), profile);
  assert.equal(saves, writes);
  assert.equal(r.question, answer.question);
  assert.equal(r.turnNumber, answer.turn);
  assert.equal(r.turn, actor);
  assert.deepEqual({ ...r.positions }, answer.positions);
  if (card) hands[actor].push(card);
  assert.deepEqual(JSON.parse(JSON.stringify(r.cards)), hands);
  assert.ok(r.cards.player.length <= 2 && r.cards.ai.length <= 2);
  assert.equal(r.phase, card ? 'reward' : 'moving');
  assert.equal(state.busy, true);
  assert.equal(raceMoves.length, answer.moves + Number(!card));
  if (card) {
    assert.equal(pendingRaceMove, null);
    raceJob(900);
    assert.match(r.feedback, /替代本次移动/);
  }
  blockedRaceInput();
  raceUI();
  return answer;
}
function finishRealAnswer(answer, random = 1 - Number.EPSILON) {
  const state = HB.game.state, r = state.race;
  let last;
  if (answer.card) {
    withRaceRandom(random, () => fireRaceJob(900), 0);
    assert.deepEqual({ ...r.positions }, answer.positions, 'a card replaces every reward step, including special landings');
    assert.equal(raceMoves.length, answer.moves);
  } else last = resolveRealLanding(answer.destination,
    followup => landRaceMove(answer.destination, { followup }), random);
  assert.equal(state.filledCount, answer.count + 1, 'special reward/penalty moves cannot append questions');
  assert.equal(state.mistakes, answer.mistakes + Number(!answer.correct));
  assert.ok(raceTargets.slice(answer.targets).every(args => args[0] === null));
  assert.deepEqual(get('raceAnswers').children, answer.buttons);
  if (!state.done) {
    assert.equal(r.turn, otherActor(answer.actor));
    assert.equal(r.turnNumber, answer.turn + 1);
    assert.equal(r.question, null);
    assert.equal(r.phase, r.phase === 'sleeping' ? 'sleeping' : isHumanRaceActor(r.turn) ? 'roll' : 'waiting');
    assert.equal(state.busy, r.phase === 'sleeping');
    if (r.phase === 'sleeping') raceJob(900);
    else if (!isHumanRaceActor(r.turn)) raceJob(1200);
    else assert.equal(timers.size, 0);
  }
  raceUI();
  return last;
}
function realAnswer(correct, chance = .9, random = 1 - Number.EPSILON) {
  return finishRealAnswer(clickRealAnswer(correct, chance), random);
}
function prepareRealActor(actor) {
  const r = HB.game.state.race;
  if (r.turn !== actor) {
    landRealDie(safeRaceCell());
    realAnswer(isLocalRace() ? false : r.turn !== 'player'); // Unfavourable: never a card lottery.
  }
  assert.equal(r.turn, actor);
  assert.equal(r.phase, isHumanRaceActor(actor) ? 'roll' : 'waiting');
}
function usePlayerCard(card) {
  const button = get('raceHand').querySelectorAll('button[data-card]').find(item => item.dataset.card === card);
  assert.ok(button, 'player owns ' + card);
  assert.equal(button.disabled, false);
  withRaceRandom(0, () => button.click(), 0);
  return button;
}
function finishSleeping(actor) {
  const state = HB.game.state, r = state.race, positions = { ...r.positions };
  assert.equal(r.phase, 'sleeping');
  assert.equal(r.turn, actor);
  assert.equal(r.sleeping[actor], false, 'the pending sleep is consumed once on entering the skipped turn');
  assert.equal(state.busy, true);
  const count = state.filledCount, moves = raceMoves.length, turn = r.turnNumber;
  blockedRaceInput();
  withRaceRandom(0, () => fireRaceJob(900), 0);
  assert.equal(r.turn, otherActor(actor));
  assert.equal(r.turnNumber, turn + 1);
  assert.equal(r.phase, isHumanRaceActor(r.turn) ? 'roll' : 'waiting');
  assert.equal(state.busy, false);
  assert.equal(r.question, null);
  assert.equal(state.filledCount, count);
  assert.equal(raceMoves.length, moves);
  assert.deepEqual({ ...r.positions }, positions);
  if (!isHumanRaceActor(r.turn)) raceJob(1200);
  else assert.equal(timers.size, 0);
}

let realLadders = 0, realTraps = 0, realAdjustments = 0;
for (const id of [217, 218, 219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const motion of ['full', 'lite']) {
      for (const actor of ['player', 'ai']) {
        const run = startRace(id, mode, motion), state = HB.game.state, level = state.level;
        assert.equal(level.stage, id - 216);
        assert.equal(level.maxNumber, 20);
        assert.equal(level.cardsEnabled, id >= 219);
        assert.equal(level.ladders.length, id === 217 ? 3 : 5);
        assert.equal(level.traps.length, id === 217 ? 5 : 6);
        assert.ok(level.ladders.every(ladder => Number.isInteger(ladder.from) && ladder.from >= 2 &&
          Number.isInteger(ladder.to) && ladder.to > ladder.from && ladder.to < 100));
        assert.ok(level.traps.every(n => Number.isInteger(n) && n >= 2 && n < 100));
        assert.equal(new Set(level.traps).size, level.traps.length);
        assert.ok(Number.isInteger(level.seed));
        assert.equal(JSON.stringify(realRaceBuild(id, level.seed)), JSON.stringify(level), 'seed reproduces the actual board');
        for (const ladder of level.ladders) {
          prepareRealActor(actor);
          const count = state.filledCount, moves = raceMoves.length;
          landRealDie(ladder.from);
          assert.equal(state.race.positions[actor], ladder.to);
          assert.equal(raceMoves.length, moves + 2, 'one ordinary die step plus one ladder jump, not an animated ladder walk');
          assert.equal(state.filledCount, count);
          realLadders++;
          realAnswer(actor !== 'player');
          raceLedger(run);
          prepareRealActor(actor);
          landRealDie(ladder.to);
          assert.equal(state.race.positions[actor], ladder.to, 'landing on the upper endpoint never moves down the ladder');
          realAnswer(actor !== 'player');
        }
        for (const trap of level.traps) {
          for (const distance of [5, 6, 7, 8, 9, 10]) {
            prepareRealActor(actor);
            const random = distance === 10 ? 1 - Number.EPSILON : (distance - 5) / 6;
            landRealDie(trap, 1, random);
            assert.equal(state.race.positions[actor], Math.max(1, trap - distance));
            realTraps++;
            realAnswer(actor !== 'player');
            raceLedger(run);
          }
        }
        // A special square crossed by the die is inert; only its final destination matters.
        for (const cell of level.ladders.map(item => item.from).concat(Array.from(level.traps))) {
          if (cell < 98 && !specialAt(cell + 1)) {
            prepareRealActor(actor);
            landRealDie(cell + 1, 2);
            assert.equal(state.race.positions[actor], cell + 1);
            realAnswer(actor !== 'player');
          }
        }
        for (const correct of [false, true]) {
          for (const kind of ['ladder', 'trap']) {
            prepareRealActor(actor);
            const delta = raceSteps(actor, correct);
            const candidates = kind === 'ladder' ? level.ladders.map(item => item.from) : Array.from(level.traps);
            const destination = candidates.find(n => n - delta > 1 && n - delta < 100 && !specialAt(n - delta));
            assert.ok(destination, 'real special-square adjustment fixture: ' + id + '/' + actor + '/' + correct + '/' + kind);
            landRealDie(destination - delta);
            const answer = clickRealAnswer(correct, .9);
            assert.equal(answer.destination, destination);
            finishRealAnswer(answer, .5);
            realAdjustments++;
            raceLedger(run);
          }
        }
      }
    }
  }
}
assert.ok(realLadders >= 200 && realTraps >= 1000 && realAdjustments >= 192);
HB.game.suspend();
console.log('PASS real race boards: every generated ladder/trap in 217–220, both actors, all modes and both motion settings; trap distances 5–10, upper endpoints, pass-through and all four special reward/penalty landings.');

// Deliberately adversarial unit layouts supplement, never replace, generated-board coverage.
for (const mode of ['normal', 'free', 'random']) {
  for (const actor of ['player', 'ai']) {
    for (const motion of ['full', 'lite']) {
      for (const kind of ['ladder', 'trap', 'clamp']) {
        const run = startRace(218, mode, motion), state = HB.game.state;
        prepareRealActor(actor);
        state.level.ladders = [{ from: 10, to: 30 }, { from: 30, to: 50 }];
        state.level.traps = kind === 'ladder' ? [30] : kind === 'trap' ? [20, 10] : [2];
        const targets = raceTargets.length;
        landRealDie(kind === 'ladder' ? 10 : kind === 'trap' ? 20 : 2);
        const destination = kind === 'ladder' ? 30 : kind === 'trap' ? 10 : 1;
        assert.equal(state.race.positions[actor], destination, 'special destination does not chain into another ladder or trap');
        assert.equal(state.race.question, state.level.questions[destination]);
        assert.deepEqual(raceTargets.slice(targets).filter(args => args[0] !== null), [[destination]], 'exactly one final landing question');
        assert.equal(state.filledCount, actor === 'ai' ? 1 : 0);
        raceLedger(run);
      }
      for (const correct of [false, true]) {
        const run = startRace(218, mode, motion), state = HB.game.state;
        prepareRealActor(actor);
        state.level.ladders = [{ from: 20, to: 40 }, { from: 40, to: 60 }];
        state.level.traps = [40];
        landRealDie(20 - raceSteps(actor, correct));
        realAnswer(correct);
        assert.equal(state.race.positions[actor], 40, 'reward/penalty ladder destinations never chain or append a question');
        raceLedger(run);
      }
    }
  }
}
// A backwards penalty may cross a trap without triggering it.
{
  const run = startRace(218), state = HB.game.state;
  prepareRealActor('ai');
  const trap = state.level.traps.find(n => !specialAt(n - 1) && !specialAt(n + 1));
  assert.ok(trap);
  landRealDie(trap + 1);
  realAnswer(true);
  assert.equal(state.race.positions.ai, trap - 1);
  raceLedger(run);
}
// A ladder can end a game, including after an answer adjustment; no further question/turn is legal.
for (const mode of ['normal', 'free', 'random']) {
  for (const actor of ['player', 'ai']) {
    for (const source of ['die', 'reward']) {
      const run = startRace(218, mode), state = HB.game.state;
      prepareRealActor(actor);
      state.level.ladders = [{ from: 90, to: 100 }];
      state.level.traps = [];
      let last;
      if (source === 'die') {
        state.race.positions[actor] = 89;
        startRaceMove(1);
        last = resolveRealLanding(90, followup => landRaceMove(90, { followup }));
      } else {
        const correct = actor === 'player';
        landRealDie(90 - raceSteps(actor, correct));
        last = realAnswer(correct);
      }
      settleRace(run, actor, last, 'ladder-' + source);
    }
  }
}
console.log('PASS special edge cases: non-chaining ladder/trap collisions, clamp at 1, backwards pass-through and ladder wins from dice/rewards in every mode.');

for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const actor of ['player', 'ai']) {
      for (const count of [0, 1, 2]) {
        for (const chance of [0, .15 - Number.EPSILON, .15, .3 - Number.EPSILON, .3, 1 - Number.EPSILON]) {
          const run = startRace(id, mode), state = HB.game.state, r = state.race;
          prepareRealActor(actor);
          landRealDie(safeRaceCell());
          r.cards[actor] = ['immune', 'sleep'].slice(0, count);
          const answer = clickRealAnswer(actor === 'player', chance);
          const expectedCard = count < 2 && chance < .3 ? (chance < .15 ? 'sleep' : 'immune') : null;
          assert.equal(answer.card, expectedCard);
          assert.equal(r.cards[actor].length, count + Number(!!expectedCard));
          if (expectedCard) assert.equal(r.cards[actor].at(-1), expectedCard);
          finishRealAnswer(answer);
          raceLedger(run);
        }
        // Unfavourable answers never draw, irrespective of space remaining in the hand.
        const run = startRace(id, mode), r = HB.game.state.race;
        prepareRealActor(actor);
        landRealDie(safeRaceCell());
        r.cards[actor] = ['sleep', 'immune'].slice(0, count);
        const answer = clickRealAnswer(actor !== 'player', 0);
        assert.equal(answer.card, null);
        finishRealAnswer(answer);
        raceLedger(run);
      }
      // A card replaces the entire adjustment even when it would otherwise hit a special square or win.
      for (const kind of ['ladder', 'trap', 'finish']) {
        const run = startRace(id, mode), state = HB.game.state, r = state.race;
        prepareRealActor(actor);
        const correct = actor === 'player', delta = raceSteps(actor, correct);
        const cells = kind === 'ladder' ? state.level.ladders.map(item => item.from) : Array.from(state.level.traps);
        const cell = kind === 'finish' ? 99 : cells.map(n => n - delta).find(n => n > 1 && !specialAt(n));
        assert.ok(cell);
        landRealDie(cell);
        const answer = clickRealAnswer(correct, .15);
        assert.equal(answer.card, 'immune');
        finishRealAnswer(answer);
        assert.equal(r.positions[actor], cell);
        assert.equal(state.done, false);
        assert.equal(overlay, null);
        raceLedger(run);
      }
    }
  }
}
// Cards cannot activate merely because the opponent has one, or because an earlier stage's state is seeded.
for (const id of [216, 217, 218, 219, 220]) {
  const run = startRace(id, 'free'), r = HB.game.state.race;
  r.cards.ai = ['sleep'];
  if (id <= 218) r.cards.player = ['immune'];
  landRealDie(safeRaceCell());
  assert.equal(r.phase, 'question');
  assert.equal(get('raceCards').hidden, id <= 218);
  realAnswer(true, .9);
  raceLedger(run);
}
console.log('PASS card rewards: both actors, 219/220 and all modes; exact 15%/30% boundaries, one/zero RNG draws, hand cap 2, no unfavourable lotteries and replacement of special/terminal movement.');

function defenseWindow() {
  const state = HB.game.state, r = state.race;
  assert.equal(r.phase, 'defense');
  assert.equal(state.busy, false);
  assert.equal(state.done, false);
  assert.deepEqual({ ...r.defense }, { attacker: r.turn, defender: otherActor(r.turn) });
  assert.equal(isHumanRaceActor(r.defense.defender), true);
  assert.ok(r.cards[r.defense.defender].includes('immune'));
  assert.equal(r.question, null, 'sleep defense must precede landing and question creation');
  assert.equal(HB.board.target, null);
  assert.equal(pendingRaceMove, null);
  assert.equal(timers.size, 0, 'defense has no timeout, AI timer or automatic continuation');
  assert.equal(get('raceAnswers').children.length, 0);
  assert.equal(get('raceContinue').hidden, true);
  assert.match(get('raceQuestion').textContent, /等待免疫选择/);
  assert.ok(get('raceDefensePrompt').textContent.includes(raceActorName(r.defense.defender)));
  assert.deepEqual({ ...get('raceDefense').scrolls.at(-1) }, { block: 'nearest', behavior: 'instant' });
  const buttons = get('raceDefenseActions').querySelectorAll('button');
  assert.deepEqual(buttons.map(button => button.dataset.defense), ['immune', 'accept']);
  assert.ok(buttons.every(button => !button.disabled));
  assert.ok(get('raceHand').children.every(button => button.disabled), 'only the two response buttons are actionable');
  raceUI();
  blockedRaceInput();
  noRaceWork(() => { completeTimers(); completeTimers(); }, 'waiting cannot resolve a defense or a question');
  return buttons;
}
function respondRealDefense(choice, random = .5) {
  const buttons = defenseWindow(), state = HB.game.state, r = state.race;
  const defense = r.defense, actor = r.turn, at = r.positions[actor], positions = { ...r.positions };
  const hands = JSON.parse(JSON.stringify(r.cards)), shields = { ...r.shields };
  const count = state.filledCount, mistakes = state.mistakes, turn = r.turnNumber;
  const profile = snapshot(), writes = saves, moves = raceMoves.length;
  const button = buttons.find(item => item.dataset.defense === choice);
  assert.ok(button);
  let last;
  if (isHumanRaceActor(actor)) withRaceRandom(0, () => button.click(), 0);
  else last = resolveRealLanding(at, () => button.click(), random);
  if (choice === 'immune') hands[defense.defender].splice(hands[defense.defender].indexOf('immune'), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.cards)), hands, 'only accepting immunity consumes exactly one defensive card');
  assert.equal(r.sleeping[defense.defender], choice === 'accept');
  assert.equal(r.shields[defense.defender], shields[defense.defender], 'reactive immunity must not create a shield');
  assert.equal(r.defense, null);
  assert.equal(get('raceDefenseActions').children.length, 0);
  assert.equal(state.filledCount, count, 'a defense response never counts as an answer');
  assert.equal(state.mistakes, mistakes);
  assert.equal(r.turn, actor);
  assert.equal(r.turnNumber, turn);
  assert.equal(snapshot(), profile);
  assert.equal(saves, writes);
  if (isHumanRaceActor(actor)) {
    cardsWindow();
    assert.deepEqual({ ...r.positions }, positions);
    assert.equal(raceMoves.length, moves, 'human attacker must click continue even after the last card was used');
  } else raceQuestion();
  noRaceWork(() => buttons.forEach(item => { item.click(); forceClick(item); }), 'double/alternate response clicks must not consume twice or answer the resumed question');
  noRaceWork(completeTimers, 'response does not auto-continue a human or answer an AI landing question');
  return last;
}
function autoRealCards(random = 1 - Number.EPSILON, defenseChoice = 'immune') {
  cardsWindow();
  const state = HB.game.state, r = state.race;
  assert.equal(r.turn, 'ai');
  const at = r.positions.ai, hand = Array.from(r.cards.ai), playerHand = Array.from(r.cards.player);
  const immune = hand.includes('immune') && !r.shields.ai && (state.level.traps.includes(at) || playerHand.includes('sleep'));
  const sleep = hand.includes('sleep') && !r.sleeping.player;
  const shield = r.shields.ai || immune, playerShield = r.shields.player;
  const sleeping = r.sleeping.player || (sleep && !playerShield);
  if (immune) hand.splice(hand.indexOf('immune'), 1);
  if (sleep) hand.splice(hand.indexOf('sleep'), 1);
  const expected = predictedLanding(at, random, shield), beforeMoves = raceMoves.length;
  const needsDefense = sleep && !playerShield && playerHand.includes('immune');
  withRaceRandom(random, () => fireRaceJob(900), needsDefense ? 0 : expected.draws);
  if (needsDefense) {
    assert.deepEqual(Array.from(r.cards.ai), hand);
    assert.deepEqual(Array.from(r.cards.player), playerHand, 'hand immunity awaits an explicit human response');
    assert.equal(r.shields.ai, shield);
    assert.equal(r.sleeping.player, false);
    assert.equal(raceMoves.length, beforeMoves, 'AI trap/ladder is deferred throughout defense');
    return respondRealDefense(defenseChoice, random);
  }
  assert.deepEqual(Array.from(r.cards.ai), hand);
  assert.deepEqual(Array.from(r.cards.player), playerHand);
  assert.equal(r.sleeping.player, sleeping);
  assert.equal(r.shields.player, playerShield && !sleep);
  assert.equal(r.shields.ai, shield && !expected.shieldConsumed);
  if (expected.destination !== at) {
    assert.equal(r.positions.ai, at);
    assert.equal(r.phase, 'moving');
    landRaceMove(expected.destination, { direct: expected.direct });
  } else assert.equal(raceMoves.length, beforeMoves);
  assert.equal(r.positions.ai, expected.destination);
  raceQuestion();
  noRaceWork(completeTimers, 'AI card selection must still wait for the human to answer');
}
for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    // Declining cards still resolves the trap and asks only its final question.
    {
      const run = startRace(id, mode), state = HB.game.state, r = state.race;
      r.cards.player = ['sleep', 'immune'];
      const trap = state.level.traps[0], hand = Array.from(r.cards.player);
      landRealDie(trap);
      assert.equal(r.positions.player, trap, 'trap waits for the player card decision');
      continueRealCards(0);
      assert.equal(r.positions.player, Math.max(1, trap - 5));
      assert.deepEqual(Array.from(r.cards.player), hand);
      realAnswer(false);
      raceLedger(run);
    }
    // Use both different effects, in either order, in the same window before the trap.
    for (const order of [['immune', 'sleep'], ['sleep', 'immune']]) {
      const run = startRace(id, mode), state = HB.game.state, r = state.race;
      r.cards.player = ['sleep', 'immune'];
      const trap = state.level.traps[0];
      landRealDie(trap);
      for (const card of order) usePlayerCard(card);
      assert.equal(r.cards.player.length, 0);
      assert.equal(r.shields.player, true);
      assert.equal(r.sleeping.ai, true);
      assert.equal(get('racePiece-player').classList.contains('race-shielded'), true);
      assert.equal(get('racePiece-ai').classList.contains('race-sleeping'), true);
      assert.equal(r.phase, 'cards', 'using the last card must not auto-continue');
      continueRealCards();
      assert.equal(r.positions.player, trap);
      assert.equal(r.shields.player, false, 'the trap consumes the protection, not the sleep');
      realAnswer(false);
      finishSleeping('ai');
      assert.equal(r.cards.player.length, 0);
      landRealDie(safeRaceCell());
      realAnswer(false);
      assert.equal(r.phase, 'waiting', 'sleep cannot skip two opponent turns');
      raceLedger(run);
    }
    // Repeated activation must keep the duplicate card and must not stack its effect.
    for (const card of ['immune', 'sleep']) {
      const run = startRace(id, mode), r = HB.game.state.race;
      r.cards.player = [card, card];
      landRealDie(safeRaceCell());
      usePlayerCard(card);
      assert.deepEqual(Array.from(r.cards.player), [card]);
      const duplicate = get('raceHand').children[0];
      assert.equal(duplicate.disabled, true);
      noRaceWork(() => { duplicate.click(); forceClick(duplicate); }, 'duplicate active effects neither consume nor stack');
      continueRealCards();
      realAnswer(false);
      if (card === 'sleep') finishSleeping('ai');
      raceLedger(run);
    }
    // Protection survives ordinary landings and a complete opponent turn, then absorbs exactly one trap.
    {
      const run = startRace(id, mode), state = HB.game.state, r = state.race;
      r.cards.player = ['immune'];
      landRealDie(safeRaceCell());
      usePlayerCard('immune');
      continueRealCards();
      realAnswer(false);
      prepareRealActor('player');
      assert.equal(r.shields.player, true);
      const trap = state.level.traps[0];
      landRealDie(trap);
      assert.equal(r.positions.player, trap);
      assert.equal(r.shields.player, false);
      realAnswer(false);
      prepareRealActor('player');
      landRealDie(trap, 1, 0);
      assert.equal(r.positions.player, Math.max(1, trap - 5));
      raceLedger(run);
    }
    // The player's sleep consumes the AI's shield instead of scheduling a skipped turn.
    {
      const run = startRace(id, mode), r = HB.game.state.race;
      r.cards.player = ['sleep'];
      r.shields.ai = true;
      landRealDie(safeRaceCell());
      usePlayerCard('sleep');
      assert.equal(r.shields.ai, false);
      assert.equal(r.sleeping.ai, false);
      continueRealCards();
      realAnswer(false);
      assert.equal(r.phase, 'waiting');
      raceLedger(run);
    }
    for (const scenario of [
      { name: 'keep-unneeded-immune', hand: ['immune'], left: ['immune'] },
      { name: 'trap-immune-then-sleep', hand: ['sleep', 'immune'], trap: true, left: [], sleeps: true },
      { name: 'threat-immune-then-sleep', hand: ['sleep', 'immune'], threat: true, left: [], shield: true, sleeps: true },
      { name: 'existing-shield-keeps-card', hand: ['immune', 'sleep'], trap: true, shield: true, left: ['immune'], sleeps: true },
      { name: 'sleep-only-does-not-stop-trap', hand: ['sleep'], trap: true, left: [], sleeps: true },
      { name: 'immune-survives-no-trap', hand: ['immune'], shield: true, left: ['immune'] },
      { name: 'already-sleeping-keeps-card', hand: ['sleep'], alreadySleeping: true, left: ['sleep'], sleeps: true },
      { name: 'opponent-shield-blocks-sleep', hand: ['sleep'], opponentShield: true, left: [] },
      { name: 'ladder-after-cards', hand: ['immune'], ladder: true, left: ['immune'] }
    ]) {
      const run = startRace(id, mode), state = HB.game.state, r = state.race;
      prepareRealActor('ai');
      r.cards.ai = scenario.hand.slice();
      r.cards.player = scenario.threat ? ['sleep'] : [];
      // Only scenarios describing an already-active shield start protected.
      r.shields.ai = ['existing-shield-keeps-card', 'immune-survives-no-trap'].includes(scenario.name);
      r.shields.player = !!scenario.opponentShield;
      r.sleeping.player = !!scenario.alreadySleeping;
      const cell = scenario.trap ? state.level.traps[0] : scenario.ladder ? state.level.ladders[0].from : safeRaceCell();
      landRealDie(cell);
      assert.equal(r.positions.ai, cell);
      autoRealCards(0);
      assert.deepEqual(Array.from(r.cards.ai), scenario.left, scenario.name);
      assert.equal(r.sleeping.player, !!scenario.sleeps, scenario.name);
      assert.equal(r.shields.ai, scenario.name === 'threat-immune-then-sleep' || scenario.name === 'immune-survives-no-trap');
      realAnswer(true);
      if (scenario.sleeps) finishSleeping('player');
      else assert.equal(r.phase, 'roll');
      raceLedger(run);
    }
    // Two separate AI sleep uses: first breaks protection, second actually skips the player once.
    {
      const run = startRace(id, mode), r = HB.game.state.race;
      prepareRealActor('ai');
      r.cards.ai = ['sleep', 'sleep'];
      r.shields.player = true;
      landRealDie(safeRaceCell());
      autoRealCards();
      assert.equal(r.shields.player, false);
      assert.equal(r.sleeping.player, false);
      assert.deepEqual(Array.from(r.cards.ai), ['sleep']);
      realAnswer(true);
      prepareRealActor('ai');
      landRealDie(safeRaceCell());
      autoRealCards();
      assert.equal(r.sleeping.player, true);
      assert.equal(r.cards.ai.length, 0);
      realAnswer(true);
      finishSleeping('player');
      raceLedger(run);
    }
  }
}
HB.game.suspend();
console.log('PASS card play: use/decline, both effects in either order, non-stacking duplicates, persistent one-use trap/sleep immunity, 900ms skipped turns and all AI auto-card policies in every mode.');

// Real generated games with earned (not seeded) hands. Never patch positions, turns, cards or questions.
let naturalCardAwards = 0, naturalCardWindows = 0, naturalSleeps = 0;
for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const preferredWinner of ['player', 'ai']) {
      const run = startRace(id, mode), state = HB.game.state;
      const naturalBefore = [naturalCardAwards, naturalCardWindows, naturalSleeps];
      let turns = 0, last;
      while (!state.done) {
        const r = state.race, actor = r.turn;
        if (r.phase === 'sleeping') {
          finishSleeping(actor);
          naturalSleeps++;
          continue;
        }
        const dice = actor === preferredWinner ? 6 : 1;
        const destination = clampRace(r.positions[actor] + dice);
        startRaceMove(dice);
        if (destination === 100) last = landRaceMove(100);
        else {
          if (r.cards[actor].length) {
            withRaceRandom(0, () => landRaceMove(destination), 0);
            cardsWindow();
            naturalCardWindows++;
            if (actor === 'player') {
              for (const card of ['immune', 'sleep']) {
                const button = get('raceHand').children.find(item => item.dataset.card === card && !item.disabled);
                if (button) usePlayerCard(card);
              }
              last = continueRealCards(.5);
            } else autoRealCards(.5);
          } else last = resolveRealLanding(destination, followup => landRaceMove(destination, { followup }), .5);
          if (!state.done) {
            const answer = clickRealAnswer(preferredWinner === 'player', [0, .15, .9, .9][Math.floor(turns / 2) % 4]);
            naturalCardAwards += Number(!!answer.card);
            last = finishRealAnswer(answer, .5);
          }
        }
        raceLedger(run);
        if (++turns > 160) throw new Error('generated card race failed to terminate: ' + id + '/' + preferredWinner);
      }
      assert.equal(state.race.winner, preferredWinner);
      assert.ok(state.filledCount > 10);
      assert.ok([naturalCardAwards, naturalCardWindows, naturalSleeps].every((count, i) => count > naturalBefore[i]),
        'each complete game must actually earn/use cards and skip a sleeping turn');
      settleRace(run, preferredWinner, last, 'natural-cards-' + preferredWinner);
    }
  }
}
assert.ok(naturalCardAwards >= 12 && naturalCardWindows >= 12 && naturalSleeps >= 12);
console.log('PASS natural card races: 219/220 player/AI wins in all modes, earned hands, real special squares, card windows and sleeping turns; no patched gameplay state.');

const specialCancellationPhases = ['cards', 'card-reward', 'sleeping', 'ladder', 'trap', 'ladder-adjustment', 'trap-adjustment'];
for (const id of [219, 220]) {
  for (const actor of ['player', 'ai']) {
    for (const phase of specialCancellationPhases) {
      for (const action of ['replay', 'level-change', 'mode-change', 'account-switch', 'suspend']) {
        startRace(id);
        const state = HB.game.state, oldRace = state.race;
        prepareRealActor(actor);
        if (phase === 'cards' || phase === 'sleeping') {
          oldRace.cards[actor] = phase === 'cards' ? ['sleep', 'immune'] : ['sleep'];
          landRealDie(safeRaceCell());
          if (phase === 'sleeping') {
            if (actor === 'player') { usePlayerCard('sleep'); continueRealCards(); }
            else autoRealCards();
            realAnswer(actor !== 'player');
            assert.equal(oldRace.phase, 'sleeping');
            assert.equal(oldRace.turn, otherActor(actor));
          }
        } else if (phase === 'card-reward') {
          landRealDie(safeRaceCell());
          clickRealAnswer(actor === 'player', .15);
          assert.equal(oldRace.phase, 'reward');
        } else {
          const trap = phase.startsWith('trap'), adjustment = phase.endsWith('adjustment');
          const candidates = trap ? Array.from(state.level.traps) : state.level.ladders.map(item => item.from);
          const correct = actor === 'player', delta = raceSteps(actor, correct);
          const cell = candidates.find(n => n > 5 && (!adjustment || (n - delta > 1 && !specialAt(n - delta))));
          assert.ok(cell);
          if (adjustment) {
            landRealDie(cell - delta);
            clickRealAnswer(correct, .9);
          } else {
            oldRace.positions[actor] = cell - 1;
            startRaceMove(1);
          }
          withRaceRandom(.5, () => landRaceMove(cell, { followup: true }), Number(trap));
          assert.equal(oldRace.phase, 'moving');
          assert.ok(pendingRaceMove);
          assert.equal(pendingRaceMove.duration, trap ? 260 : 560);
        }
        const oldTimers = [...timers.entries()], oldMove = pendingRaceMove;
        const oldAnswers = [...new Set([...lastRaceButtons, ...get('raceAnswers').children])];
        const oldCards = get('raceHand').children.slice();
        const cancellations = raceMoveCancellations, oldProfile = HB.store.data, profile = snapshot();
        const stale = () => {
          const previous = JSON.stringify(oldRace);
          oldTimers.forEach(([, callback]) => { callback(); callback(); });
          if (oldMove) { oldMove.callback(); oldMove.callback(); }
          oldAnswers.concat(oldCards).forEach(button => { button.click(); forceClick(button); });
          assert.equal(JSON.stringify(oldRace), previous, 'cancelled special/card work must not mutate even the detached race');
        };
        const destination = action === 'level-change' || action === 'account-switch' ? (id === 219 ? 220 : 219) : id;
        const mode = action === 'level-change' || action === 'mode-change' ? 'free' : 'normal';
        if (action === 'replay') withRaceRandom(.625, () => get('replayBtn').click());
        else if (action === 'level-change') withRaceRandom(.625, () => HB.game.start(destination, mode));
        else if (action === 'mode-change') withRaceRandom(.625, () => HB.game.setMode('free'));
        else {
          HB.game.suspend();
          noRaceWork(stale, phase + '/' + action + ': inert while suspended');
          if (action === 'account-switch') {
            HB.store.data = raceProfile(destination, 'lite');
            noRaceWork(stale, 'old special/card work cannot change the newly loaded account');
          }
          withRaceRandom(.625, () => HB.game.start(destination, mode));
        }
        freshRace(destination, mode);
        assert.notEqual(state.race, oldRace);
        assert.equal(raceMoveCancellations, cancellations + Number(!!oldMove));
        if (oldMove) assert.equal(oldMove.cancelled, true);
        oldTimers.forEach(([timer]) => assert.equal(timers.has(timer), false));
        noRaceWork(stale, phase + '/' + action + ': stale callbacks after restart');
        const r = state.race;
        const matching = safeRaceCell(cell => oldAnswers.some(button =>
          state.level.questions[cell].choices.includes(Number(button.dataset.value))));
        r.positions.player = matching - 1;
        r.cards.player = ['sleep', 'immune']; // A valid NEW hand, so a phase-only guard cannot hide a missing runId guard.
        beginRaceRoll(1);
        noRaceWork(stale, 'stale special/card work must not replace a new die timer');
        finishRaceDie(1);
        noRaceWork(stale, 'stale special/card work must not cancel a new move');
        withRaceRandom(0, () => landRaceMove(matching), 0);
        cardsWindow();
        assert.equal(get('raceHand').children.length, 2);
        noRaceWork(stale, 'old hand buttons cannot use valid cards in the NEW cards phase');
        continueRealCards();
        assert.ok(oldAnswers.some(button => r.question.choices.includes(Number(button.dataset.value))));
        noRaceWork(stale, 'old answer buttons cannot answer overlapping values in the NEW question');
        noRaceWork(completeTimers, 'no cancelled reward/sleep/card timer may advance the new question');
        if (action === 'account-switch') assert.equal(JSON.stringify(oldProfile), profile);
        realAnswer(false);
        assert.equal(state.filledCount, 1, 'the new answer handler still works');
        assert.equal(state.mistakes, 1);
        assert.equal(r.phase, 'waiting');
        HB.game.start(215, 'free');
        assert.equal(state.race, null);
        noRaceWork(stale, 'old hand closures must remain safe after leaving race entirely');
        assert.equal(get('racePanel').hidden, true);
        assert.equal(get('hintBtn').hidden, false);
        assert.equal(get('trayGrid').children.length, 10);
      }
    }
  }
}
HB.game.suspend();
console.log('PASS new phase cancellation: both actors in 219/220, cards/reward/sleep/ladder/trap and special adjustments × replay/level/mode/account/suspend; forced stale callbacks and buttons during new valid phases.');

for (const id of [216, 217, 218, 219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    startRace(id, mode);
    for (let replay = 0; replay < 3; replay++) {
      const state = HB.game.state, oldRace = state.race, level = state.level;
      // Make every new per-side field observably non-default before resetting it.
      oldRace.cards.player = ['sleep', 'immune'];
      oldRace.cards.ai = ['immune'];
      oldRace.shields.player = oldRace.shields.ai = true;
      oldRace.sleeping.player = oldRace.sleeping.ai = true;
      oldRace.event = 'previous-run-event';
      const profile = snapshot(), writes = saves, scores = scoreCalls.length, records = recordCalls.length;
      withRaceRandom(level.seed / 4294967296, () => get('replayBtn').click());
      freshRace(id, mode);
      assert.equal(state.level.seed, (level.seed + 1) >>> 0, 'a repeated draw increments the actual previous seed');
      assert.notEqual(JSON.stringify(state.level.questions), JSON.stringify(level.questions));
      assert.notEqual(state.race.cards, oldRace.cards);
      assert.notEqual(state.race.shields, oldRace.shields);
      assert.notEqual(state.race.sleeping, oldRace.sleeping);
      assert.equal(snapshot(), profile, 'replay cannot erase profile progress or write per-race card fields into the account');
      assert.equal(saves, writes + Number(mode === 'normal'));
      assert.equal(scoreCalls.length, scores);
      assert.equal(recordCalls.length, records);
    }
  }
}
// Unsigned increment also handles the maximum 32-bit seed, without generating the same questions.
withRaceRandom(1 - Number.EPSILON, () => HB.game.start(220, 'free'));
assert.equal(HB.game.state.level.seed, 0xffffffff);
const maximumSeedQuestions = JSON.stringify(HB.game.state.level.questions);
withRaceRandom(1 - Number.EPSILON, () => get('replayBtn').click());
freshRace(220, 'free');
assert.equal(HB.game.state.level.seed, 0);
assert.notEqual(JSON.stringify(HB.game.state.level.questions), maximumSeedQuestions);
HB.game.suspend();
assert.equal(timers.size, 0);
assert.equal(pendingRaceMove, null);
console.log('PASS race replay: repeated seed draws increment (including uint32 wrap), regenerated questions, fresh independent cards/shields/sleeping and all-mode profile isolation.');

// New boundary fixtures only: hands/positions are seeded here, never in the natural games below.
function openSleepDefense(actor, cell = safeRaceCell(), attackerHand = ['sleep'], defenderHand = ['immune', 'immune']) {
  const r = HB.game.state.race;
  prepareRealActor(actor);
  r.cards[actor] = attackerHand.slice();
  r.cards[otherActor(actor)] = defenderHand.slice();
  landRealDie(cell);
  const position = r.positions[actor], moves = raceMoves.length;
  if (isHumanRaceActor(actor)) usePlayerCard('sleep');
  else withRaceRandom(0, () => fireRaceJob(900), 0);
  assert.equal(r.positions[actor], position);
  assert.equal(raceMoves.length, moves);
  return defenseWindow();
}

let defenseCases = 0;
for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const raceMode of ['ai', 'local']) {
      for (const actor of raceMode === 'local' ? ['player', 'ai'] : ['ai']) {
        for (const choice of ['immune', 'accept']) {
          for (const landing of ['plain', 'ladder', 'trap']) {
            const run = startRace(id, mode, choice === 'immune' ? 'full' : 'lite', raceMode);
            const state = HB.game.state, r = state.race;
            const cell = landing === 'ladder' ? state.level.ladders[0].from : landing === 'trap' ? state.level.traps[0] : safeRaceCell();
            const expected = predictedLanding(cell, .5, false);
            const buttons = openSleepDefense(actor, cell), targets = raceTargets.length;
            const defender = otherActor(actor);
            assert.equal(r.cards[actor].length, 0, 'the attacking sleep is consumed before any response');
            assert.equal(r.cards[defender].length, 2, 'opening a window must not silently consume immunity');
            assert.equal(r.sleeping[defender], false);
            respondRealDefense(choice, .5);
            if (isHumanRaceActor(actor)) {
              assert.equal(r.positions[actor], cell, 'both human attackers keep their original landing until continue');
              continueRealCards(.5);
            }
            assert.equal(r.positions[actor], expected.destination, landing + ' resumes after defense exactly once');
            assert.equal(r.question, state.level.questions[expected.destination]);
            assert.deepEqual(raceTargets.slice(targets).filter(args => args[0] !== null), [[expected.destination]]);
            assert.equal(r.cards[defender].length, choice === 'immune' ? 1 : 2);
            assert.equal(r.shields[defender], false);
            noRaceWork(() => buttons.forEach(forceClick), 'responses remain inert during the actual landing question');
            realAnswer(true, .9, .5);
            if (choice === 'accept') finishSleeping(defender);
            else assert.equal(r.turn, defender, 'immune defender receives a normal turn');
            raceLedger(run);
            defenseCases++;
          }
        }
      }
    }
  }
}
assert.equal(defenseCases, 108);
console.log('PASS sleep defense: 108 cases across 219/220, all learning modes, AI/human attackers, both human defenders and both choices; real ladders/traps resume once, no timeout/automatic answer, exact hand consumption and skipped turns.');

for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const raceMode of ['ai', 'local']) {
      for (const actor of ['player', 'ai']) {
        for (const protection of ['shield-and-hand', 'no-immunity', 'ai-hand']) {
          if (protection === 'ai-hand' && (raceMode !== 'ai' || actor !== 'player')) continue;
          const run = startRace(id, mode, 'full', raceMode), r = HB.game.state.race;
          prepareRealActor(actor);
          const defender = otherActor(actor);
          r.cards[actor] = ['sleep'];
          r.cards[defender] = protection === 'no-immunity' ? [] : ['immune', 'immune'];
          r.shields[defender] = protection === 'shield-and-hand';
          landRealDie(safeRaceCell());
          if (isHumanRaceActor(actor)) usePlayerCard('sleep');
          else autoRealCards();
          assert.equal(r.defense, null);
          assert.equal(get('raceDefenseActions').children.length, 0);
          assert.equal(r.cards[actor].length, 0);
          assert.equal(r.cards[defender].length, protection === 'shield-and-hand' ? 2 : protection === 'ai-hand' ? 1 : 0);
          assert.equal(r.shields[defender], false, 'preactivated shield is used before touching hand immunity');
          assert.equal(r.sleeping[defender], protection === 'no-immunity');
          if (isHumanRaceActor(actor)) continueRealCards();
          realAnswer(true, .9);
          if (protection === 'no-immunity') finishSleeping(defender);
          raceLedger(run);
        }
      }
    }
    // Same run, same actors and phase, different defense object: runId alone is insufficient.
    for (const actor of ['player', 'ai']) {
      const run = startRace(id, mode, 'full', 'local'), r = HB.game.state.race;
      const oldButtons = openSleepDefense(actor, safeRaceCell(), ['sleep', 'sleep']);
      const first = r.defense;
      respondRealDefense('immune');
      usePlayerCard('sleep');
      const current = defenseWindow();
      assert.notEqual(r.defense, first);
      assert.deepEqual({ ...r.defense }, { ...first });
      noRaceWork(() => oldButtons.forEach(button => { button.click(); forceClick(button); }), 'previous defense buttons cannot respond to a later attack in the same run');
      assert.ok(current.every(button => !oldButtons.includes(button)));
      respondRealDefense('accept');
      assert.deepEqual(Array.from(r.cards[otherActor(actor)]), ['immune']);
      continueRealCards();
      realAnswer(false);
      finishSleeping(otherActor(actor));
      raceLedger(run);
    }
  }
}
console.log('PASS sleep priority: existing shield before hand, AI automatically consumes one hand immunity without creating shield, unprotected sleep on either side, duplicate clicks and same-run defense-object identity.');

let defenseCancellations = 0;
for (const id of [219, 220]) {
  for (const raceMode of ['ai', 'local']) {
    for (const actor of raceMode === 'local' ? ['player', 'ai'] : ['ai']) {
      for (const action of ['replay', 'level-change', 'leave-race', 'mode-change', 'account-switch', 'race-type', 'suspend']) {
        startRace(id, 'normal', 'full', raceMode);
        const state = HB.game.state, oldRace = state.race;
        const oldButtons = openSleepDefense(actor, state.level.traps[0]);
        const oldHand = get('raceHand').children.slice(), oldAnswers = lastRaceButtons.slice();
        const oldTimers = [...timers.values()], oldProfile = HB.store.data, profile = snapshot();
        const oldValue = JSON.stringify(oldRace);
        const stale = () => {
          oldButtons.concat(oldHand, oldAnswers).forEach(button => { button.click(); forceClick(button); });
          oldTimers.forEach(callback => callback());
          assert.equal(JSON.stringify(oldRace), oldValue, 'old defense state must remain untouched after cancellation');
        };
        let destination = id, mode = 'normal', nextType = raceMode;
        if (action === 'replay') withRaceRandom(.625, () => get('replayBtn').click());
        else if (action === 'level-change') {
          destination = id === 219 ? 220 : 219;
          mode = 'free';
          withRaceRandom(.625, () => HB.game.start(destination, mode));
        } else if (action === 'leave-race') {
          HB.game.start(215, 'free');
          assert.equal(state.race, null);
          assert.equal(get('raceDefense').hidden, true);
          assert.equal(get('raceDefenseActions').children.length, 0);
          noRaceWork(stale, 'old defense buttons are safe with S.race=null');
          withRaceRandom(.625, () => HB.game.start(id, mode));
        } else if (action === 'mode-change') {
          mode = 'free';
          withRaceRandom(.625, () => HB.game.setMode(mode));
        } else if (action === 'race-type') {
          nextType = raceMode === 'ai' ? 'local' : 'ai';
          withRaceRandom(.625, () => get(nextType === 'local' ? 'raceLocalMode' : 'raceAiMode').click());
        } else {
          HB.game.suspend();
          noRaceWork(stale, 'paused defense responses cannot act even if force-clicked');
          if (action === 'account-switch') {
            HB.store.data = raceProfile(id, 'lite');
            noRaceWork(stale, 'old defense cannot mutate a newly loaded account');
          }
          withRaceRandom(.625, () => HB.game.start(id, mode));
        }
        freshRace(destination, mode);
        assert.equal(state.raceMode, nextType);
        assert.notEqual(state.race, oldRace);
        noRaceWork(stale, 'runId rejects detached defense controls after restart');
        // A genuine NEW defense with live immunity, not an empty hand that hides stale-handler bugs.
        const newActor = nextType === 'ai' ? 'ai' : actor;
        openSleepDefense(newActor);
        noRaceWork(stale, 'old defense choices must not consume a valid new defender hand');
        respondRealDefense('immune');
        if (isHumanRaceActor(newActor)) continueRealCards();
        noRaceWork(stale, 'old responses cannot answer the resumed new question');
        realAnswer(true, .9);
        if (action === 'account-switch') assert.equal(JSON.stringify(oldProfile), profile);
        defenseCancellations++;
      }
    }
  }
}
assert.equal(defenseCancellations, 42);
console.log('PASS defense cancellation: 42 replay/level/leave-race/learning-mode/account/race-type/pause cases; old controls stay inert while suspended, in a new defense with live cards, and in its question.');

// Mode buttons restart immediately, keep the learning mode, and only AI normal starts may save.
for (const id of [216, 217, 218, 219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    startRace(id, mode);
    landRealDie(safeRaceCell());
    for (const nextType of ['local', 'ai']) {
      const state = HB.game.state, oldRace = state.race, oldSeed = state.level.seed;
      const oldAnswers = get('raceAnswers').children.slice(), profile = snapshot(), writes = saves;
      const scores = scoreCalls.length, records = recordCalls.length;
      withRaceRandom(oldSeed / 4294967296, () => get(nextType === 'local' ? 'raceLocalMode' : 'raceAiMode').click());
      freshRace(id, mode);
      assert.equal(state.raceMode, nextType);
      assert.notEqual(state.race, oldRace);
      assert.notEqual(state.level.seed, oldSeed);
      assert.equal(snapshot(), profile);
      assert.equal(saves, writes + Number(nextType === 'ai' && mode === 'normal'));
      assert.equal(scoreCalls.length, scores);
      assert.equal(recordCalls.length, records);
      noRaceWork(() => oldAnswers.forEach(forceClick), 'switching race type invalidates existing answer closures');
      noRaceWork(() => get(nextType === 'local' ? 'raceLocalMode' : 'raceAiMode').click(), 'clicking the already-selected type does not restart');
      landRealDie(safeRaceCell());
    }
  }
}

let localLotteries = 0;
for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const actor of ['player', 'ai']) {
      for (const count of [0, 1, 2]) {
        for (const chance of [0, .15 - Number.EPSILON, .15, .3 - Number.EPSILON, .3, 1 - Number.EPSILON]) {
          const run = startRace(id, mode, 'full', 'local'), r = HB.game.state.race;
          prepareRealActor(actor);
          landRealDie(safeRaceCell());
          r.cards[actor] = ['immune', 'sleep'].slice(0, count); // Lottery boundary fixture, after the roll.
          const answer = clickRealAnswer(true, chance);
          assert.equal(answer.card, count < 2 && chance < .3 ? (chance < .15 ? 'sleep' : 'immune') : null);
          assert.equal(answer.destination, answer.positions[actor] + 2, 'both local actors earn +2, never AI +3/-2');
          finishRealAnswer(answer);
          assert.equal(r.cards[actor].length, count + Number(!!answer.card));
          raceLedger(run);
          localLotteries++;
        }
        const run = startRace(id, mode, 'lite', 'local'), r = HB.game.state.race;
        prepareRealActor(actor);
        landRealDie(safeRaceCell());
        r.cards[actor] = ['immune', 'sleep'].slice(0, count);
        const answer = clickRealAnswer(false, 0);
        assert.equal(answer.card, null, 'even random=0 cannot reward a local wrong answer');
        assert.equal(answer.destination, answer.positions[actor] - 1);
        finishRealAnswer(answer);
        raceLedger(run);
      }
      for (const kind of ['ladder', 'trap', 'finish']) {
        const run = startRace(id, mode, 'full', 'local'), state = HB.game.state, r = state.race;
        prepareRealActor(actor);
        const candidates = kind === 'ladder' ? state.level.ladders.map(item => item.from) : Array.from(state.level.traps);
        const cell = kind === 'finish' ? 99 : candidates.map(n => n - 2).find(n => n > 1 && !specialAt(n));
        assert.ok(cell);
        landRealDie(cell);
        realAnswer(true, .15);
        assert.equal(r.positions[actor], cell, 'local award replaces special/terminal movement entirely');
        assert.equal(state.done, false);
        assert.equal(overlay, null);
        raceLedger(run);
      }
    }
  }
}
assert.equal(localLotteries, 216);
console.log('PASS local mode/rewards: immediate bidirectional restart on 216–220 in all modes; 216 lottery boundaries, both actors +2/-1, correct-only 30%, cap two per hand and replacement of special/terminal moves; no account writes.');

for (const id of [219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const actor of ['player', 'ai']) {
      for (const order of [['immune', 'sleep'], ['sleep', 'immune']]) {
        const run = startRace(id, mode, 'lite', 'local'), state = HB.game.state, r = state.race;
        prepareRealActor(actor);
        r.cards[actor] = ['sleep', 'immune'];
        const trap = state.level.traps[0];
        landRealDie(trap);
        const oldHand = get('raceHand').children.slice();
        usePlayerCard(order[0]);
        noRaceWork(() => oldHand.forEach(forceClick), 'rerendered local hand rejects obsolete card indices');
        usePlayerCard(order[1]);
        assert.equal(r.cards[actor].length, 0);
        assert.equal(r.shields[actor], true);
        assert.equal(r.sleeping[otherActor(actor)], true);
        assert.equal(r.phase, 'cards', 'using the last card never continues either local player');
        assert.equal(get('racePiece-' + actor).classList.contains('race-shielded'), true);
        noRaceWork(completeTimers, 'both local attackers must manually continue after using all cards');
        continueRealCards();
        assert.equal(r.positions[actor], trap, 'proactive immunity protects either human from the real trap');
        assert.equal(r.shields[actor], false);
        assert.equal(r.question, state.level.questions[trap]);
        realAnswer(false);
        finishSleeping(otherActor(actor));
        assert.equal(r.turn, actor);
        assert.equal(r.phase, 'roll');
        assert.equal(timers.size, 0);
        raceLedger(run);
      }
    }
  }
}
console.log('PASS local card controls: both actors use sleep/immune in either order, old hand indices cannot be reused, proactive shields absorb real traps once, and neither cards nor restored sleeping turns schedule an AI action.');

// Natural local games: the only inputs are public buttons, die/lottery RNG and real animation callbacks.
// Do not use landRealDie/openSleepDefense or assign positions/cards/turn/question in this loop.
let naturalLocalGames = 0;
const localNaturalTotals = { awards: 0, defenses: 0, sleeps: 0, special: 0 };
for (const id of [216, 217, 218, 219, 220]) {
  for (const mode of ['normal', 'free', 'random']) {
    for (const preferredWinner of ['player', 'ai']) {
      const run = startRace(id, mode, preferredWinner === 'ai' ? 'lite' : 'full', 'local');
      const state = HB.game.state, initialAccount = HB.store.data, initialProfile = snapshot();
      const timeoutStart = scheduledTimeouts.length;
      const visits = { player: 0, ai: 0 }, awards = { player: 0, ai: 0 }, sleeps = new Set();
      const attacks = new Set(), choices = new Set(), correctSeen = new Set(), wrongSeen = new Set();
      let turns = 0, last, special = 0;
      while (!state.done) {
        const r = state.race, actor = r.turn;
        if (r.phase === 'sleeping') {
          sleeps.add(actor);
          localNaturalTotals.sleeps++;
          finishSleeping(actor);
          raceLedger(run);
          continue;
        }
        assert.equal(r.phase, 'roll');
        assert.equal(timers.size, 0);
        noRaceWork(completeTimers, 'neither local player rolls automatically');
        const visit = ++visits[actor];
        // Choose a die input using the real map rather than repeating a trap cycle forever.
        // This reads state only; every selected route still runs through production movement/landing.
        const projected = dice => {
          const cell = clampRace(r.positions[actor] + dice);
          if (cell === 100) return 100;
          const landing = predictedLanding(cell, .5, false).destination;
          const adjusted = clampRace(landing + (visit === 7 ? -1 : 2));
          return adjusted === 100 ? 100 : predictedLanding(adjusted, .5, false).destination;
        };
        const dice = visit <= 6 || actor !== preferredWinner ? 1 :
          [6, 5, 4, 3, 2, 1].sort((a, b) => projected(b) - projected(a))[0];
        const destination = clampRace(r.positions[actor] + dice);
        startRaceMove(dice);
        if (destination === 100) last = landRaceMove(100);
        else {
          special += Number(specialAt(destination));
          if (state.level.cardsEnabled && r.cards[actor].length) {
            withRaceRandom(0, () => landRaceMove(destination), 0);
            cardsWindow();
            noRaceWork(completeTimers, 'both human card windows wait for input, with no AI card timer');
            const sleepButton = get('raceHand').children.find(button => button.dataset.card === 'sleep' && !button.disabled);
            if (sleepButton) {
              usePlayerCard('sleep');
              attacks.add(actor);
              if (r.phase === 'defense') {
                const choice = sleeps.size < 2 ? 'accept' : 'immune';
                choices.add(choice);
                localNaturalTotals.defenses++;
                respondRealDefense(choice, .5);
              }
            }
            last = continueRealCards(.5);
          } else last = resolveRealLanding(destination, followup => landRaceMove(destination, { followup }), .5);
          if (!state.done) {
            const correct = visit <= 6 || (visit > 7 && actor === preferredWinner);
            (correct ? correctSeen : wrongSeen).add(actor);
            const chance = visit <= 6 ? [.15, 0, .9, 0, .15, 0][visit - 1] : [.9, .9, 0, .15][visit % 4];
            const answer = clickRealAnswer(correct, chance);
            awards[actor] += Number(!!answer.card);
            localNaturalTotals.awards += Number(!!answer.card);
            if (!answer.card) special += Number(specialAt(answer.destination));
            last = finishRealAnswer(answer, .5);
          }
        }
        assert.equal(HB.store.data, initialAccount, 'play must not replace the selected account object');
        assert.equal(snapshot(), initialProfile);
        raceLedger(run);
        if (++turns > 300) throw new Error('natural local race failed to finish: ' + id + '/' + mode + '/' + preferredWinner);
      }
      assert.equal(state.race.winner, preferredWinner);
      assert.ok(state.filledCount > 10);
      assert.equal(correctSeen.size, 2, 'both humans actually answer correctly');
      assert.equal(wrongSeen.size, 2, 'both humans actually incur -1 wrong-answer movement');
      if (id >= 217) assert.ok(special > 0, 'natural games must traverse real generated special squares');
      if (id >= 219) {
        assert.ok(awards.player > 0 && awards.ai > 0, 'both hands are earned, not injected');
        assert.equal(attacks.size, 2, 'both humans use their own earned sleep cards');
        assert.equal(sleeps.size, 2, 'both humans really lose a turn to sleep');
        assert.deepEqual([...choices].sort(), ['accept', 'immune'], 'natural earned hands exercise both defense choices');
      }
      localNaturalTotals.special += special;
      assert.ok(scheduledTimeouts.slice(timeoutStart).every(job => job.delay !== 1200), 'no AI-roll timeout anywhere in a complete local game');
      settleRace(run, preferredWinner, last, 'natural-local-' + id + '-' + preferredWinner);
      assert.equal(overlay.localRace, true);
      assert.equal(overlay.last, true);
      const writes = saves;
      withRaceRandom(.875, () => overlay.onReplay());
      freshRace(id, mode);
      assert.equal(state.raceMode, 'local');
      assert.equal(snapshot(), initialProfile, 'even normal-mode local replay preserves every account field');
      assert.equal(saves, writes);
      naturalLocalGames++;
    }
  }
}
assert.equal(naturalLocalGames, 30);
assert.ok(localNaturalTotals.awards > 0 && localNaturalTotals.defenses > 0 && localNaturalTotals.sleeps > 0 && localNaturalTotals.special > 0);
HB.game.suspend();
assert.equal(timers.size, 0);
assert.equal(pendingRaceMove, null);
console.log('PASS 30 natural local races: 216–220 × normal/free/random × both winners, real boards and callbacks, both manual rolls and +2/-1 answers; earned two-sided cards/sleep/defense choices, no AI timers or account writes, zero-star/reward named-winner terminal overlays and clean replay.');

// ---------- 付费门禁：未激活（试用）状态下 accessible 回退到 isFree ----------
HB.license = { canPlay: id => HB.levels.isFree(id), isFree: id => HB.levels.isFree(id) };
HB.store.data.unlocked = 220;
assert.equal(HB.levels.isFree(20), true, '第20关免费');
assert.equal(HB.levels.isFree(21), false, '第21关付费');
assert.equal(HB.levels.nearestFree(21), 20, '21 的最近免费关是 20');

// 已知起点：正常模式进入免费关 5
HB.game.start(5, 'normal');
assert.equal(HB.game.state.level.id, 5);

// 练习/自由模式点击付费关：直接拒绝，不改变当前关卡
HB.game.start(21, 'free');
assert.equal(HB.game.state.level.id, 5, '自由模式不得进入未激活的付费关');
HB.game.start(100, 'random');
assert.equal(HB.game.state.level.id, 5, '随机模式不得进入未激活的付费关');

// 正常模式请求付费关：回退到最近的免费关
HB.game.start(21, 'normal');
assert.equal(HB.game.state.level.id, 20, '正常模式付费关回退到最近免费关');

// 随机一关：结果永远落在免费集合内
for (let i = 0; i < 200; i++) {
  HB.game.randomLevel();
  const id = HB.game.state.level.id;
  assert.ok(id >= 1 && id <= 220, '随机关卡 id 合法');
  assert.equal(HB.levels.isFree(id), true, '未激活时随机一关只能命中免费关，实际=' + id);
  assert.equal(HB.game.state.mode, 'random');
}
HB.game.suspend();
console.log('PASS 付费门禁：未激活时自由/随机入口拒绝付费关、正常入口回退最近免费关、随机一关仅命中免费集合。');

