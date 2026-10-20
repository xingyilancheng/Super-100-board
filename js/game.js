(function () {
  'use strict';
  window.HB = window.HB || {};

  var S = {
    level: null, filled: {}, filledCount: 0, mistakes: 0, streak: 0,
    hintUsed: false, busy: false, done: false, target: null, mode: 'normal',
    head: 1, checkpointIndex: 0, startedAt: 0, elapsed: 0, race: null, raceMode: 'ai'
  };
  var runId = 0, completionTimer = 0, clockTimer = 0, cancelFlight = null, hinted = null;
  var raceTimer = 0, cancelRaceMove = null, raceHandVersion = 0;
  function $(id) { return document.getElementById(id); }
  function practicing() { return S.mode !== 'normal'; }
  function selecting() { return S.level.interaction === 'select'; }
  function maze() { return S.level.interaction === 'maze'; }
  function racing() { return S.level && S.level.interaction === 'race'; }
  function localRace() { return racing() && S.raceMode === 'local'; }
  function humanRaceActor(actor) { return localRace() || actor === 'player'; }
  function raceName(actor) { return localRace() ? (actor === 'player' ? '玩家1 · 小兔' : '玩家2 · 小熊') : (actor === 'player' ? '你' : '电脑'); }
  function total() { return selecting() ? S.level.tasks.length : maze() ? S.level.minimumFills : S.level.blanks.length; }
  function task() {
    return S.level.kind === 'prime' ? S.level.tasks.find(function (item) { return !S.filled[item.cell]; }) :
      S.level.tasks[S.filledCount];
  }
  function mazeMoves() { return HB.levels.mazeMoves(S.level, S.head, S.checkpointIndex); }

  function clearHint() {
    if (hinted) hinted.classList.remove('hint');
    hinted = null;
  }

  function suspend() {
    runId++;
    clearTimeout(completionTimer);
    clearInterval(clockTimer);
    clearTimeout(raceTimer);
    clearHint();
    if (cancelFlight) { cancelFlight(); cancelFlight = null; }
    if (cancelRaceMove) { cancelRaceMove(); cancelRaceMove = null; }
    S.busy = true;
    HB.ui.hideOverlay();
  }

  function updateClock() {
    S.elapsed = (Date.now() - S.startedAt) / 1000;
    $('playClock').textContent = '用时 ' + S.elapsed.toFixed(1) + ' 秒';
  }

  function accessible(id) {
    return HB.license && typeof HB.license.canPlay === 'function'
      ? HB.license.canPlay(id) : HB.levels.isFree(id);
  }

  function start(id, mode) {
    id = Math.max(1, Math.min(HB.levels.total, Math.floor(Number(id)) || 1));
    if (!accessible(id)) {
      // 未激活时付费关不开放：练习/随机入口直接拒绝，正式入口回退到最近的免费关。
      if ((mode || S.mode) !== 'normal') return;
      id = HB.levels.nearestFree(id);
    }
    suspend();
    S.mode = mode || S.mode;
    if (!practicing()) id = Math.min(id, HB.store.data.unlocked);
    var def = HB.levels.list[id - 1];
    var fresh = def.kind === 'maze' || def.kind === 'schulte' || def.kind === 'race';
    var seed = fresh ? Math.floor(Math.random() * 4294967296) : undefined;
    if (def.kind === 'race' && S.level && S.level.id === id && seed === S.level.seed) seed = (seed + 1) >>> 0;
    var lv = HB.levels.build(id, seed);
    S.level = lv;
    S.filled = {};
    S.filledCount = 0;
    S.mistakes = 0;
    S.streak = 0;
    S.hintUsed = false;
    S.busy = false;
    S.done = false;
    S.head = 1;
    S.checkpointIndex = 0;
    S.startedAt = Date.now();
    S.elapsed = 0;
    S.race = racing() ? { positions: { player: 1, ai: 1 }, turn: 'player', phase: 'roll', dice: 0,
      question: null, winner: null, turnNumber: 1, feedback: raceName('player') + '先掷骰，双方从 1 出发。', event: '',
      cards: { player: [], ai: [] }, shields: { player: false, ai: false }, sleeping: { player: false, ai: false }, defense: null } : null;
    S.target = null;
    $('raceDefense').hidden = true;
    $('raceDefenseActions').innerHTML = '';
    if (!practicing() && !localRace()) {
      HB.store.data.currentLevel = id;
      HB.store.save();
    }
    $('lvBadge').textContent = '第 ' + id + ' 关';
    $('lvName').textContent = lv.name;
    $('lvGoal').textContent = localRace() ? '同屏双人轮流掷骰、各自答题，答对前进2步，答错后退1步；先到100获胜。' : lv.goal;
    $('nextBtn').hidden = true;
    $('prevBtn').disabled = id <= 1 || S.mode === 'random';
    $('replayBtn').textContent = fresh ? '换题重玩' : '重玩';
    $('hintBtn').textContent = practicing() ? '提示（免费）' : '提示 -5';
    $('modeBadge').textContent = localRace() ? '双人对战 · 不计分' : S.mode === 'normal' ? '正式闯关' : (S.mode === 'random' ? '随机练习 · 不计分' : '自由选关 · 不计分');
    $('modeBadge').classList.toggle('practice', practicing() || localRace());
    $('trayTitle').textContent = racing() ? '百数飞行棋' : selecting() ? '点击棋盘作答' : '候选数字';
    $('activityPanel').hidden = !selecting();
    $('trayGrid').hidden = selecting() || racing();
    $('racePanel').hidden = !racing();
    $('hintBtn').hidden = racing();
    $('playClock').hidden = lv.kind !== 'schulte';
    $('trayTip').textContent = lv.kind === 'prime' ? (selecting()
      ? '任意顺序找齐本段质数。已高亮的数字不用再点，1 不是质数。'
      : '从候选中选数填入闪光格。此前区间的质数已高亮，填对后也会高亮。') : selecting() ? '看清题目，直接点棋盘上的答案。答错不会换题。' : maze()
      ? '只能向右或向下。点相邻已知数字前进；空白格从这 10 个候选里选数补路。已知数字不必全部经过。'
      : lv.kind === 'mines' ? '0～8 表示周围雷数；选“雷”标记地雷。' : '只判断闪光格，答对后换一组 10 个候选。';
    HB.board.render(lv);
    HB.ui.renderLevels();
    HB.ui.renderMode();
    if (racing()) {
      $('trayGrid').innerHTML = '';
      $('raceAnswers').innerHTML = '';
      $('trayCount').textContent = '双人竞速';
      $('trayTip').textContent = '沿蛇形路线跳格。到达或超过 100 立即获胜，后退最低到 1。落点触发梯子或陷阱，路过不触发；特殊格不连锁，奖惩不追加题目。';
      $('raceLegend').textContent = lv.ladders.length ? lv.ladders.length + ' 个梯子：直接跳到前方端点 · ' + lv.traps.length + ' 个陷阱：随机后退 5～10 格。' : '起点 1 → 终点 100 · 先到终点获胜';
      renderRace();
      HB.ui.bubble(localRace() ? '玩家1小兔先走！双方轮流操作，各自回答自己的题目。双人对战不计积分、星星和解锁进度。' : '小兔先走！小熊会自动掷骰，两个回合的题目都由你来答。', 'idle');
      return;
    }
    nextTarget();
    refreshTray();
    updateProgress();
    HB.ui.bubble(lv.questionCount ? '这一关有 ' + lv.questionCount + ' 幅图案，先补好第一题的 ' + total() + ' 个空格。' :
      maze() ? '试着只补 ' + total() + ' 个数字走到出口。' : '这一关有 ' + total() + (selecting() ? ' 个点击任务。' : ' 个空格。'), 'idle');
    if (lv.kind === 'schulte') {
      updateClock();
      clockTimer = setInterval(updateClock, 100);
    }
  }

  function raceLater(fn, delay) {
    var token = runId;
    raceTimer = setTimeout(function () { if (token === runId && !S.done) fn(); }, delay);
  }

  function renderRace() {
    var r = S.race, player = r.turn === 'player', local = localRace(), human = humanRaceActor(r.turn);
    var who = raceName(r.turn);
    $('racePanel').dataset.phase = r.phase;
    $('racePanel').dataset.turn = r.turn;
    $('raceAiMode').setAttribute('aria-pressed', !local);
    $('raceLocalMode').setAttribute('aria-pressed', local);
    $('raceModeNote').textContent = local ? '同屏轮流操作，不计积分、星星或解锁。切换模式会重新开始本局。' : '电脑自动掷骰，两个回合都由你答题。切换模式会重新开始本局。';
    $('racePlayerName').textContent = local ? raceName('player') : '我 · 小兔';
    $('raceAiName').textContent = local ? raceName('ai') : '电脑 · 小熊';
    $('racePlayerPosition').textContent = r.positions.player;
    $('raceAiPosition').textContent = r.positions.ai;
    $('raceTurn').textContent = '第 ' + r.turnNumber + ' 回合 · ' + who;
    $('raceDie').dataset.value = r.dice;
    $('raceDie').setAttribute('aria-label', r.dice ? '骰子 ' + r.dice + ' 点' : '骰子等待掷出');
    $('raceRoll').disabled = S.busy || S.done || !human || r.phase !== 'roll';
    $('raceRoll').textContent = r.phase === 'rolling' ? '掷骰中…' : human ? (local ? who + '掷骰子' : '掷骰子') : '电脑自动掷骰';
    $('raceQuestion').textContent = r.question ? r.question.prompt : r.phase === 'defense' ? '等待免疫选择，暂不处理落点' : r.phase === 'cards' ? '先选道具，再处理落点和答题' : '落地后出现题目';
    $('raceQuestionLabel').textContent = r.question ? (r.phase === 'question' ? who + '的落点 ' + r.positions[r.turn] + (local ? ' · 请' + who + '作答' : ' · 请你作答') : '本次题目 · 已作答') : '每个落点一道题';
    $('raceAnswers').hidden = !r.question;
    $('raceFeedback').textContent = r.feedback;
    $('raceEvent').textContent = r.event;
    $('raceEvent').hidden = !r.event;
    $('raceRule').textContent = (local ? '双方各自答题：答对前进 2 步，答错后退 1 步。' : player ? '你答对：你前进 2 步；答错：你后退 1 步。' : '你答对：电脑后退 2 步；答错：电脑前进 3 步。') +
      (S.level.cardsEnabled ? (local ? ' 当前玩家答对' : ' 你回合答对／电脑回合你答错') + '，有 30% 机会给行动方一张卡，替代本次移动；满 2 张仍按原规则移动。' : '');
    $('raceAnswers').querySelectorAll('button').forEach(function (button) { button.disabled = r.phase !== 'question' || S.busy || S.done; });
    renderRaceCards();
    renderRaceDefense();
    ['player', 'ai'].forEach(function (actor) {
      $('racePiece-' + actor).classList.toggle('race-shielded', r.shields[actor]);
      $('racePiece-' + actor).classList.toggle('race-sleeping', r.sleeping[actor] || (r.phase === 'sleeping' && r.turn === actor));
    });
    var status = r.phase === 'done' ? (local ? raceName(r.winner) + '先到达 100，获胜！' : r.winner === 'player' ? '你先到达 100，获胜！' : '电脑先到达 100，本局结束。') :
      r.phase === 'defense' ? raceName(r.defense.defender) + '受到睡眠攻击，请选择是否使用免疫卡。' :
      r.phase === 'cards' ? who + '到达 ' + r.positions[r.turn] + '，答题前可使用道具。' :
      r.phase === 'sleeping' ? who + '受睡眠影响，本回合轮空。' :
      r.phase === 'reward' ? who + '获得卡片，本次不再移动。' :
      r.phase === 'question' ? who + '到达 ' + r.positions[r.turn] + '，请回答右侧题目。' :
      r.phase === 'moving' ? who + '正在跳跃，当前位置 ' + r.positions[r.turn] + '。' :
      r.phase === 'rolling' ? who + '正在掷骰子…' : human ? '轮到' + who + '了，点击“掷骰子”。' : '轮到电脑，即将自动掷骰。';
    $('targetPrompt').textContent = status;
    $('progressBar').style.width = (r.positions.player - 1) / 99 * 100 + '%';
    $('progressText').textContent = raceName('player') + ' ' + r.positions.player + '/100 · ' + raceName('ai') + ' ' + r.positions.ai + '/100';
  }

  function raceCardName(card) { return card === 'sleep' ? '睡眠卡' : '免疫卡'; }

  function renderRaceCards() {
    var r = S.race, host = $('raceHand'), token = runId, turn = r.turnNumber, version = ++raceHandVersion;
    var actor = r.defense ? r.defense.defender : localRace() ? r.turn : 'player';
    var other = actor === 'player' ? 'ai' : 'player';
    $('raceCards').hidden = !S.level.cardsEnabled;
    host.innerHTML = '';
    if (!S.level.cardsEnabled) return;
    host.setAttribute('aria-label', raceName(actor) + '的道具卡');
    $('raceCardStatus').textContent = raceName('player') + ' ' + r.cards.player.length + '/2 · ' + raceName('ai') + ' ' + r.cards.ai.length + '/2' +
      ' · ' + raceName('ai') + '持卡：' + (r.cards.ai.map(raceCardName).join('、') || '无') +
      (r.shields.player ? ' · ' + raceName('player') + '有免疫保护' : '') + (r.shields.ai ? ' · ' + raceName('ai') + '有免疫保护' : '') +
      (r.sleeping.player ? ' · ' + raceName('player') + '下回合轮空' : '') + (r.sleeping.ai ? ' · ' + raceName('ai') + '下回合轮空' : '');
    r.cards[actor].forEach(function (card, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'race-card';
      button.dataset.card = card;
      button.textContent = raceCardName(card) + (card === 'sleep' ? ' · 对手轮空' : ' · 抵挡一次');
      button.disabled = r.turn !== actor || !humanRaceActor(actor) || r.phase !== 'cards' || S.busy || S.done ||
        (card === 'immune' ? r.shields[actor] : r.sleeping[other]);
      button.addEventListener('click', function () {
        if (token === runId && version === raceHandVersion && turn === S.race.turnNumber && !S.busy) useRaceCard(actor, index);
      });
      host.appendChild(button);
    });
    $('raceContinue').hidden = r.phase !== 'cards' || !humanRaceActor(r.turn);
    $('raceContinue').disabled = S.busy || S.done;
  }

  function renderRaceDefense() {
    var r = S.race, defense = r.defense, host = $('raceDefenseActions'), token = runId;
    $('raceDefense').hidden = r.phase !== 'defense';
    host.innerHTML = '';
    if (r.phase !== 'defense') return;
    $('raceDefensePrompt').textContent = raceName(defense.defender) + '，' + raceName(defense.attacker) + '对你使用了睡眠卡。是否消耗一张免疫卡，避免下回合轮空？';
    [true, false].forEach(function (useImmune) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = useImmune ? 'primary-btn' : 'ghost-btn';
      button.dataset.defense = useImmune ? 'immune' : 'accept';
      button.textContent = useImmune ? '使用免疫卡' : '保留卡片，接受轮空';
      button.disabled = S.busy || S.done;
      button.addEventListener('click', function () {
        if (token === runId && S.race.defense === defense) respondRaceSleep(useImmune);
      });
      host.appendChild(button);
    });
  }

  function respondRaceSleep(useImmune) {
    var r = S.race;
    if (!racing() || S.busy || S.done || r.phase !== 'defense' || !r.defense) return;
    var defender = r.defense.defender;
    if (useImmune) {
      r.cards[defender].splice(r.cards[defender].indexOf('immune'), 1);
      r.event = raceName(defender) + '使用手中的免疫卡抵挡了睡眠，卡片已消耗。';
    } else {
      r.sleeping[defender] = true;
      r.event = raceName(defender) + '保留免疫卡，下回合轮空。';
    }
    r.defense = null;
    r.phase = 'cards';
    S.busy = !humanRaceActor(r.turn);
    r.feedback = r.event + (S.busy ? '继续处理电脑落点。' : '请' + raceName(r.turn) + '继续用卡或处理落点。');
    HB.audio.play('pick');
    renderRace();
    if (S.busy) continueRaceLanding();
  }

  function useRaceCard(actor, index) {
    var r = S.race;
    if (!racing() || S.done || r.phase !== 'cards' || r.turn !== actor) return;
    var card = r.cards[actor][index], other = actor === 'player' ? 'ai' : 'player';
    if (!card || (card === 'immune' ? r.shields[actor] : r.sleeping[other])) return;
    r.cards[actor].splice(index, 1);
    var who = raceName(actor);
    if (card === 'immune') {
      r.shields[actor] = true;
      r.event = who + '使用免疫卡：可抵挡下一次陷阱或睡眠，抵挡后消失。';
    } else if (r.shields[other]) {
      r.shields[other] = false;
      r.event = who + '使用睡眠卡，被对方的免疫保护抵挡了。';
    } else if (r.cards[other].indexOf('immune') >= 0) {
      if (humanRaceActor(other)) {
        r.defense = { attacker: actor, defender: other };
        r.phase = 'defense';
        S.busy = false;
        r.event = who + '使用睡眠卡，等待' + raceName(other) + '选择免疫。';
        r.feedback = '先由被攻击方选择；选择结束前，落点和答题暂停。';
      } else {
        r.cards[other].splice(r.cards[other].indexOf('immune'), 1);
        r.event = '电脑使用手中的免疫卡抵挡了睡眠，卡片已消耗。';
      }
    } else {
      r.sleeping[other] = true;
      r.event = who + '使用睡眠卡：对方下一回合轮空。';
    }
    HB.audio.play('pick');
    renderRace();
    if (r.phase === 'defense') $('raceDefense').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  function endRaceTurn() {
    var r = S.race;
    r.turn = r.turn === 'player' ? 'ai' : 'player';
    r.turnNumber++;
    r.question = null;
    if (r.sleeping[r.turn]) {
      r.sleeping[r.turn] = false;
      r.phase = 'sleeping';
      S.busy = true;
      r.event = raceName(r.turn) + '本回合睡眠轮空，下一回合恢复。';
      renderRace();
      raceLater(endRaceTurn, 900);
      return;
    }
    r.phase = humanRaceActor(r.turn) ? 'roll' : 'waiting';
    S.busy = false;
    renderRace();
    if (!humanRaceActor(r.turn)) raceLater(rollRace, 1200);
  }

  function resolveRaceLanding(onDone) {
    var r = S.race, cell = r.positions[r.turn], who = raceName(r.turn);
    var ladder = S.level.ladders.find(function (item) { return item.from === cell; });
    if (ladder) {
      r.event = who + '登上梯子，从 ' + cell + ' 直接跳到 ' + ladder.to + '。';
      moveRace(ladder.to - cell, onDone, true);
    } else if (S.level.traps.indexOf(cell) >= 0) {
      if (r.shields[r.turn]) {
        r.shields[r.turn] = false;
        r.event = who + '的免疫保护抵挡了第 ' + cell + ' 格的陷阱，保护已消耗。';
        onDone();
      } else {
        var steps = 5 + Math.floor(Math.random() * 6);
        r.event = who + '踩到第 ' + cell + ' 格的陷阱，后退 ' + steps + ' 格。';
        moveRace(-steps, onDone);
      }
    } else onDone();
  }

  function continueRaceLanding() {
    resolveRaceLanding(askRaceQuestion);
  }

  function raceBeforeQuestion() {
    var r = S.race;
    if (!S.level.cardsEnabled || !r.cards[r.turn].length) { continueRaceLanding(); return; }
    r.phase = 'cards';
    S.busy = !humanRaceActor(r.turn);
    r.feedback = humanRaceActor(r.turn) ? raceName(r.turn) + '走完骰子步数了。可以用卡，再点击“继续：落点与答题”；也可以直接继续。' : '电脑正在选择道具，随后仍由你回答题目。';
    renderRace();
    $('racePanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!humanRaceActor(r.turn)) raceLater(function () {
      var immune = r.cards.ai.indexOf('immune');
      if (immune >= 0 && !r.shields.ai && (S.level.traps.indexOf(r.positions.ai) >= 0 || r.cards.player.indexOf('sleep') >= 0)) useRaceCard('ai', immune);
      var sleep = r.cards.ai.indexOf('sleep');
      if (sleep >= 0 && !r.sleeping.player) useRaceCard('ai', sleep);
      if (r.phase !== 'defense') continueRaceLanding();
    }, 900);
  }

  function moveRace(steps, onDone, direct) {
    var r = S.race, actor = r.turn, token = runId;
    var destination = Math.max(1, Math.min(100, r.positions[actor] + steps));
    r.phase = 'moving';
    S.busy = true;
    HB.board.setTarget(null);
    $('board').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    renderRace();
    function step() {
      if (token !== runId || S.done) return;
      if (r.positions[actor] === destination) {
        cancelRaceMove = null;
        if (destination === 100) {
          r.winner = actor;
          r.phase = 'done';
          r.feedback = localRace() ? raceName(actor) + '率先抵达终点！' : actor === 'player' ? '你率先抵达终点！' : '电脑先到终点，再来挑战一次吧。';
          renderRace();
          complete(localRace() || actor === 'player');
        } else onDone();
        return;
      }
      var next = direct ? destination : r.positions[actor] + (destination > r.positions[actor] ? 1 : -1);
      var lite = HB.store.data.settings.motion === 'lite', finished = false;
      cancelRaceMove = HB.board.moveRacePiece(actor, next, direct ? (lite ? 320 : 560) : (lite ? 140 : 260), function () {
        if (token !== runId || S.done || finished) return;
        finished = true;
        cancelRaceMove = null;
        r.positions[actor] = next;
        renderRace();
        step();
      });
    }
    step();
  }

  function askRaceQuestion() {
    var r = S.race, token = runId;
    r.question = S.level.questions[r.positions[r.turn]];
    r.phase = 'question';
    S.busy = false;
    r.feedback = localRace() ? '请' + raceName(r.turn) + '作答：答对前进2步，答错后退1步。' : r.turn === 'player' ? (S.level.cardsEnabled ? '答对可前进 2 步，也可能获得卡片来替代移动。' : '算对后，你还能前进 2 步。') : '这是电脑的回合，但题目由你来做；算对就让电脑后退。';
    var host = $('raceAnswers');
    host.innerHTML = '';
    r.question.choices.forEach(function (value) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'race-answer';
      button.dataset.value = value;
      button.textContent = value;
      button.setAttribute('aria-label', '答案 ' + value);
      button.addEventListener('click', function () { if (token === runId) answerRace(value); });
      host.appendChild(button);
    });
    HB.board.setTarget(r.positions[r.turn]);
    renderRace();
    $('racePanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function rollRace() {
    if (!racing() || S.done || S.busy || !['roll', 'waiting'].includes(S.race.phase)) return;
    var r = S.race, result = 1 + Math.floor(Math.random() * 6), frame = 0;
    r.phase = 'rolling';
    r.question = null;
    S.busy = true;
    $('raceAnswers').innerHTML = '';
    HB.audio.play('pick');
    function tumble() {
      r.dice = (result + frame) % 6 + 1;
      renderRace();
      if (++frame < 6) raceLater(tumble, 80);
      else {
        r.dice = result;
        r.feedback = raceName(r.turn) + '掷出 ' + result + ' 点，前进 ' + result + ' 步。';
        renderRace();
        raceLater(function () { moveRace(result, raceBeforeQuestion); }, 160);
      }
    }
    tumble();
  }

  function answerRace(value) {
    if (!racing() || S.busy || S.done || S.race.phase !== 'question') return;
    var r = S.race;
    if (r.question.choices.indexOf(value) < 0) return;
    var correct = value === r.question.answer, player = r.turn === 'player';
    var steps = localRace() || player ? (correct ? 2 : -1) : (correct ? -2 : 3);
    if (!correct) S.mistakes++;
    S.filledCount++;
    r.feedback = (correct ? '答对了！' : '答错了，正确答案是 ' + r.question.answer + '。') +
      raceName(r.turn) + (steps > 0 ? '前进 ' : '后退 ') + Math.abs(steps) + ' 步。';
    HB.audio.play(correct ? 'correct' : 'wrong');
    if (S.level.cardsEnabled && (localRace() ? correct : correct === player) && r.cards[r.turn].length < 2) {
      var chance = Math.random();
      if (chance < .3) {
        var card = chance < .15 ? 'sleep' : 'immune';
        r.cards[r.turn].push(card);
        r.phase = 'reward';
        S.busy = true;
        HB.board.setTarget(null);
        r.feedback = (correct ? '答对了！' : '答错了，正确答案是 ' + r.question.answer + '。') +
          raceName(r.turn) + '获得一张' + raceCardName(card) + '，替代本次移动。';
        r.event = r.feedback;
        renderRace();
        raceLater(endRaceTurn, 900);
        return;
      }
    }
    moveRace(steps, function () { resolveRaceLanding(endRaceTurn); });
  }

  function remaining() {
    if (maze()) return mazeMoves().filter(function (n) { return HB.board.isBlank(n); });
    return (S.level.fillOrder || S.level.blanks).filter(function (id) { return !S.filled[id]; });
  }
  function answer() { return S.level.answers[S.target]; }

  function makeTile(n) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-look tray-tile';
    b.dataset.n = n;
    b.textContent = HB.board.label(n);
    b.setAttribute('aria-label', '候选 ' + HB.board.label(n));
    b.style.setProperty('--h', HB.board.hueOf(n));
    b.addEventListener('click', onTrayClick);
    return b;
  }

  function refreshTray() {
    var host = $('trayGrid');
    host.innerHTML = '';
    if (selecting()) { $('trayCount').textContent = '直接点选'; return; }
    var prev = S.level.candidates.join(',');
    var candidates = HB.levels.candidates(S.level, remaining(), S.target);
    if (candidates.join(',') === prev) candidates.push(candidates.shift());
    S.level.candidates = candidates;
    candidates.forEach(function (n) { host.appendChild(makeTile(n)); });
    $('trayCount').textContent = '10 个';
  }

  function onTrayClick(e) {
    if (S.busy || S.done || selecting()) return;
    var tile = e.currentTarget, value = Number(tile.dataset.n);
    if (maze()) {
      if (mazeMoves().indexOf(value) < 0 || !HB.board.isBlank(value) || (S.target != null && value !== S.target)) {
        oops(tile); return;
      }
      S.target = value;
      HB.board.setTarget(value);
      flyIn(value, tile);
    } else if (S.target != null) {
      if (value === answer()) flyIn(value, tile);
      else oops(tile);
    }
  }

  function reward(cell) {
    S.streak++;
    var gained = 10 + (S.streak % 3 === 0 ? 5 : 0);
    if (!practicing()) {
      HB.store.addScore(gained);
      HB.ui.countUp(HB.store.data.score);
    }
    var r = cell.getBoundingClientRect();
    HB.fx.floatText(r.left + r.width / 2, r.top + r.height / 2, practicing() ? '正确' : '+' + gained, '');
    HB.fx.land(cell, HB.board.hueOf(Number(cell.dataset.n)));
    HB.audio.play('correct');
    HB.ui.say('correct');
  }

  function flyIn(value, tile) {
    S.busy = true;
    tile.classList.add('used');
    var target = S.target, token = runId;
    var cell = HB.board.el(target), hue = HB.board.hueOf(target);
    HB.audio.play('pick');
    cancelFlight = HB.fx.flyTo({
      fromEl: tile, toEl: cell, num: HB.board.label(value), hue: hue,
      onDone: function () {
        if (token !== runId) return;
        cancelFlight = null;
        HB.board.fill(target, value);
        S.filled[target] = 1;
        S.filledCount++;
        reward(cell);
        S.busy = false;
        if (maze()) advanceMaze(target);
        else {
          nextTarget();
          refreshTray();
          updateProgress();
          if (S.filledCount >= total()) {
            if (S.level.questionCount && S.level.questionIndex + 1 < S.level.questionCount) nextWorksheetQuestion();
            else complete();
          }
        }
      }
    });
  }

  function nextWorksheetQuestion() {
    S.busy = true;
    var token = runId;
    HB.ui.bubble('本题完成，接着挑战下一幅图案！', 'idle');
    completionTimer = setTimeout(function () {
      if (token !== runId) return;
      S.level = HB.levels.build(S.level.id, undefined, S.level.questionIndex + 1);
      S.filled = {};
      S.filledCount = 0;
      S.busy = false;
      $('lvGoal').textContent = S.level.goal;
      HB.board.render(S.level);
      nextTarget();
      refreshTray();
      updateProgress();
    }, 620);
  }

  function advanceMaze(n) {
    HB.board.moveMaze(S.head, n);
    S.head = n;
    if (S.level.checkpoints[S.checkpointIndex] === n) S.checkpointIndex++;
    HB.audio.play('click');
    nextTarget();
    refreshTray();
    updateProgress();
    if (n === 100 && S.checkpointIndex === S.level.checkpoints.length && S.filledCount === total()) complete();
  }

  function oops(tile) {
    HB.fx.shakeWrong(tile);
    HB.audio.play('wrong');
    if (!practicing()) {
      HB.store.addScore(-3);
      HB.ui.countUp(HB.store.data.score);
    }
    var r = tile.getBoundingClientRect();
    HB.fx.floatText(r.left + r.width / 2, r.top + r.height / 2, practicing() ? '再想想' : '-3', 'bad');
    S.mistakes++;
    S.streak = 0;
    HB.ui.bubble(maze() ? '只能走相邻的右格或下格，还要经过打卡点，并保持补数最少。' : selecting() ? '再读一遍题目，直接在棋盘上找答案。' : '只判断当前闪光格，请再看一下题目。', 'wrong');
  }

  function nextTarget() {
    clearHint();
    if (selecting()) {
      S.target = task() ? task().cell : null;
      HB.board.setTarget(null);
      HB.board.setOrigin(task() ? task().start : null);
    } else if (maze()) {
      S.target = null;
      HB.board.setTarget(null);
    } else {
      var rest = remaining();
      S.target = rest.length ? rest[0] : null;
      HB.board.setTarget(S.target);
    }
    updatePrompt();
  }

  function updatePrompt() {
    if (maze()) {
      $('targetPrompt').textContent = S.head === 100 ? '已用最少的数字连到出口！' : '当前位置 ' + S.head + ' · 下一站 ' + (S.level.checkpoints[S.checkpointIndex] || '100（出口）') + ' · 最少补 ' + total() + ' 格' + (S.target != null ? ' · 已选第 ' + (Math.floor((S.target - 1) / 10) + 1) + ' 行第 ' + ((S.target - 1) % 10 + 1) + ' 列' : '');
      return;
    }
    if (selecting()) {
      var current = task();
      $('targetPrompt').textContent = current ? current.prompt : '全部任务完成了！';
      $('activityTitle').textContent = S.level.kind === 'prime' ? '质数侦探 · 自由点选' : S.level.kind === 'schulte' ? '按顺序找数字' : S.level.kind === 'coordinate' ? '送动物回家' : S.level.kind === 'multiplication' ? '横乘纵 · 找乘积' : '读题 · 找数 · 点选';
      $('activityPrompt').textContent = current ? current.prompt : '完成！';
      $('activityNote').textContent = S.level.kind === 'prime' ? '已找到 ' + S.filledCount + ' / ' + total() + ' 个质数' :
        current ? '第 ' + (S.filledCount + 1) + ' / ' + total() + ' 题' + (S.level.kind === 'multiplication' ? ' · 相同乘积的格子都可以选' : '') : '全部答对了';
      $('animalCard').hidden = !(current && current.animal);
      if (current && current.animal) HB.board.showAnimal($('animalCard'), current.animal);
      return;
    }
    if (S.target == null) { $('targetPrompt').textContent = '所有空格都完成了！'; return; }
    var size = S.level.size;
    var position = '第 ' + (Math.floor((S.target - 1) / size) + 1) + ' 行，第 ' + ((S.target - 1) % size + 1) + ' 列';
    $('targetPrompt').textContent = position + ' · ' + (S.level.clues[S.target] || '请填入这个格子对应的数字。');
  }

  function updateProgress() {
    var fraction = S.filledCount / total();
    var questionLabel = '';
    if (S.level.questionCount) {
      fraction = (S.level.questionIndex + fraction) / S.level.questionCount;
      questionLabel = '第 ' + (S.level.questionIndex + 1) + ' / ' + S.level.questionCount + ' 题 · ';
    }
    $('progressBar').style.width = Math.round(fraction * 100) + '%';
    $('progressText').textContent = questionLabel + (selecting() ? '已答 ' : '已填 ') + S.filledCount + ' / ' + total() + (maze() ? ' · 打卡 ' + S.checkpointIndex + ' / ' + S.level.checkpoints.length : '');
  }

  function onBoardClick(e) {
    if (S.busy || S.done || racing()) return;
    var cell = e.target.closest('.cell');
    if (!cell || cell.classList.contains('table-void')) return;
    var n = Number(cell.dataset.n);
    if (selecting()) {
      var prime = S.level.kind === 'prime';
      if (prime && (S.filled[n] || S.level.knownPrimes.indexOf(n) >= 0)) return;
      var correct = prime ? S.level.primeCells.indexOf(n) >= 0 : S.level.kind === 'multiplication'
        ? S.level.activeCells.indexOf(n) >= 0 && S.level.values[n] === S.level.values[S.target]
        : n === S.target;
      if (!correct) { oops(cell); return; }
      HB.board.markCorrect(n, task().animal);
      if (prime) S.filled[n] = 1;
      S.filledCount++;
      reward(cell);
      nextTarget();
      updateProgress();
      if (S.filledCount >= total()) complete();
      return;
    }
    if (maze()) {
      if (n === S.head) {
        S.target = null;
        HB.board.setTarget(null);
        updatePrompt();
        return;
      }
      var adjacent = (n === S.head + 1 && S.head % 10 !== 0) || n === S.head + 10;
      if (!adjacent) { oops(cell); return; }
      if (!HB.board.isBlank(n)) {
        if (mazeMoves().indexOf(n) < 0) oops(cell);
        else advanceMaze(n);
        return;
      }
    } else if (!HB.board.isBlank(n)) return;
    S.target = n;
    HB.board.setTarget(n);
    updatePrompt();
    if (S.level.candidates.indexOf(answer()) < 0) {
      S.level.candidates[9] = answer();
      $('trayGrid').lastElementChild.replaceWith(makeTile(answer()));
    }
    HB.audio.play('click');
  }

  function complete(won) {
    if (S.done) return;
    var lost = won === false, local = localRace();
    S.done = true;
    clearInterval(clockTimer);
    if (S.level.kind === 'schulte') updateClock();
    var stars = lost || local ? 0 : S.mistakes === 0 ? 3 : (S.mistakes <= 2 ? 2 : 1);
    var gained = practicing() || lost || local ? 0 : 20 + (S.mistakes === 0 ? 10 : 0) + (S.hintUsed ? 0 : 5);
    if (!practicing() && !lost && !local) {
      HB.store.recordLevel(S.level.id, stars);
      HB.store.addScore(gained);
      HB.ui.renderScore();
      HB.ui.renderAccount();
    }
    HB.ui.renderLevels();
    if (!lost) HB.ui.say('win');
    var token = runId, id = S.level.id, mode = S.mode;
    var paywall = !local && !lost && !practicing() && mode !== 'random' &&
      id < HB.levels.total && !accessible(id + 1);
    var last = local || lost || paywall || (id === HB.levels.total && mode !== 'random');
    var allDone = !local && !lost && !practicing() && HB.store.doneCount() === HB.levels.total;
    S.busy = true;
    completionTimer = setTimeout(function () {
      if (token !== runId) return;
      S.busy = false;
      HB.ui.showOverlay({
        stars: stars, levelId: id, levelName: S.level.name, mistakes: S.mistakes,
        gained: gained, allDone: allDone, practice: practicing(), last: last, lost: lost, race: racing(),
        paywall: paywall,
        localRace: local, winnerName: local ? raceName(S.race.winner) : null,
        elapsed: S.level.kind === 'schulte' ? S.elapsed : null,
        nextLabel: mode === 'random' ? '再随机一关' : '下一关',
        onNext: function () { if (mode === 'random') randomLevel(); else start(id + 1, mode); },
        onReplay: function () { start(id, mode); }
      });
      $('nextBtn').textContent = mode === 'random' ? '再随机一关' : '下一关';
      $('nextBtn').hidden = last;
    }, 620);
  }

  function useHint() {
    if (S.busy || S.done || racing()) return;
    var tile;
    if (selecting()) tile = HB.board.el(S.target);
    else if (maze()) {
      S.target = null;
      HB.board.setTarget(null);
      updatePrompt();
      tile = HB.board.el(mazeMoves()[0]);
    } else tile = document.querySelector('.tray-tile[data-n="' + answer() + '"]');
    S.hintUsed = true;
    if (!practicing()) {
      HB.store.addScore(-Math.min(5, HB.store.data.score));
      HB.ui.countUp(HB.store.data.score);
    }
    HB.audio.play('hint');
    clearHint();
    hinted = tile;
    void tile.offsetWidth;
    tile.classList.add('hint');
    setTimeout(function () { tile.classList.remove('hint'); }, 2200);
    HB.ui.bubble(selecting() || maze() ? '发光的棋盘格是下一步的位置。' : '发光候选是当前格的答案。', 'idle');
  }

  function randomLevel() {
    var previous = S.level ? S.level.id : 0;
    var pool = [];
    for (var id = 1; id <= HB.levels.total; id++) if (id !== previous && accessible(id)) pool.push(id);
    start(pool[Math.floor(Math.random() * pool.length)], 'random');
  }

  function setMode(mode) {
    if (mode === 'normal') start(HB.store.data.currentLevel, 'normal');
    else start(S.level ? S.level.id : 1, 'free');
  }

  function retint() {
    document.querySelectorAll('.tray-tile').forEach(function (t) {
      t.style.setProperty('--h', HB.board.hueOf(Number(t.dataset.n)));
    });
  }

  function setRaceMode(mode) {
    if (!racing() || S.raceMode === mode) return;
    S.raceMode = mode;
    start(S.level.id, S.mode);
  }

  function init() {
    $('grid').addEventListener('click', onBoardClick);
    $('hintBtn').addEventListener('click', useHint);
    $('raceAiMode').addEventListener('click', function () { setRaceMode('ai'); });
    $('raceLocalMode').addEventListener('click', function () { setRaceMode('local'); });
    $('raceRoll').addEventListener('click', function () { if (racing() && humanRaceActor(S.race.turn)) rollRace(); });
    $('raceContinue').addEventListener('click', function () {
      if (racing() && !S.busy && !S.done && humanRaceActor(S.race.turn) && S.race.phase === 'cards') continueRaceLanding();
    });
    $('replayBtn').addEventListener('click', function () { start(S.level.id); });
    $('prevBtn').addEventListener('click', function () { start(S.level.id - 1); });
    $('nextBtn').addEventListener('click', function () {
      if (S.mode === 'random') randomLevel(); else start(S.level.id + 1);
    });
  }

  HB.game = { init: init, start: start, suspend: suspend, setMode: setMode, randomLevel: randomLevel, retint: retint, state: S };
})();
