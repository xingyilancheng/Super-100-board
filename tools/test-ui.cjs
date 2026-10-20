const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

if (process.argv[2] !== '--ui-worker') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hundred-board-ui-profile-'));
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'hundred-board-ui-images-'));
  let code = 1;
  try {
    isolate(path.join(scratch, 'launcher'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(process.execPath, [__filename, '--ui-worker', scratch, artifacts], {
      env, stdio: 'inherit', windowsHide: true, timeout: 600000
    });
    if (result.error) throw result.error;
    code = result.status === 0 ? 0 : 1;
  } catch (error) {
    console.error(error.stack || error);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
    console.log('Screenshots: ' + artifacts);
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
  const consoleErrors = [], expectedImageFailures = [];
  const missingSupport = new Set(['follow', 'donate'].filter(name => !fs.existsSync(path.join(__dirname, '../assets', name + '.jpg'))));
  window.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
    if (level < 3) return;
    if ([...missingSupport].some(name => sourceId.endsWith('/assets/' + name + '.jpg')) && /Failed to load resource/.test(message)) {
      expectedImageFailures.push({ message, sourceId });
    } else consoleErrors.push(message);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const url = process.env.HB_TEST_URL || 'http://localhost:5173/index.html';
  const page = (fn, ...args) => window.webContents.executeJavaScript('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  async function wait(fn, label) {
    const until = Date.now() + 5000;
    while (!(await page(fn))) {
      if (Date.now() > until) throw new Error('Timed out: ' + label);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  async function click(selector) {
    const position = await page(selector => {
      const el = document.querySelector(selector);
      if (!el || el.disabled || !el.getClientRects().length) throw new Error('Not clickable: ' + selector);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, selector);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position });
    await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function choose(id) {
    await page(id => { document.getElementById('practiceLevel').value = id; }, id);
    await click('#startPracticeBtn');
    assert.equal(await page(() => HB.game.state.level.id), id);
  }
  async function chooseOriginal(id) {
    const previous = id > 25 ? id + 15 : id > 20 ? id + 10 : id;
    await choose(previous >= 116 && previous <= 135 ? previous - 55 :
      previous >= 61 && previous <= 115 ? previous + 20 : previous);
  }
  async function screenshot(name) {
    await page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await new Promise(resolve => setTimeout(resolve, 150));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(process.argv[4], name + '.png'), image.toPNG());
  }
  async function geometry() {
    return page(() => {
      const board = document.getElementById('board').getBoundingClientRect();
      const cells = [...document.querySelectorAll('#grid .cell')].map(e => e.getBoundingClientRect());
      return { width: innerWidth, height: innerHeight, cells: cells.length,
        boardWidth: board.width, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        inside: cells.every(r => r.left >= board.left && r.top >= board.top && r.right <= board.right + 1 && r.bottom <= board.bottom + 1),
        cellWidth: cells[0].width };
    });
  }
  try {
    await window.loadURL(url);
    await wait(() => window.HB && HB.game.state.level && document.getElementById('saveStatus').textContent.includes('已保存'), 'application boot');
    await page(() => {
      window.__uiErrors = [];
      addEventListener('error', e => __uiErrors.push(e.message));
      addEventListener('unhandledrejection', e => __uiErrors.push(String(e.reason)));
    });
    assert.equal(await page(() => HB.levels.total), 220);
    await click('#freeModeToggle');
    const originalProfile = await page(() => JSON.stringify(HB.store.data));

    // ---------- 付费授权：未激活锁定 → 真实 UI 激活 → 解锁 ----------
    const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(__dirname, 'license-private-key.pem'), 'utf8'));
    const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const issueCode = (serial, machine) => {
      const payload = { s: serial, b: 'TEST', v: 1, d: Math.floor(Date.now() / 86400000) };
      if (machine) payload.m = machine;
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const sig = crypto.sign('sha256', body, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      return b64url(body) + '.' + b64url(sig);
    };
    assert.equal(await page(() => HB.license.status().active), false, '测试从全新未激活状态开始');
    assert.match(await page(() => document.getElementById('licenseStatus').textContent), /（未激活）/);
    assert.equal(await page(() => document.getElementById('licenseExportBtn').hidden), true);
    assert.equal(await page(() => document.getElementById('licenseImportBtn').hidden), false, '未激活显示导入授权文件');
    assert.equal(await page(() => document.getElementById('licenseActivateBtn').textContent), '输入激活码');
    assert.equal(await page(() => document.getElementById('resetBtn')), null, '重新开始按钮已移除');
    assert.equal(await page(() => [...document.querySelectorAll('.settings-card label')].some(l => l.textContent === '重新开始')), false);
    assert.deepEqual(await page(() => {
      const paid = document.querySelector('#levelList .lv-btn[data-level="21"]');
      const free = document.querySelector('#levelList .lv-btn[data-level="20"]');
      return { paidDisabled: paid.disabled, paidPaywall: paid.classList.contains('paywall'),
        freePaywall: free.classList.contains('paywall'),
        optPaidDisabled: document.querySelector('#practiceLevel option[value="21"]').disabled,
        optFreeDisabled: document.querySelector('#practiceLevel option[value="20"]').disabled };
    }), { paidDisabled: false, paidPaywall: true, freePaywall: false, optPaidDisabled: true, optFreeDisabled: false });
    await screenshot('license-locked');

    // 未激活点击灰色付费关卡：应弹提示并打开激活对话框（付费关不再 disabled，改为可点击）
    await click('#levelList .lv-btn[data-level="21"]');
    await wait(() => document.getElementById('licenseDialog').open, '未激活点击付费关打开激活框');
    assert.match(await page(() => document.getElementById('mascotBubble').textContent), /完整版|激活/, '点击付费关有需激活提示');
    await page(() => document.getElementById('licenseDialog').close());
    await wait(() => !document.getElementById('licenseDialog').open, '激活框已关闭');

    await click('#licenseActivateBtn');
    await wait(() => document.getElementById('licenseDialog').open, 'license dialog opens');
    await page(() => { document.getElementById('licenseCode').value = 'not-a-real-code'; });
    await click('#licenseConfirmBtn');
    await wait(() => !document.getElementById('licenseError').hidden, 'bad code surfaces an error');
    await page(code => { document.getElementById('licenseCode').value = code; }, issueCode('TEST-UI-1'));
    await click('#licenseConfirmBtn');
    await wait(() => !document.getElementById('licenseDialog').open && HB.license.status().active, 'activation closes dialog and unlocks');
    assert.match(await page(() => document.getElementById('licenseStatus').textContent), /（已激活）激活码 TEST-UI-1/);
    assert.equal(await page(() => document.getElementById('licenseExportBtn').hidden), false);
    assert.equal(await page(() => document.getElementById('licenseImportBtn').hidden), true, '已激活隐藏导入授权文件');
    assert.equal(await page(() => document.getElementById('licenseActivateBtn').textContent), '更换激活码');
    assert.equal(await page(() => { const b = document.querySelector('#levelList .lv-btn[data-level="21"]'); return b.disabled || b.classList.contains('paywall'); }), false, '激活后付费关解锁');
    assert.equal(await page(() => document.querySelector('#practiceLevel option[value="21"]').disabled), false);
    await screenshot('license-activated');
    console.log('PASS license gate UI: trial lock state, bad-code error, real activation unlocks paid map buttons and practice options');

    assert.deepEqual(await page(() => [...document.querySelectorAll('#practiceLevel optgroup')][4].children.length), 10);
    assert.equal(await page(() => document.getElementById('totalStars').textContent), '660');
    const reorderedChapters = [
      ['第七章 · 减法探险', 51, 60, 'subtraction'],
      ['第八章 · 数字分解', 61, 70, 'decompose'],
      ['第九章 · 凑数伙伴', 71, 80, 'bonds'],
      ['第十章 · 倍数列车', 81, 95, 'multiple'],
      ['第十一章 · 质数侦探', 96, 105, 'prime'],
      ['第十二章 · 四宫数独', 106, 110, 'sudoku'],
      ['第十三章 · 六宫数独', 111, 115, 'sudoku'],
      ['第十四章 · 九宫数独', 116, 120, 'sudoku'],
      ['第十五章 · 雷区推理', 121, 135, 'mines'],
      ['第十六章 · 动物坐标', 136, 145, 'coordinate']
    ];
    const expectedChapters = reorderedChapters.map(([name, from, to]) => ({ name,
      ids: Array.from({ length: to - from + 1 }, (_, i) => from + i) }));
    assert.deepEqual(await page(() => [...document.querySelectorAll('#practiceLevel optgroup')].slice(6, 16)
      .map(group => ({ name: group.label, ids: [...group.children].map(el => Number(el.value)) }))), expectedChapters);
    assert.deepEqual(await page(() => [...document.querySelectorAll('#levelList .chapter-name')].slice(6, 16)
      .map(el => ({ name: el.textContent, ids: [...el.nextElementSibling.children].map(btn => Number(btn.dataset.level)) }))), expectedChapters);
    for (const [, first, last, kind] of reorderedChapters) {
      for (const id of [first, last]) {
        await click('#levelList .lv-btn[data-level="' + id + '"]');
        assert.deepEqual(await page(() => [HB.game.state.level.id, HB.game.state.level.kind]), [id, kind]);
      }
    }
    for (const [id, nextKind] of [[60, 'decompose'], [70, 'bonds'], [80, 'multiple']]) {
      await choose(id);
      const tasks = await page(() => HB.game.state.level.tasks.map(task => task.cell));
      for (const cell of tasks) await click('#grid .cell[data-n="' + cell + '"]');
      await wait(() => !document.getElementById('overlay').hidden, 'chapter boundary completion');
      await click('#ovNext');
      assert.deepEqual(await page(() => [HB.game.state.level.id, HB.game.state.level.kind]), [id + 1, nextKind]);
      await screenshot('chapter-next-' + (id + 1));
      await click('#prevBtn');
      assert.equal(await page(() => HB.game.state.level.id), id);
    }
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    console.log('PASS chapter reorder: map/dropdown order, moved chapter boundaries, next/previous and unchanged practice profile');
    const cellStyle = n => page(n => {
      const el = document.querySelector('#grid .cell[data-n="' + n + '"]'), style = getComputedStyle(el);
      return { background: style.backgroundImage, color: style.color, shadow: style.textShadow,
        badge: getComputedStyle(el, '::before').content, outline: parseFloat(style.outlineWidth) };
    }, n);
    for (const material of ['wood', 'acrylic', 'macaron', 'starry']) {
      for (const id of [41, 51]) {
        await choose(id);
        await page(material => HB.board.applyMaterial(material), material);
        const firstTask = await page(() => HB.game.state.level.tasks[0]);
        const origin = await cellStyle(firstTask.start);
        assert.equal(origin.color, 'rgb(255, 255, 255)');
        assert.equal(origin.shadow, 'none');
        assert.match(origin.badge, /起点/);
        assert.ok(origin.outline >= 1);
        assert.notEqual(origin.background, (await cellStyle(firstTask.cell)).background);
        assert.equal(await page(() => document.querySelectorAll('#grid .origin[aria-current="step"]').length), 1);
        if (id === 41) await screenshot('origin-' + material);
        await click('#grid .cell[data-n="' + firstTask.cell + '"]');
        assert.equal(await page(() => Number(document.querySelector('#grid .origin').dataset.n)),
          await page(() => HB.game.state.level.tasks[1].start));
        assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"]').hasAttribute('aria-current'), firstTask.start), false);
      }
      await choose(81);
      await page(material => HB.board.applyMaterial(material), material);
      const multiples = await page(() => HB.game.state.level.tasks.slice(0, 3).map(t => t.cell));
      for (const n of multiples) await click('#grid .cell[data-n="' + n + '"]');
      assert.equal(await page(() => document.querySelectorAll('#grid .answered').length), 3);
      const correctStyle = await cellStyle(multiples[0]);
      assert.equal(correctStyle.color, 'rgb(255, 255, 255)');
      assert.equal(correctStyle.shadow, 'none');
      assert.match(correctStyle.badge, /\u2713/);
      assert.notEqual(correctStyle.background, (await cellStyle(1)).background);
      await screenshot('multiples-' + material);
      await click('#replayBtn');
      assert.equal(await page(() => document.querySelectorAll('#grid .answered').length), 0);
    }
    console.log('PASS highlights: blue/yellow labeled arithmetic origins, persistent green checked multiples, all four materials');
    const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
    const primeBounds = [[1, 10], [11, 20], [21, 40], [41, 60], [61, 100]];
    for (let group = 0; group < 2; group++) for (let stage = 0; stage < 5; stage++) {
      const id = 96 + group * 5 + stage, [min, max] = primeBounds[stage];
      const expected = primes.filter(n => n >= min && n <= max), known = primes.filter(n => n < min);
      await choose(id);
      assert.deepEqual(await page(() => [...document.querySelectorAll('#grid .prime-known')].map(e => Number(e.dataset.n))), known);
      assert.equal(await page(() => [...document.querySelectorAll('#grid .prime-known')].every(e => e.disabled)), true);
      assert.equal(await page(() => document.querySelectorAll('#grid .cell').length), 100);
      if (group === 0) {
        assert.deepEqual(await page(() => [...document.querySelectorAll('#grid .blank')].map(e => Number(e.dataset.n))), expected);
        await click('#grid .cell[data-n="' + expected.at(-1) + '"]');
        const wrong = await page(() => HB.game.state.level.candidates.find(n => n !== HB.game.state.level.answers[HB.game.state.target]));
        await click('.tray-tile[data-n="' + wrong + '"]');
        assert.equal(await page(() => HB.game.state.mistakes), 1);
        while (!(await page(() => HB.game.state.done))) {
          assert.equal(await page(([min, max]) => [...document.querySelectorAll('.tray-tile')].every(e => Number(e.dataset.n) >= min && Number(e.dataset.n) <= max), [min, max]), true);
          const target = await page(() => HB.game.state.target);
          await click('.tray-tile[data-n="' + target + '"]');
          await wait(() => !HB.game.state.busy || HB.game.state.done, 'prime fill lands');
          assert.equal((await cellStyle(target)).color, 'rgb(255, 255, 255)');
        }
      } else {
        assert.equal(await page(() => document.querySelectorAll('#grid .blank, #grid .target, .tray-tile').length), 0);
        await click('#grid .cell[data-n="1"]');
        assert.equal(await page(() => HB.game.state.mistakes), 1);
        await click('#hintBtn');
        assert.equal(await page(() => Number(document.querySelector('#grid .hint').dataset.n)), expected[0]);
        const reversed = expected.slice().reverse();
        for (let i = 0; i < reversed.length; i++) {
          const n = reversed[i];
          await click('#grid .cell[data-n="' + n + '"]');
          assert.equal(await page(() => HB.game.state.filledCount), i + 1);
          if (i === 0) {
            await click('#grid .cell[data-n="' + n + '"]');
            assert.equal(await page(() => HB.game.state.filledCount), 1);
            assert.equal(await page(() => HB.game.state.mistakes), 1);
            assert.equal(await page(() => HB.game.state.target), expected[0]);
          }
        }
        assert.equal(await page(() => document.querySelectorAll('#grid .answered').length), expected.length);
      }
      assert.equal(await page(() => document.querySelectorAll('#grid .prime-known').length), known.length);
      await wait(() => !document.getElementById('overlay').hidden, 'prime completion');
      await click('#ovReplay');
      assert.equal(await page(() => HB.game.state.filledCount), 0);
      if (id === 97 || id === 105) {
        for (const material of ['wood', 'acrylic', 'macaron', 'starry']) {
          await page(material => HB.board.applyMaterial(material), material);
          assert.equal((await cellStyle(2)).color, 'rgb(255, 255, 255)');
          await screenshot('prime-' + id + '-' + material);
        }
      }
    }
    console.log('PASS primes: five fill ranges, five unordered selection ranges, previous highlights, 1 rejection, duplicate protection, hints and replay');
    for (const id of [36, 37, 38, 39, 40]) {
      await choose(id);
      assert.equal(await page(() => HB.game.state.level.reverse), true);
      assert.match(await page(() => document.getElementById('boardTag').textContent), /倒序 100→1/);
      assert.equal(await page(() => [...document.querySelectorAll('#grid .cell:not(.blank):not(.inert)')].every(el => Number(el.querySelector('.num').textContent) === 101 - Number(el.dataset.n))), true);
      const last = await page(() => HB.game.state.level.blanks.at(-1));
      await click('#grid .cell[data-n="' + last + '"]');
      assert.equal(await page(() => HB.game.state.target), last);
      if (id >= 39) {
        assert.equal(await page(() => document.querySelectorAll('#grid .given').length), 1);
        assert.equal(await page(() => [...document.querySelectorAll('#grid .inert')].every(e => e.disabled && getComputedStyle(e).visibility === 'visible' && !e.querySelector('.num').textContent)), true);
      }
      await screenshot('reverse-' + id);
      while (!(await page(() => HB.game.state.done))) {
        const target = await page(() => HB.game.state.target);
        await click('.tray-tile[data-n="' + (101 - target) + '"]');
        await wait(() => !HB.game.state.busy || HB.game.state.done, 'reverse landing');
        assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"] .num').textContent, target), String(101 - target));
      }
      await wait(() => !document.getElementById('overlay').hidden, 'reverse completion');
      await click('#ovReplay');
      assert.equal(await page(() => HB.game.state.filledCount), 0);
    }
    for (const id of [41, 81, 97, 105, 40]) {
      await choose(id);
      if (id === 81 || id === 105) await click('#grid .cell[data-n="' + await page(() => HB.game.state.target) + '"]');
      window.setSize(800, 900);
      await wait(() => innerWidth < 850, 'new feature stacked layout');
      assert.equal((await geometry()).horizontalOverflow, false);
      await page(() => document.getElementById('board').scrollIntoView({ block: 'center' }));
      await screenshot('new-stacked-' + id);
      window.setSize(1440, 1000);
      await wait(() => innerWidth > 1300, 'new feature desktop restore');
    }
    await page(() => HB.board.applyMaterial('wood'));
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    console.log('PASS reverse: all five levels, transformed answers, one-given patterns, completion and responsive layouts');
    assert.deepEqual(await page(() => {
      const group = [...document.getElementById('practiceLevel').querySelectorAll('optgroup')][3];
      return [...group.children].map(option => Number(option.value));
    }), Array.from({ length: 15 }, (_, i) => i + 16));
    const worksheetGivens = [[45], [21, 23, 41, 43], [85], [66], [33], [67], [55], [23], [25], [47],
      [60, 80], [64], [24], [79], [89], [27, 48], [11, 31], [34, 36], [21], [75], [18, 27, 36],
      [22], [48], [31], [73], [47], [89], [55], [55], [60], [86], [37], [12], [31], [36]];
    const visitedQuestions = [];
    for (let id = 21; id <= 30; id++) {
      await choose(id);
      const questionCount = id <= 25 ? 3 : 4;
      for (let questionIndex = 0; questionIndex < questionCount; questionIndex++) {
        const info = await page(() => {
          const s = HB.game.state;
          return { index: s.level.questionIndex, source: s.level.sourceQuestion, active: s.level.activeCells.length,
            givens: [...document.querySelectorAll('#grid .given .num')].map(e => Number(e.textContent)),
            givenDisabled: [...document.querySelectorAll('#grid .given')].every(e => e.disabled),
            buttons: document.querySelectorAll('#grid button.cell').length,
            blanks: document.querySelectorAll('#grid .blank').length,
            inert: document.querySelectorAll('#grid .inert').length,
            inertEmpty: [...document.querySelectorAll('#grid .inert .num')].every(e => e.textContent === ''),
            inertDisabled: [...document.querySelectorAll('#grid .inert')].every(e => e.disabled),
            inertVisible: [...document.querySelectorAll('#grid .inert')].every(e => getComputedStyle(e).visibility === 'visible'),
            prompt: document.getElementById('lvGoal').textContent, overlay: !document.getElementById('overlay').hidden };
        });
        visitedQuestions.push(info.source);
        assert.equal(info.index, questionIndex);
        assert.deepEqual(info.givens, worksheetGivens[info.source - 1], 'Exact PDF given numbers');
        assert.equal(info.givenDisabled, true);
        assert.equal(info.buttons, 100);
        assert.equal(info.blanks, info.active - info.givens.length);
        assert.equal(info.inert, 100 - info.active);
        assert.equal(info.inertEmpty && info.inertDisabled && info.inertVisible, true);
        assert.equal(info.overlay, false, 'No completion overlay between questions');
        assert.ok(info.prompt.includes('PDF 原题 ' + info.source + ' / 35'));
        assert.equal(await page(() => document.querySelectorAll('.tray-tile').length), 10);
        if (questionIndex === 0) {
          const wrong = await page(() => HB.game.state.level.candidates.find(n => n !== HB.game.state.level.answers[HB.game.state.target]));
          const tray = await page(() => HB.game.state.level.candidates.join(','));
          await click('.tray-tile[data-n="' + wrong + '"]');
          assert.equal(await page(() => HB.game.state.mistakes), 1);
          assert.equal(await page(() => HB.game.state.level.candidates.join(',')), tray);
          await click('#hintBtn');
          assert.equal(await page(() => HB.game.state.hintUsed), true);
        }
        const lastBlank = await page(() => HB.game.state.level.blanks.at(-1));
        await click('#grid .cell[data-n="' + lastBlank + '"]');
        assert.equal(await page(() => HB.game.state.target), lastBlank);
        if ([1, 2, 7, 17, 19, 35].includes(info.source)) await screenshot('worksheet-' + info.source);
        if (info.source === 17) {
          assert.ok(info.prompt.includes('跨十片段'));
          window.setSize(800, 900);
          await wait(() => innerWidth < 850, 'worksheet stacked layout');
          assert.equal((await geometry()).horizontalOverflow, false);
          assert.equal((await geometry()).inside, true);
          await page(() => document.getElementById('board').scrollIntoView({ block: 'center' }));
          await screenshot('worksheet-stacked');
          window.setSize(1440, 1000);
          await wait(() => innerWidth > 1300, 'worksheet desktop layout');
        }
        for (let moveIndex = 0; moveIndex < info.blanks; moveIndex++) {
          const move = await page(() => ({ n: HB.game.state.target, answer: HB.game.state.level.answers[HB.game.state.target] }));
          await click('.tray-tile[data-n="' + move.answer + '"]');
          await wait(() => !HB.game.state.busy || HB.game.state.done, 'worksheet landing or next question');
          if (moveIndex < info.blanks - 1 || questionIndex === questionCount - 1) {
            assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"] .num').textContent, move.n), String(move.answer));
          } else {
            assert.equal(await page(() => HB.game.state.level.questionIndex), questionIndex + 1);
            assert.equal(await page(() => HB.game.state.filledCount), 0);
            assert.equal(await page(() => HB.game.state.mistakes), 1);
            assert.equal(await page(() => HB.game.state.hintUsed), true);
            assert.equal(await page(() => HB.game.state.done), false);
          }
        }
      }
      await wait(() => !document.getElementById('overlay').hidden, 'worksheet level completion');
      assert.equal(await page(() => document.getElementById('progressBar').style.width), '100%');
      assert.equal(await page(() => document.getElementById('ovScore').textContent), '本次练习不计积分与星星');
      await click('#ovReplay');
      assert.equal(await page(() => HB.game.state.level.questionIndex), 0);
      assert.equal(await page(() => HB.game.state.mistakes), 0);
    }
    assert.deepEqual(visitedQuestions, Array.from({ length: 35 }, (_, i) => i + 1));
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    console.log('PASS PDF: all 35 original questions, 10 multi-question levels, exact givens, 100 visible cells, tray fills, transitions, replay and practice isolation');
    const results = [];
    for (const id of [26, 36, 46, 101, 111]) {
      await chooseOriginal(id);
      const initial = await page(() => ({ target: HB.game.state.target, prompt: document.getElementById('targetPrompt').textContent,
        blanks: document.querySelectorAll('#grid .blank').length, targets: document.querySelectorAll('#grid .target').length,
        candidates: document.querySelectorAll('.tray-tile').length }));
      assert.equal(initial.blanks, 0);
      assert.equal(initial.targets, 0);
      assert.equal(initial.candidates, 0);
      const wrong = initial.target === 1 ? 2 : 1;
      await click('#grid .cell[data-n="' + wrong + '"]');
      assert.equal(await page(() => HB.game.state.mistakes), 1);
      assert.equal(await page(() => document.getElementById('targetPrompt').textContent), initial.prompt);
      await click('#hintBtn');
      assert.equal(await page(() => document.querySelectorAll('#grid .hint').length), 1);
      await click('#grid .cell[data-n="' + initial.target + '"]');
      assert.equal(await page(() => HB.game.state.filledCount), 1);
      assert.equal(await page(() => document.querySelectorAll('#grid .hint').length), 0);
      if (id === 26) await screenshot('arithmetic');
      const tasks = await page(() => HB.game.state.level.tasks.slice(1).map(t => t.cell));
      for (const cell of tasks) await click('#grid .cell[data-n="' + cell + '"]');
      await wait(() => !document.getElementById('overlay').hidden, 'select completion');
      assert.equal(await page(() => document.getElementById('ovScore').textContent), '本次练习不计积分与星星');
      await click('#ovReplay');
      results.push(id);
    }
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    console.log('PASS native board clicks: arithmetic, multiples, decomposition, bonds, wrong/hint/completion and practice isolation');

    await chooseOriginal(121);
    assert.equal(await page(() => document.querySelectorAll('#grid .coordinate-axis').length), 19);
    assert.equal(await page(() => document.querySelectorAll('#grid .cell').length), 81);
    assert.equal(await page(() => [...document.querySelectorAll('#grid .cell .num')].every(e => e.textContent === '')), true);
    const coordinateTask = await page(() => HB.game.state.level.tasks[0]);
    await click('#grid .cell[data-n="' + (coordinateTask.cell === 1 ? 2 : 1) + '"]');
    assert.equal(await page(() => HB.game.state.filledCount), 0);
    await click('#grid .cell[data-n="' + coordinateTask.cell + '"]');
    assert.equal(await page(cell => document.querySelector('#grid .cell[data-n="' + cell + '"] .animal-name').textContent, coordinateTask.cell), coordinateTask.animal);
    const coordinateLayout = await geometry();
    assert.equal(coordinateLayout.inside, true);
    assert.equal(coordinateLayout.horizontalOverflow, false);
    await screenshot('coordinates-desktop');
    for (const material of ['acrylic', 'starry', 'macaron', 'wood']) {
      await page(material => HB.board.applyMaterial(material), material);
      assert.equal(await page(() => document.querySelectorAll('#grid .animal-face').length), 1);
    }
    window.setSize(960, 800);
    await wait(() => innerWidth < 1000, 'narrow layout');
    assert.equal((await geometry()).inside, true);
    await screenshot('coordinates-narrow');
    window.setSize(800, 900);
    await wait(() => innerWidth < 850, 'stacked layout');
    const stacked = await geometry();
    assert.equal(stacked.horizontalOverflow, false);
    assert.equal(stacked.inside, true);
    await page(() => document.getElementById('board').scrollIntoView({ block: 'center' }));
    await screenshot('coordinates-stacked');
    window.setSize(1440, 1000);
    await wait(() => innerWidth > 1300, 'desktop layout');
    console.log('PASS coordinate axes, blank cells, animal placement, material changes, desktop/narrow/stacked layouts');

    await chooseOriginal(141);
    const schulte = await page(() => ({ values: JSON.stringify(HB.game.state.level.values), tasks: HB.game.state.level.tasks }));
    const first = schulte.tasks[0].cell;
    await click('#grid .cell[data-n="' + schulte.tasks[1].cell + '"]');
    assert.equal(await page(() => HB.game.state.target), first);
    assert.equal(await page(() => document.querySelectorAll('#grid .target').length), 0);
    for (const task of schulte.tasks) await click('#grid .cell[data-n="' + task.cell + '"]');
    await wait(() => !document.getElementById('overlay').hidden, 'Schulte completion');
    assert.match(await page(() => document.getElementById('ovText').textContent), /用时 \d+\.\d 秒/);
    await screenshot('schulte-complete');
    await click('#ovReplay');
    assert.notEqual(await page(() => JSON.stringify(HB.game.state.level.values)), schulte.values);
    await chooseOriginal(150);
    assert.equal(await page(() => document.querySelectorAll('#grid .cell').length), 49);
    await screenshot('schulte-seven');
    console.log('PASS Schulte ordering, timing, replay shuffle, 7x7 board');

    await chooseOriginal(181);
    const table = await page(() => ({
      axes: document.querySelectorAll('#grid .coordinate-axis').length,
      cells: document.querySelectorAll('#grid button.cell').length,
      voids: document.querySelectorAll('#grid .table-void').length,
      numbers: [...document.querySelectorAll('#grid button.cell .num')].map(e => e.textContent),
      targets: document.querySelectorAll('#grid .target').length,
      candidates: document.querySelectorAll('.tray-tile').length
    }));
    assert.equal(table.axes, 19);
    assert.equal(table.cells, 45);
    assert.equal(table.voids, 36);
    assert.equal(table.numbers.every(n => Number(n) >= 1 && Number(n) <= 81), true);
    assert.equal(table.targets, 0);
    assert.equal(table.candidates, 0);
    await screenshot('multiplication-visible');
    const wrongProduct = await page(() => {
      const s = HB.game.state;
      return s.level.activeCells.find(n => s.level.values[n] !== s.level.values[s.target]);
    });
    await click('#grid .cell[data-n="' + wrongProduct + '"]');
    assert.equal(await page(() => HB.game.state.mistakes), 1);
    await click('#hintBtn');
    assert.equal(await page(() => document.querySelectorAll('#grid .hint').length), 1);
    let otherProductCells = 0;
    while (!(await page(() => HB.game.state.done))) {
      const move = await page(() => {
        const s = HB.game.state;
        const other = s.level.activeCells.find(n => n !== s.target && s.level.values[n] === s.level.values[s.target]);
        return { n: other || s.target, other: !!other };
      });
      if (move.other) otherProductCells++;
      await click('#grid .cell[data-n="' + move.n + '"]');
    }
    assert.ok(otherProductCells > 0);
    await wait(() => !document.getElementById('overlay').hidden, 'multiplication selection completion');
    await click('#ovReplay');
    for (const id of [186, 200]) {
      await chooseOriginal(id);
      assert.equal(await page(() => document.querySelectorAll('#grid .blank').length), 45);
      assert.equal(await page(() => [...document.querySelectorAll('#grid button.cell .num, #grid button.cell .q')].every(e => e.textContent === '')), true);
      assert.equal(await page(() => document.querySelectorAll('.tray-tile').length), 10);
      if (id === 186) {
        for (const material of ['wood', 'acrylic', 'macaron', 'starry']) {
          await page(material => HB.board.applyMaterial(material), material);
          assert.equal(await page(() => [...document.querySelectorAll('#grid .table-void')].every(e => getComputedStyle(e).visibility === 'hidden')), true);
          assert.equal((await geometry()).inside, true);
        }
        await page(() => HB.board.applyMaterial('wood'));
        await screenshot('multiplication-hidden');
        window.setSize(960, 800);
        await wait(() => innerWidth < 1000, 'narrow multiplication');
        assert.equal((await geometry()).horizontalOverflow, false);
        assert.equal((await geometry()).inside, true);
        await screenshot('multiplication-narrow');
        window.setSize(800, 900);
        await wait(() => innerWidth < 850, 'stacked multiplication');
        assert.equal((await geometry()).horizontalOverflow, false);
        assert.equal((await geometry()).inside, true);
        window.setSize(1440, 1000);
        await wait(() => innerWidth > 1300, 'restore desktop');
      }
      const old = await page(() => [...document.querySelectorAll('.tray-tile')].map(e => e.dataset.n).join(','));
      const wrong = await page(() => HB.game.state.level.candidates.find(n => n !== HB.game.state.level.answers[HB.game.state.target]));
      await click('.tray-tile[data-n="' + wrong + '"]');
      assert.equal(await page(() => HB.game.state.mistakes), 1);
      assert.equal(await page(() => [...document.querySelectorAll('.tray-tile')].map(e => e.dataset.n).join(',')), old);
      await click('#grid .cell[data-n="81"]');
      assert.equal(await page(() => HB.game.state.target), 81);
      assert.ok(await page(() => HB.game.state.level.candidates.includes(81)));
      while (!(await page(() => HB.game.state.done))) {
        const move = await page(() => ({ n: HB.game.state.target, answer: HB.game.state.level.answers[HB.game.state.target], count: HB.game.state.filledCount }));
        await click('.tray-tile[data-n="' + move.answer + '"]');
        await wait(() => !HB.game.state.busy || HB.game.state.done, 'multiplication landing');
        assert.equal(await page(() => HB.game.state.filledCount), move.count + 1);
        assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"] .num').textContent, move.n), String(move.answer));
        assert.equal(await page(() => document.querySelectorAll('.tray-tile').length), 10);
      }
      await wait(() => !document.getElementById('overlay').hidden, 'multiplication fill completion');
      assert.equal(await page(() => document.getElementById('ovNext').hidden), false);
      assert.equal(await page(() => document.querySelectorAll('#grid .filled').length), 45);
      await click('#ovReplay');
    }
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    console.log('PASS multiplication: lower triangle, axes, equal products, hidden backgrounds, 45 animated fills, wrong/refresh, all materials, responsive layouts and final-level completion');

    await chooseOriginal(180);
    const mazeLayout = await page(() => JSON.stringify([HB.game.state.level.givens, HB.game.state.level.checkpoints]));
    const oldCandidates = await page(() => [...document.querySelectorAll('.tray-tile')].map(t => t.dataset.n).join(','));
    await click('#grid .cell[data-n="100"]');
    assert.equal(await page(() => HB.game.state.head), 1);
    assert.equal(await page(() => [...document.querySelectorAll('.tray-tile')].map(t => t.dataset.n).join(',')), oldCandidates);
    const wrongCandidate = await page(() => [...document.querySelectorAll('.tray-tile')].find(t => !HB.levels.mazeMoves(HB.game.state.level, 1, 0).includes(Number(t.dataset.n))).dataset.n);
    await click('.tray-tile[data-n="' + wrongCandidate + '"]');
    assert.equal(await page(() => HB.game.state.mistakes), 2);
    assert.equal(await page(() => [...document.querySelectorAll('.tray-tile')].map(t => t.dataset.n).join(',')), oldCandidates);
    await screenshot('maze-start');
    let mazeSteps = 0;
    while (!(await page(() => HB.game.state.done))) {
      const move = await page(() => {
        const s = HB.game.state;
        const n = HB.levels.mazeMoves(s.level, s.head, s.checkpointIndex).at(-1);
        return { n, blank: HB.board.isBlank(n) };
      });
      if (move.blank) {
        if (mazeSteps % 2 === 0) await click('#grid .cell[data-n="' + move.n + '"]');
        await click('.tray-tile[data-n="' + move.n + '"]');
        await wait(() => !HB.game.state.busy || HB.game.state.done, 'maze landing');
      } else await click('#grid .cell[data-n="' + move.n + '"]');
      assert.equal(await page(() => HB.game.state.head), move.n);
      assert.equal(await page(() => document.querySelectorAll('.tray-tile').length), 10);
      if (++mazeSteps > 18) throw new Error('Maze exceeded 18 steps');
      if (mazeSteps === 10) await screenshot('maze-path');
    }
    await wait(() => !document.getElementById('overlay').hidden, 'maze completion');
    assert.equal(await page(() => HB.game.state.filledCount === HB.game.state.level.minimumFills), true);
    assert.equal(await page(() => document.querySelectorAll('#grid .path-link').length), 18);
    assert.equal(await page(() => HB.game.state.checkpointIndex === HB.game.state.level.checkpoints.length), true);
    await click('#ovReplay');
    assert.notEqual(await page(() => JSON.stringify([HB.game.state.level.givens, HB.game.state.level.checkpoints])), mazeLayout);
    console.log('PASS maze native clicks/animated fills, wrong answer preserves candidates, selected blanks, minimum route, checkpoints, ten candidates and replay');

    for (const id of [16, 20]) {
      await chooseOriginal(id);
      const info = await page(() => ({
        given: document.querySelectorAll('#grid .cell.given').length,
        blanks: document.querySelectorAll('#grid .cell.blank').length,
        inert: document.querySelectorAll('#grid .cell.inert').length,
        inertDisabled: [...document.querySelectorAll('#grid .cell.inert')].every(e => e.disabled),
        inertEmpty: [...document.querySelectorAll('#grid .cell.inert .num')].every(e => e.textContent === ''),
        inertVisible: [...document.querySelectorAll('#grid .cell.inert')].every(e => getComputedStyle(e).visibility === 'visible'),
        candidates: document.querySelectorAll('.tray-tile').length,
        active: HB.game.state.level.activeCells.length
      }));
      assert.equal(info.given, 1, 'Exactly one provided number');
      assert.equal(info.blanks, info.active - 1, 'Pattern blanks are the rest of the shape');
      assert.equal(info.inert, 100 - info.active, 'Off-pattern cells stay on the board');
      assert.equal(info.inertDisabled, true, 'Off-pattern cells are not selectable');
      assert.equal(info.inertEmpty, true, 'Off-pattern cells show no number');
      assert.equal(info.inertVisible, true, 'Off-pattern cells remain visible');
      assert.equal(info.candidates, 10);
      const old = await page(() => [...document.querySelectorAll('.tray-tile')].map(e => e.dataset.n).join(','));
      const wrong = await page(() => HB.game.state.level.candidates.find(n => n !== HB.game.state.level.answers[HB.game.state.target]));
      await click('.tray-tile[data-n="' + wrong + '"]');
      assert.equal(await page(() => HB.game.state.mistakes), 1, 'Wrong tray pick is a mistake');
      assert.equal(await page(() => [...document.querySelectorAll('.tray-tile')].map(e => e.dataset.n).join(',')), old);
      if (id === 16) await screenshot('pattern-desktop');
      while (!(await page(() => HB.game.state.done))) {
        const move = await page(() => ({ n: HB.game.state.target, answer: HB.game.state.level.answers[HB.game.state.target], count: HB.game.state.filledCount }));
        await click('.tray-tile[data-n="' + move.answer + '"]');
        await wait(() => !HB.game.state.busy || HB.game.state.done, 'pattern landing');
        assert.equal(await page(() => HB.game.state.filledCount), move.count + 1);
        assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"] .num').textContent, move.n), String(move.answer));
      }
      await wait(() => !document.getElementById('overlay').hidden, 'pattern completion');
      assert.equal(await page(() => document.querySelectorAll('#grid .filled').length), info.active - 1);
      await click('#ovReplay');
    }
    console.log('PASS pattern: one given, growing shapes, inert off-pattern cells, tray fill to completion');

    for (const id of [22, 25]) {
      await chooseOriginal(id);
      const info = await page(() => ({
        voids: document.querySelectorAll('#grid .table-void').length,
        buttons: document.querySelectorAll('#grid button.cell').length,
        inert: document.querySelectorAll('#grid .cell.inert').length,
        inertDisabled: [...document.querySelectorAll('#grid .cell.inert')].every(e => e.disabled),
        inertEmpty: [...document.querySelectorAll('#grid .cell.inert .num')].every(e => e.textContent === ''),
        inertVisible: [...document.querySelectorAll('#grid .cell.inert')].every(e => getComputedStyle(e).visibility === 'visible'),
        blanks: document.querySelectorAll('#grid .cell.blank').length,
        givens: HB.game.state.level.givens.length,
        givenDisabled: [...document.querySelectorAll('#grid .cell.given')].every(e => e.disabled),
        candidates: document.querySelectorAll('.tray-tile').length,
        trayHidden: document.getElementById('trayGrid').hidden
      }));
      assert.equal(info.voids, 0, 'No invisible voids on the diagonal levels');
      assert.equal(info.buttons, 100, 'All hundred tiles stay on the board');
      assert.equal(info.inert, 90, 'Ninety off-diagonal tiles are visible but inert');
      assert.equal(info.inertDisabled, true, 'Off-diagonal tiles are not selectable');
      assert.equal(info.inertEmpty, true, 'Off-diagonal numbers are hidden');
      assert.equal(info.inertVisible, true, 'Off-diagonal tiles remain visible');
      assert.equal(info.givenDisabled, true);
      assert.equal(info.blanks + info.givens, 10);
      assert.equal(info.candidates, 10);
      assert.equal(info.trayHidden, false, 'Fill interaction shows the tray');
      if (id === 22) await screenshot('diagonal-desktop');
      while (!(await page(() => HB.game.state.done))) {
        const move = await page(() => ({ n: HB.game.state.target, answer: HB.game.state.level.answers[HB.game.state.target], count: HB.game.state.filledCount }));
        await click('.tray-tile[data-n="' + move.answer + '"]');
        await wait(() => !HB.game.state.busy || HB.game.state.done, 'diagonal landing');
        assert.equal(await page(() => HB.game.state.filledCount), move.count + 1);
        assert.equal(await page(n => document.querySelector('#grid .cell[data-n="' + n + '"] .num').textContent, move.n), String(move.answer));
      }
      await wait(() => !document.getElementById('overlay').hidden, 'diagonal completion');
      assert.equal(await page(() => document.querySelectorAll('#grid .filled').length), 10 - info.givens);
      await click('#ovReplay');
    }
    console.log('PASS diagonal: 90 visible inert tiles, diagonal givens/blanks, tray fill to completion');

    for (const id of [1, 71, 86, 151, 160, 161]) {
      await chooseOriginal(id);
      if (id === 161) {
        assert.equal(await page(() => HB.game.state.level.kind), 'maze');
        continue;
      }
      const answer = await page(() => HB.game.state.level.answers[HB.game.state.target]);
      await click('.tray-tile[data-n="' + answer + '"]');
      await wait(() => HB.game.state.filledCount === 1, 'legacy landing');
      assert.equal(await page(() => document.querySelectorAll('.tray-tile').length), 10);
      if (await page(() => HB.game.state.done)) {
        await wait(() => !document.getElementById('overlay').hidden, 'legacy completion');
        await click('#ovReplay');
      }
    }
    assert.equal(await page(() => JSON.stringify(HB.store.data)), originalProfile);
    await click('#randomLevelBtn');
    assert.equal(await page(() => HB.game.state.mode), 'random');
    await click('#freeModeToggle');
    assert.equal(await page(() => HB.game.state.mode), 'normal');
    assert.equal(await page(() => HB.game.state.level.id), 1);
    await wait(() => HB.store.status === 'saved', 'profile saved');
    const supportProfile = await page(() => JSON.stringify(HB.store.data));
    const supportPlacement = await page(() => {
      const title = document.querySelector('.settings-title');
      const label = title.querySelector('span').getBoundingClientRect();
      const actions = title.querySelector('.support-actions').getBoundingClientRect();
      const follow = document.getElementById('followBtn').getBoundingClientRect();
      const donate = document.getElementById('donateBtn').getBoundingClientRect();
      return { inTitle: title.contains(document.getElementById('followBtn')) && title.contains(document.getElementById('donateBtn')),
        labelRight: label.right, titleRight: title.getBoundingClientRect().right, actionsRight: actions.right,
        followLeft: follow.left, donateLeft: donate.left, sameRow: Math.abs(label.top - follow.top) < 12 };
    });
    assert.equal(supportPlacement.inTitle, true);
    assert.ok(supportPlacement.followLeft >= supportPlacement.labelRight);
    assert.ok(supportPlacement.donateLeft > supportPlacement.followLeft);
    assert.ok(Math.abs(supportPlacement.actionsRight - supportPlacement.titleRight) <= 1);
    assert.equal(supportPlacement.sameRow, true);
    await screenshot('settings-support-desktop');
    for (const [name, button, title] of [['follow', 'followBtn', '关注'], ['donate', 'donateBtn', '捐赠']]) {
      await click('#' + button);
      assert.equal(await page(() => document.getElementById('supportDialog').open), true);
      assert.match(await page(() => document.getElementById('supportTitle').textContent), new RegExp(title));
      if (name === 'follow') assert.match(await page(() => document.getElementById('supportNote').textContent), /请备注“百数板”/);
      assert.match(await page(() => document.getElementById('supportImage').getAttribute('src')), new RegExp('assets/' + name + '\\.jpg$'));
      if (missingSupport.has(name)) {
        await wait(() => !document.getElementById('supportError').hidden, 'missing image notice');
      } else {
        await wait(() => document.getElementById('supportImage').naturalWidth > 0, 'original image loaded');
        assert.equal(await page(() => getComputedStyle(document.getElementById('supportImage')).objectFit), 'contain');
      }
      const dialogGeometry = await page(() => {
        const dialog = document.getElementById('supportDialog'), rect = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return { width: rect.width, height: rect.height, visible: style.display !== 'none' && style.visibility !== 'hidden',
          inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          hit: dialog.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
      });
      assert.ok(dialogGeometry.width > 200 && dialogGeometry.height > 100);
      assert.equal(dialogGeometry.visible, true);
      assert.equal(dialogGeometry.inside, true);
      assert.equal(dialogGeometry.hit, true, 'dialog paints above the game');
      await screenshot('support-' + name);
      if (name === 'follow') await click('#closeSupportBtn');
      else {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      }
      await wait(() => !document.getElementById('supportDialog').open, 'support dialog closes');
      assert.equal(await page(() => document.activeElement.id), button);
      assert.equal(await page(() => JSON.stringify(HB.store.data)), supportProfile);
    }
    await click('#followBtn');
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 4, y: 4 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 4, y: 4 });
    await wait(() => !document.getElementById('supportDialog').open, 'support backdrop closes');
    if (missingSupport.size) console.log('BLOCKED original image display: missing ' + [...missingSupport].join(', ') + '. Missing-file notices and close/focus behavior verified; no substitute QR used.');
    else console.log('PASS original support images, modal closing, focus restoration and unchanged profile');

    const originalPlayer = await page(() => ({ id: HB.store.data.id, count: HB.store.players.length }));
    const accountActionsPlacement = await page(() => {
      const heading = document.querySelector('.account-heading');
      const label = heading.querySelector('label').getBoundingClientRect();
      const deactivate = document.getElementById('deactivatePlayerBtn').getBoundingClientRect();
      const create = document.getElementById('createPlayerBtn').getBoundingClientRect();
      return { inHeading: heading.contains(document.getElementById('deactivatePlayerBtn')),
        labelRight: label.right, deactivateLeft: deactivate.left, deactivateRight: deactivate.right,
        createRight: create.right, sameRow: Math.abs(label.top - deactivate.top) < 12 };
    });
    assert.equal(accountActionsPlacement.inHeading, true);
    assert.ok(accountActionsPlacement.deactivateLeft >= accountActionsPlacement.labelRight);
    assert.ok(Math.abs(accountActionsPlacement.deactivateRight - accountActionsPlacement.createRight) <= 1);
    assert.equal(accountActionsPlacement.sameRow, true);
    assert.equal(await page(() => document.getElementById('manageDeactivatedBtn').hidden), false);
    assert.equal(await page(() => document.getElementById('deactivatedPlayerCount').textContent), '0');
    await page(() => { document.getElementById('newPlayerName').value = '   '; });
    await click('#createPlayerBtn');
    assert.equal(await page(() => HB.store.players.length), originalPlayer.count);
    await page(() => { document.getElementById('newPlayerName').value = '界面小玩家'; });
    await click('#createPlayerBtn');
    await wait(() => HB.store.data.name === '界面小玩家' && HB.store.status === 'saved' && !HB.game.state.busy, 'create styled account');
    assert.equal(await page(() => HB.store.players.length), originalPlayer.count + 1);
    await click('#avatarBtn');
    await click('#avatarPicker button:nth-child(2)');
    await wait(() => HB.store.status === 'saved', 'avatar saved');
    assert.equal(await page(() => document.getElementById('avatarPicker').hidden), true);
    await page(id => {
      const select = document.getElementById('playerSelect');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, originalPlayer.id);
    await wait(() => HB.store.data.name === '小玩家' && HB.store.status === 'saved' && !HB.game.state.busy, 'switch original account');
    assert.equal(await page(() => HB.store.data.id), originalPlayer.id);
    assert.equal(await page(() => JSON.stringify(HB.store.data)), supportProfile);

    await click('#deactivatePlayerBtn');
    assert.equal(await page(() => document.getElementById('accountConfirmDialog').open), true);
    assert.match(await page(() => document.getElementById('accountConfirmTitle').textContent), /注销/);
    await click('#accountConfirmCancel');
    await wait(() => !document.getElementById('accountConfirmDialog').open, 'cancel account deactivation');
    assert.equal(await page(() => HB.store.data.id), originalPlayer.id);

    await click('#deactivatePlayerBtn');
    await click('#accountConfirmBtn');
    await wait(() => HB.store.data.name === '界面小玩家' && HB.store.status === 'saved' && !HB.game.state.busy, 'deactivate current account');
    assert.equal(await page(id => [...document.getElementById('playerSelect').options].some(option => option.value === id), originalPlayer.id), false);
    assert.equal(await page(id => HB.store.players.find(player => player.id === id).deactivated, originalPlayer.id), true);
    assert.equal(await page(() => document.getElementById('manageDeactivatedBtn').hidden), false);

    await click('#manageDeactivatedBtn');
    assert.equal(await page(() => document.getElementById('deactivatedPlayersDialog').open), true);
    assert.equal(await page(id => !!document.querySelector('.deactivated-delete-btn[data-player-id="' + id + '"]'), originalPlayer.id), true);
    await click('.deactivated-delete-btn[data-player-id="' + originalPlayer.id + '"]');
    assert.equal(await page(() => document.getElementById('accountConfirmDialog').open), true);
    assert.match(await page(() => document.getElementById('accountConfirmTitle').textContent), /永久删除/);
    await click('#accountConfirmCancel');
    await wait(() => !document.getElementById('accountConfirmDialog').open, 'cancel permanent deletion');
    assert.equal(await page(id => HB.store.players.some(player => player.id === id), originalPlayer.id), true);

    await click('#manageDeactivatedBtn');
    await click('.deactivated-delete-btn[data-player-id="' + originalPlayer.id + '"]');
    await click('#accountConfirmBtn');
    await wait(() => HB.store.status === 'saved' && !HB.store.players.some(player => player.deactivated === true), 'permanently delete deactivated account');
    assert.equal(await page(id => HB.store.players.some(player => player.id === id), originalPlayer.id), false);
    assert.equal(await page(() => document.getElementById('playerSelect').value), await page(() => HB.store.data.id));
    assert.equal(await page(() => document.getElementById('manageDeactivatedBtn').hidden), false);
    assert.equal(await page(() => document.getElementById('deactivatedPlayerCount').textContent), '0');
    await click('#manageDeactivatedBtn');
    assert.equal(await page(() => document.getElementById('deactivatedPlayersDialog').open), true);
    assert.equal(await page(() => !!document.querySelector('.deactivated-empty')), true);
    await click('#closeDeactivatedBtn');
    assert.equal(await page(() => document.getElementById('deactivatedPlayersDialog').open), false);
    assert.equal(await page(() => HB.store.players.length), originalPlayer.count);

    await page(() => { document.querySelector('.sidebar').scrollTop = 0; });
    await wait(() => HB.store.status === 'saved', 'account screenshot save state');
    await screenshot('account-desktop');
    window.setSize(800, 900);
    await wait(() => innerWidth < 850, 'stacked account');
    assert.equal(await page(() => document.documentElement.scrollWidth <= innerWidth), true);
    const narrowSupportPlacement = await page(() => {
      const title = document.querySelector('.settings-title');
      const label = title.querySelector('span').getBoundingClientRect();
      const follow = document.getElementById('followBtn').getBoundingClientRect();
      return { inTitle: title.contains(document.getElementById('followBtn')), sameRow: Math.abs(label.top - follow.top) < 12 };
    });
    assert.equal(narrowSupportPlacement.inTitle, true);
    assert.equal(narrowSupportPlacement.sameRow, true);
    await screenshot('account-stacked');

    // ---------- 授权文件导出/导入 + 单机绑定篡改检测 ----------
    const exported = await page(() => HB.license.exportFile());
    assert.equal(JSON.parse(exported).app, 'hundred-board-license');
    assert.equal(JSON.parse(exported).record.payload.s, 'TEST-UI-1');
    const foreign = JSON.parse(exported);
    foreign.record.machineId = 'another-machine-id-000000';
    assert.match(await page(text => HB.license.importFile(text).then(() => 'ok', e => e.message), JSON.stringify(foreign)), /另一台设备/);
    assert.equal(await page(text => HB.license.importFile(text).then(() => HB.license.status().active), exported), true, '本机授权文件可重复导入');
    await page(() => {
      const rec = JSON.parse(localStorage.getItem('hundred-board-license-v1'));
      rec.machineId = 'tampered-machine-id-000000';
      localStorage.setItem('hundred-board-license-v1', JSON.stringify(rec));
    });
    await page(() => HB.license.load());
    assert.equal(await page(() => HB.license.status().reason), 'machine');
    assert.equal(await page(() => HB.license.status().active), false);
    assert.equal(await page(() => HB.license.canPlay(21)), false, '绑定被篡改后付费关重新上锁');
    assert.equal(await page(text => HB.license.importFile(text).then(() => HB.license.status().active), exported), true, '导入正确授权文件恢复激活');
    assert.equal(await page(() => HB.license.canPlay(21)), true);

    // ---------- 绑定码：他机绑定码被拒、本机绑定码可激活、复制设备码 ----------
    const mid = await page(() => HB.license.machineId());
    await click('#licenseActivateBtn');
    await wait(() => document.getElementById('licenseDialog').open, 'dialog open for bound-code test');
    await page(code => { document.getElementById('licenseCode').value = code; }, issueCode('BOUND-OTHER', 'some-other-machine-id-0001'));
    await click('#licenseConfirmBtn');
    await wait(() => !document.getElementById('licenseError').hidden, 'foreign bound code shows error');
    assert.match(await page(() => document.getElementById('licenseError').textContent), /另一台设备/);
    await page(code => { document.getElementById('licenseCode').value = code; }, issueCode('BOUND-OWN', mid));
    await click('#licenseConfirmBtn');
    await wait(() => !document.getElementById('licenseDialog').open && HB.license.status().active, 'own bound code activates');
    assert.match(await page(() => document.getElementById('licenseStatus').textContent), /（已激活）激活码 BOUND-OWN/);
    await click('#licenseCopyMachineBtn');
    await wait(() => HB.license.status().active, 'copy device code does not disturb activation');
    console.log('PASS license file export/import, foreign-machine rejection, machine-binding tamper detection, bound-code gate and copy-device-code');

    assert.deepEqual(await page(() => __uiErrors), []);
    assert.deepEqual(consoleErrors, []);
    console.log('PASS styled account create/blank-name rejection/avatar/switch/deactivation/deletion confirmations, support placement, legacy regression, mode return and zero unexpected browser errors');
    console.log('All available Chromium UI checks passed; missing original assets, if reported, remain unverified.');
  } catch (error) {
    await screenshot('failure');
    console.error(error.stack || error);
    console.error(await page(() => ({ id: HB.game?.state.level?.id, target: HB.game?.state.target, busy: HB.game?.state.busy, errors: window.__uiErrors })));
    window.destroy();
    app.exit(1);
    return;
  }
  window.destroy();
  app.exit(0);
}
