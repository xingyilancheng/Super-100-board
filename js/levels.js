/* 220 关：fill 填数，select 点选，maze 最少补数，race 双人答题竞速。 */
(function () {
  'use strict';
  window.HB = window.HB || {};

  /* ---------- 随机工具（默认按关卡 id 固定种子，可显式传 seed 生成变体） ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function R(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function shuffle(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function numAt(r, c) { return r * 10 + c + 1; }
  function rowOf(n) { return Math.floor((n - 1) / 10); }
  function colOf(n) { return (n - 1) % 10; }

  /* ---------- 空格图案生成器 ---------- */
  var G = {
    single: function (rng) { return [numAt(R(rng, 1, 9), R(rng, 0, 9))]; },

    scatter: function (rng, k) {
      var set = {};
      while (Object.keys(set).length < k) set[numAt(R(rng, 0, 9), R(rng, 0, 9))] = 1;
      return Object.keys(set).map(Number);
    },

    run: function (rng, k) {
      var r = R(rng, 0, 9), c = R(rng, 0, 10 - k), out = [];
      for (var i = 0; i < k; i++) out.push(numAt(r, c + i));
      return out;
    },

    twoRuns: function (rng) {
      var r = R(rng, 0, 8), c = R(rng, 0, 5), out = [];
      for (var i = 0; i < 5; i++) out.push(numAt(r, c + i), numAt(r + 1, c + i));
      return out;
    },

    perRow: function (rng, k) {
      var rows = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k);
      return rows.map(function (r) { return numAt(r, R(rng, 0, 9)); });
    },

    fullRow: function (rng) {
      var r = R(rng, 1, 8), out = [];
      for (var c = 0; c < 10; c++) out.push(numAt(r, c));
      return out;
    },

    fullCol: function (rng) {
      var c = R(rng, 0, 9), out = [];
      for (var r = 0; r < 10; r++) out.push(numAt(r, c));
      return out;
    },

    plus10: function (rng, k) {
      var r = R(rng, 0, 8);
      var cols = shuffle(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, k);
      return cols.map(function (c) { return numAt(r + 1, c); });
    },

    cross: function (rng) {
      var n = numAt(R(rng, 1, 8), R(rng, 1, 8));
      return [n - 10, n - 1, n, n + 1, n + 10];
    },

    skip2: function (rng) {
      var r = R(rng, 0, 9), parity = R(rng, 0, 1), out = [];
      for (var c = parity; c < 10; c += 2) out.push(numAt(r, c));
      return out;
    },

    skip2col: function (rng) {
      var c = R(rng, 0, 9), r0 = R(rng, 0, 1), out = [];
      for (var i = 0; i < 5; i++) out.push(numAt(r0 + i * 2, c));
      return out;
    },

    skip2diag: function (rng) {
      var r0 = R(rng, 0, 5), c0 = R(rng, 0, 5), out = [];
      for (var i = 0; i < 5; i++) out.push(numAt(r0 + i, c0 + i));
      return out;
    },

    mixJump: function (rng) {
      var r = R(rng, 0, 9), c0 = R(rng, 0, 5);
      var horiz = [numAt(r, c0), numAt(r, c0 + 2), numAt(r, c0 + 4)];
      var r2 = R(rng, 0, 5), c = R(rng, 0, 9), guard = 0, vert;
      do {
        vert = [numAt(r2, c), numAt(r2 + 2, c), numAt(r2 + 4, c)];
        c = (c + 1) % 10;
      } while (vert.some(function (n) { return horiz.indexOf(n) >= 0; }) && guard++ < 12);
      return horiz.concat(vert);
    },

    doubleRowSkip: function (rng) {
      var r = R(rng, 0, 8), out = [];
      for (var i = 0; i < 5; i++) out.push(numAt(r, 1 + i * 2), numAt(r + 1, 1 + i * 2));
      return out;
    },

    scatter10: function (rng) {
      var set = {};
      while (Object.keys(set).length < 10) set[numAt(R(rng, 0, 9), R(rng, 0, 9))] = 1;
      return Object.keys(set).map(Number);
    },
  };

  /* ---------- 25 关目录 ---------- */
  var LEVELS = [
    { name: '认识新朋友', goal: '数字迷路啦，把它送回自己的格子', gen: ['single'], decoys: 9 },
    { name: '三个小伙伴', goal: '三个数字一起迷路了，帮它们回家', gen: ['scatter', 3], decoys: 7 },
    { name: '排队小火车', goal: '一行里连着少了 5 个数字，按顺序补好', gen: ['run', 5], decoys: 5 },
    { name: '散落的小星星', goal: '数字散落在棋盘各处，找找它们的位置', gen: ['scatter', 5], decoys: 5 },
    { name: '每行一位', goal: '每一行都藏着一个数字，看看都在哪', gen: ['perRow', 5], decoys: 5 },

    { name: '消失的一整行', goal: '一整行不见了：同一行里，右边比左边大 1', gen: ['fullRow'], decoys: 0 },
    { name: '消失的一整列', goal: '一整列不见了：往下一格就大 10', gen: ['fullCol'], decoys: 0 },
    { name: '下面的邻居', goal: '下面一行 = 上面一行 + 10', gen: ['plus10', 5], decoys: 5 },
    { name: '连续小分队', goal: '两行各有一支连续小队，连续的数相差 1', gen: ['twoRuns'], decoys: 0 },
    { name: '十字路口', goal: '中间数字的上下左右邻居都躲起来了', gen: ['cross'], decoys: 5 },

    { name: '跳着数 2', goal: '2、4、6、8、10，隔着数也能找到家', gen: ['skip2'], decoys: 5 },
    { name: '竖着跳 2', goal: '同一列隔一行跳：相邻两个数相差 20', gen: ['skip2col'], decoys: 5 },
    { name: '斜着跳 2', goal: '斜着隔一格跳：往右下跳，相邻两个数相差 11', gen: ['skip2diag'], decoys: 5 },
    { name: '双行跳数', goal: '两行一起跳着数，看仔细哦', gen: ['doubleRowSkip'], decoys: 0 },
    { name: '跳跳混合', goal: '有的横着隔一格跳相差 2，有的竖着隔一行跳相差 20', gen: ['mixJump'], decoys: 4 },

    { kind: 'pattern', shape: 'plus', name: '十字补数', goal: '中间提供一个数：从候选数字里选出它上、下、左、右四个邻居，填进十字的空格。' },
    { kind: 'pattern', shape: 'row', name: '横条补数', goal: '横条里提供一个数：左右相邻相差 1，从候选数字补全这一横条。' },
    { kind: 'pattern', shape: 'col', name: '竖条补数', goal: '竖条里提供一个数：上下相邻相差 10，从候选数字补全这一竖条。' },
    { kind: 'pattern', shape: 'corner', name: '拐角补数', goal: '拐角提供一个数：横着相差 1、竖着相差 10，从候选数字补全整个拐角。' },
    { kind: 'pattern', shape: 'block', name: '方块补数', goal: '方块里提供一个数：横着相差 1、竖着相差 10，从候选数字补全 3×3 方块。' },

    { name: '随机挑战', goal: '棋盘上随机消失了 10 个数字', gen: ['scatter10'], decoys: 0 },
    { kind: 'diagonal', dir: 'main', givenCount: 4, name: '主对角线补数 · 1', goal: '左上到右下的对角线：每往右下走一格 +11。按提供的数字补全其余对角线格，其他格子不参与。' },
    { kind: 'diagonal', dir: 'main', givenCount: 3, name: '主对角线补数 · 2', goal: '左上到右下的对角线：每往右下走一格 +11。按提供的数字补全其余对角线格，其他格子不参与。' },
    { kind: 'diagonal', dir: 'anti', givenCount: 4, name: '反对角线补数 · 1', goal: '右上到左下的对角线：每往左下走一格 +9。按提供的数字补全其余对角线格，其他格子不参与。' },
    { kind: 'diagonal', dir: 'anti', givenCount: 3, name: '反对角线补数 · 2', goal: '右上到左下的对角线：每往左下走一格 +9。按提供的数字补全其余对角线格，其他格子不参与。' }
  ];

  function range(first, last) {
    var out = [];
    for (var n = first; n <= last; n++) out.push(n);
    return out;
  }
  function isPrime(n) {
    if (n < 2) return false;
    for (var d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  }

  var PRIME_RANGES = [[1, 10], [11, 20], [21, 40], [41, 60], [61, 100]];
  var STEPS = [1, 10, 9, 11, 2, 3, 4, 5, 20, 12];
  var DECOMPOSE_MAX = [5, 6, 7, 8, 9, 10, 12, 15, 20, 30];
  var BOND_TARGETS = [5, 10, 10, 20, 20, 30, 40, 50, 60, 100];
  var SCHULTE_SIZES = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
  var FACTORS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 3, 4, 6, 7, 8, 9];
  var SUDOKU_HOLES = [[4, 6, 8, 9, 10], [10, 14, 18, 20, 22], [24, 32, 40, 46, 50]];
  LEVELS.forEach(function (def) { def.kind = def.kind || 'hundred'; def.size = def.size || 10; });
  ['addition', 'subtraction'].forEach(function (kind) {
    STEPS.forEach(function (step, stage) {
      var label = kind === 'addition' ? '加法' : '减法';
      LEVELS.push({ kind: kind, interaction: 'select', size: 10, stage: stage, step: step, maxNumber: 100,
        name: label + ' ' + step + ' · ' + (stage + 1),
        goal: '从起点数字出发，每次' + (kind === 'addition' ? '加' : '减') + ' ' + step + '，直接点选百数板上的得数。' });
    });
  });
  FACTORS.forEach(function (factor, stage) {
    var max = stage < 9 ? (stage + 2) * 10 : 100;
    LEVELS.push({ kind: 'multiple', interaction: 'select', size: 10, stage: stage, factor: factor, maxNumber: max,
      name: factor + ' 的倍数 · ' + (stage + 1),
      goal: '在 1～' + max + ' 中，按从小到大的顺序点选 ' + factor + ' 的所有正倍数。' });
  });
  ['fill', 'select'].forEach(function (interaction, group) {
    PRIME_RANGES.forEach(function (bounds, stage) {
      var interval = bounds[0] + '～' + bounds[1];
      LEVELS.push({ kind: 'prime', interaction: interaction, size: 10, stage: group * 5 + stage,
        minNumber: bounds[0], maxNumber: bounds[1],
        name: '质数' + (interaction === 'fill' ? '选填' : '点选') + ' ' + interval + ' · ' + (stage + 1),
        goal: (interaction === 'fill' ? '从候选数字中选填 ' : '在百数板上任意顺序点出 ') + interval +
          ' 中的全部质数。质数恰好有两个正因数，1 不是质数。此前区间的质数保持高亮，不用再答。' });
    });
  });
  [4, 6, 9].forEach(function (size, group) {
    for (var stage = 0; stage < 5; stage++) {
      var br = size === 9 ? 3 : 2, bc = size / br;
      LEVELS.push({ kind: 'sudoku', size: size, boxRows: br, boxCols: bc,
        holes: SUDOKU_HOLES[group][stage],
        name: size + '×' + size + ' 数独 · ' + (stage + 1),
        goal: '只用 1～' + size + '，每行、每列、每个 ' + br + '×' + bc + ' 宫内数字不重复。候选中大于 ' + size + ' 的数字是干扰项；每关只有一个解。' });
    }
  });
  for (var stage = 0; stage < 15; stage++) {
    var mineCount = 8 + stage;
    LEVELS.push({ kind: 'mines', size: 10, mineCount: mineCount, safeHoles: 10 + stage * 2,
      name: '雷区推理课堂 · ' + (stage + 1),
      goal: '共 ' + mineCount + ' 颗雷。0～8 表示周围八格（含斜角）的雷数；“雷”（-1）标记地雷。仅用可见数字和总雷数，推理并填写所有空格。这是教学填数，不是点击翻开的经典扫雷，不需猜测或试踩。' });
  }
  DECOMPOSE_MAX.forEach(function (max, stage) {
    LEVELS.push({ kind: 'decompose', interaction: 'select', size: 10, stage: stage, maxNumber: max,
      name: '数字分解 · ' + (stage + 1),
      goal: '把 ' + max + ' 以内的数分成两个正数，点选缺少的那一部分。' });
  });
  BOND_TARGETS.forEach(function (target, stage) {
    LEVELS.push({ kind: 'bonds', interaction: 'select', size: 10, stage: stage, target: target,
      name: '一起凑 ' + target + ' · ' + (stage + 1),
      goal: '已有一些，还差多少？点选需要再添的正数，凑成 ' + target + '。' });
  });
  for (var coordinateStage = 0; coordinateStage < 10; coordinateStage++) {
    LEVELS.push({ kind: 'coordinate', interaction: 'select', size: 9, stage: coordinateStage,
      name: '动物坐标乐园 · ' + (coordinateStage + 1),
      goal: '帮小动物找位置：横坐标 x 从左往右数，纵坐标 y 从上往下数，都从 1 数到 9。' });
  }
  for (var mazeStage = 0; mazeStage < 10; mazeStage++) {
    LEVELS.push({ kind: 'maze', interaction: 'maze', size: 10, stage: mazeStage,
      name: '最少补数迷宫 · ' + (mazeStage + 1),
      goal: '从 1 到 100，只能向右或向下走一格，按顺序经过打卡点。已有数字免费经过，其余格子补入数字；选择补数最少的走法。' });
  }
  SCHULTE_SIZES.forEach(function (size, stage) {
    LEVELS.push({ kind: 'schulte', interaction: 'select', size: size, stage: stage,
      name: size + '×' + size + ' 舒尔特方格 · ' + (stage + 1),
      goal: '数字的位置打乱啦！从 1 到 ' + (size * size) + '，按顺序找到并点选每个数字。' });
  });
  // 只在末尾扩展，保留原 150 关的编号、默认种子和生成过程。
  for (var mineStage = 0; mineStage < 10; mineStage++) {
    var extraMineCount = 18 + mineStage;
    LEVELS.push({ kind: 'mines', size: 10, stage: 15 + mineStage,
      mineCount: extraMineCount, safeHoles: 20 + mineStage * 2,
      name: '雷区推理课堂 · ' + (16 + mineStage),
      goal: '共 ' + extraMineCount + ' 颗雷。0～8 表示周围八格（含斜角）的雷数；“雷”（-1）标记地雷。仅用可见数字和总雷数，推理并填写所有空格。这是教学填数，不是点击翻开的经典扫雷，不需猜测或试踩。' });
  }
  for (var extraMazeStage = 10; extraMazeStage < 30; extraMazeStage++) {
    LEVELS.push({ kind: 'maze', interaction: 'maze', size: 10, stage: extraMazeStage,
      name: '最少补数迷宫 · ' + (extraMazeStage + 1),
      goal: '从 1 到 100，只能向右或向下走一格，按顺序经过打卡点。已有数字免费经过，其余格子补入数字；选择补数最少的走法。' });
  }
  for (var multiplicationStage = 0; multiplicationStage < 20; multiplicationStage++) {
    var selecting = multiplicationStage < 5;
    LEVELS.push({ kind: 'multiplication', interaction: selecting ? 'select' : 'fill', size: 9,
      stage: multiplicationStage,
      name: '乘法口诀' + (selecting ? '点选' : '填表') + ' · ' + (multiplicationStage + 1),
      goal: selecting ? '计算横坐标 x × 纵坐标 y，点击下三角（含对角线）中任意一个乘积相同的格子都算正确。' :
        '填满下三角（含对角线）的 45 个空格：横坐标 x × 纵坐标 y。按提示依次填写，也可点击任意空格切换目标。' });
  }
  var WORKSHEET_QUESTIONS = [
    { rows: [[34, 35, 36], [44, 45, 46], [54, 55, 56]], givens: [45] },
    { rows: [[21, 22, 23], [31, 32, 33], [41, 42, 43]], givens: [21, 23, 41, 43] },
    { rows: [[74, 75, 76], [84, 85, 86], [94, 95, 96]], givens: [85] },
    { rows: [[55, 56, 57], [65, 66, 67], [75, 76, 77]], givens: [66] },
    { rows: [[23, 24, 0], [33, 34, 35], [43, 44, 0]], givens: [33] },
    { rows: [[0, 57, 0], [66, 67, 68], [0, 77, 0]], givens: [67] },
    { rows: [[55, 0, 0], [0, 66, 67], [0, 76, 0]], givens: [55] },
    { rows: [[11, 12, 0], [21, 22, 23], [0, 0, 33]], givens: [23] },
    { rows: [[14, 15, 16], [24, 25, 26], [34, 35, 36]], givens: [25] },
    { rows: [[25, 26, 27], [35, 36, 37], [45, 46, 47]], givens: [47] },
    { rows: [[58, 59, 60], [68, 69, 70], [78, 79, 80]], givens: [60, 80] },
    { rows: [[0, 0, 45], [53, 54, 55], [63, 64, 0]], givens: [64] },
    { rows: [[0, 0, 15], [23, 24, 25], [33, 0, 0]], givens: [24] },
    { rows: [[58, 59, 60], [68, 69, 70], [78, 79, 80]], givens: [79] },
    { rows: [[0, 79, 80], [88, 89, 90], [0, 99, 0]], givens: [89] },
    { rows: [[27, 28, 29], [37, 38, 39], [47, 48, 49]], givens: [27, 48] },
    // 原题横排跨十，保留片段相对位置，不按百数板边界折行。
    { rows: [[10, 11, 12], [20, 21, 22], [30, 31, 32]], givens: [11, 31], origin: [0, 3] },
    { rows: [[24, 25, 26], [34, 35, 36], [44, 45, 46]], givens: [34, 36] },
    { rows: [[21, 0, 23], [0, 32, 0], [41, 0, 43]], givens: [21] },
    { rows: [[64, 65, 66], [74, 75, 76], [84, 85, 86]], givens: [75] },
    { rows: [[16, 17, 18], [26, 27, 28], [36, 37, 38]], givens: [18, 27, 36] },
    { rows: [[22, 23, 24], [32, 0, 0], [42, 0, 0]], givens: [22] },
    { rows: [[27, 0, 0, 0], [37, 0, 0, 0], [47, 48, 49, 50]], givens: [48] },
    { rows: [[0, 22, 23], [31, 32, 33]], givens: [31] },
    { rows: [[0, 0, 54], [0, 0, 64], [72, 73, 74]], givens: [73] },
    { rows: [[46, 47, 0], [56, 0, 0], [66, 67, 68]], givens: [47] },
    { rows: [[78, 0, 0], [88, 89, 0], [98, 99, 100]], givens: [89] },
    { rows: [[52, 0, 0, 55], [62, 0, 0, 65], [72, 73, 74, 75]], givens: [55] },
    { rows: [[35, 36], [45, 46], [55, 56]], givens: [55] },
    { rows: [[57, 58, 59, 60], [0, 0, 0, 70], [77, 78, 79, 80]], givens: [60] },
    { rows: [[0, 66, 0], [75, 76, 77], [0, 86, 0]], givens: [86] },
    { rows: [[24, 0, 26, 0], [34, 35, 36, 37], [44, 0, 46, 0]], givens: [37] },
    { rows: [[12, 13, 14], [22, 23, 24]], givens: [12] },
    { rows: [[31, 32, 33], [41, 0, 0], [51, 0, 0]], givens: [31] },
    { rows: [[0, 0, 0, 19], [0, 0, 0, 29], [36, 37, 38, 39]], givens: [36] }
  ];
  var worksheetFrom = 1;
  for (var worksheetStage = 0; worksheetStage < 10; worksheetStage++) {
    var questionCount = worksheetStage < 5 ? 3 : 4;
    LEVELS.splice(20 + worksheetStage, 0, {
      kind: 'pattern', size: 10, questionFrom: worksheetFrom, questionCount: questionCount,
      name: 'PDF 图案补数 · ' + (worksheetStage + 1),
      goal: '原题 ' + worksheetFrom + '～' + (worksheetFrom + questionCount - 1) + '，共 ' + questionCount + ' 题。依次从候选数字中补全每个图案。'
    });
    worksheetFrom += questionCount;
  }
  LEVELS.splice(35, 0,
    { kind: 'hundred', size: 10, reverse: true, gen: ['scatter', 3], name: '倒序百数板 · 数字回家',
      goal: '左上角 100，右下角 1。向右一格 -1，向下一格 -10；补回三个散落的数字。' },
    { kind: 'hundred', size: 10, reverse: true, gen: ['fullRow'], name: '倒序百数板 · 一行邻居',
      goal: '左上角 100，右下角 1。向右一格 -1，向下一格 -10；用上下左右的邻居补全一行。' },
    { kind: 'hundred', size: 10, reverse: true, gen: ['mixJump'], name: '倒序百数板 · 跳着倒数',
      goal: '向右一格 -1，向下一格 -10。横着隔一格跳 -2，竖着隔一行跳 -20，补全跳数。' },
    { kind: 'pattern', size: 10, reverse: true, shape: 'plus', name: '倒序百数板 · 十字补数',
      goal: '十字中心提供一个数。向右一格 -1，向下一格 -10；从候选数字补全上下左右四个邻居。' },
    { kind: 'pattern', size: 10, reverse: true, shape: 'block', name: '倒序百数板 · 方块补数',
      goal: '方块中心提供一个数。向右一格 -1，向下一格 -10；从候选数字补全 3×3 方块。' }
  );
  ['20以内四类基础题', '梯子与陷阱', '加入乘法口诀', '开启道具卡', '加入20以内整除'].forEach(function (name, stage) {
    var ladderCount = stage === 0 ? 0 : stage === 1 ? 3 : 5;
    var trapCount = stage === 0 ? 0 : stage === 1 ? 5 : 6;
    LEVELS.push({ kind: 'race', interaction: 'race', size: 10, stage: stage, maxNumber: 20,
      cardsEnabled: stage >= 3, name: '百数飞行棋 · ' + name,
      goal: '先到100获胜，电脑回合也由你答题。20以内加法、减法、数分解和凑数。' +
        (stage >= 2 ? '加入1～9乘法口诀，乘积可到81。' : '') +
        (stage >= 4 ? '再加入被除数不超过20的整除题。' : '') +
        (stage === 0 ? '无梯子、无陷阱。' : ladderCount + '架梯子、' + trapCount + '个陷阱：梯子直接向前跳，陷阱随机后退5～10格。') +
        (stage >= 3 ? '开启道具卡。' : '无道具卡。') });
  });
  LEVELS = LEVELS.slice(0, 60).concat(LEVELS.slice(115, 135), LEVELS.slice(60, 115), LEVELS.slice(135));
  LEVELS.forEach(function (def) { def.interaction = def.interaction || 'fill'; });

  var CHAPTERS = [
    { name: '第一章 · 初次见面', from: 1, to: 5 },
    { name: '第二章 · 上下左右', from: 6, to: 10 },
    { name: '第三章 · 跳来跳去', from: 11, to: 15 },
    { name: '第四章 · 小侦探', from: 16, to: 30 },
    { name: '第五章 · 百数大师', from: 31, to: 40 },
    { name: '第六章 · 加法探险', from: 41, to: 50 },
    { name: '第七章 · 减法探险', from: 51, to: 60 },
    { name: '第八章 · 数字分解', from: 61, to: 70 },
    { name: '第九章 · 凑数伙伴', from: 71, to: 80 },
    { name: '第十章 · 倍数列车', from: 81, to: 95 },
    { name: '第十一章 · 质数侦探', from: 96, to: 105 },
    { name: '第十二章 · 四宫数独', from: 106, to: 110 },
    { name: '第十三章 · 六宫数独', from: 111, to: 115 },
    { name: '第十四章 · 九宫数独', from: 116, to: 120 },
    { name: '第十五章 · 雷区推理', from: 121, to: 135 },
    { name: '第十六章 · 动物坐标', from: 136, to: 145 },
    { name: '第十七章 · 最少补数迷宫', from: 146, to: 155 },
    { name: '第十八章 · 舒尔特方格', from: 156, to: 165 },
    { name: '第十九章 · 雷区进阶', from: 166, to: 175 },
    { name: '第二十章 · 迷宫进阶', from: 176, to: 195 },
    { name: '第二十一章 · 乘法点选', from: 196, to: 200 },
    { name: '第二十二章 · 乘法填表', from: 201, to: 215 },
    { name: '第二十三章 · 百数飞行棋', from: 216, to: 220 }
  ];

  /* ---------- 填数/迷宫十个互异候选；点选玩法不使用候选 ---------- */
  function candidates(level, remainingCellIds, targetCellId, rng) {
    if (level.interaction === 'select' || level.interaction === 'race') return [];
    rng = rng || Math.random;
    if (level.interaction === 'maze') {
      var moves = remainingCellIds == null ? mazeMoves(level, 1, 0).filter(function (cell) {
        return Object.prototype.hasOwnProperty.call(level.answers, cell);
      }) : remainingCellIds;
      var needed = [];
      moves.concat(targetCellId == null ? [] : [targetCellId]).forEach(function (cell) {
        if (!Number.isInteger(cell) || !Object.prototype.hasOwnProperty.call(level.answers, cell)) {
          throw new RangeError('Maze candidates must be blank cell numbers');
        }
        if (needed.indexOf(cell) < 0) needed.push(cell);
      });
      if (needed.length > 10) throw new RangeError('At most ten maze answers fit in the candidates');
      var extras = shuffle(rng, range(1, 100).filter(function (n) { return needed.indexOf(n) < 0; }));
      return shuffle(rng, needed.concat(extras.slice(0, 10 - needed.length)));
    }
    var remaining = remainingCellIds == null ? level.blanks : remainingCellIds;
    var ordered = level.fillOrder ? level.fillOrder.filter(function (cell) { return remaining.indexOf(cell) >= 0; }) : remaining;
    var target = targetCellId == null ? (ordered[0] || (level.fillOrder || level.blanks)[0]) : targetCellId;
    if (!Object.prototype.hasOwnProperty.call(level.answers, target)) {
      throw new RangeError('Target must be a blank cell in this level');
    }
    var answer = level.answers[target];
    if (level.kind === 'sudoku') return shuffle(rng, range(1, 10));
    if (level.kind === 'mines') return shuffle(rng, range(-1, 8));

    var required = [answer];
    remaining.forEach(function (cell) {
      if (!Object.prototype.hasOwnProperty.call(level.answers, cell)) return;
      var value = level.answers[cell];
      if (required.indexOf(value) < 0) required.push(value);
    });
    // 十个以内保留所有待填答案，切换目标不必刷新；更多时留一格作干扰项。
    var chosen = required.length <= 10 ? required.slice() :
      [answer].concat(shuffle(rng, required.slice(1)).slice(0, 8));
    var domain = level.kind === 'prime' ? range(level.minNumber, level.maxNumber) :
      range(1, level.kind === 'multiplication' ? 81 : 100);
    var decoys = shuffle(rng, domain.filter(function (n) { return required.indexOf(n) < 0; }));
    var fallback = shuffle(rng, domain.filter(function (n) { return chosen.indexOf(n) < 0; }));
    decoys.concat(fallback).some(function (n) {
      if (chosen.length === 10) return true;
      if (chosen.indexOf(n) < 0) chosen.push(n);
      return false;
    });
    return shuffle(rng, chosen);
  }

  /* ---------- 九九乘法表：cellId 是位置，value/answer 是乘积 ---------- */
  function fillMultiplication(level, def, rng) {
    level.activeCells = [];
    for (var y = 1; y <= 9; y++) for (var x = 1; x <= 9; x++) {
      var cell = (y - 1) * 9 + x;
      level.values[cell] = x <= y ? x * y : null;
      if (x <= y) level.activeCells.push(cell);
    }
    if (level.interaction === 'select') {
      level.tasks = shuffle(rng, level.activeCells).slice(0, 10 + def.stage * 5).map(function (cell) {
        var x = (cell - 1) % 9 + 1, y = Math.floor((cell - 1) / 9) + 1;
        return { cell: cell, prompt: x + ' × ' + y + ' = ?' };
      });
      return;
    }
    level.blanks = level.activeCells.slice();
    level.blanks.forEach(function (cell) {
      var x = (cell - 1) % 9 + 1, y = Math.floor((cell - 1) / 9) + 1;
      level.clues[cell] = '横 ' + x + ' × 纵 ' + y + ' = ?';
    });
    var fillStage = def.stage - 5;
    if (fillStage < 9) {
      // 前九关依次从第 1～9 行开始，到第九行后绕回第一行；每行从左到右。
      level.fillOrder = [];
      for (var offset = 0; offset < 9; offset++) {
        var row = (fillStage + offset) % 9 + 1;
        for (var col = 1; col <= row; col++) level.fillOrder.push((row - 1) * 9 + col);
      }
    } else level.fillOrder = shuffle(rng, level.activeCells);
  }

  var SHAPES = {
    plus: function (rng) {
      var c = numAt(R(rng, 1, 8), R(rng, 1, 8));
      return { cells: [c, c - 10, c + 10, c - 1, c + 1], given: c };
    },
    row: function (rng) {
      var r = R(rng, 0, 9), c0 = R(rng, 0, 4), cells = [];
      for (var i = 0; i < 6; i++) cells.push(numAt(r, c0 + i));
      return { cells: cells, given: pick(rng, cells) };
    },
    col: function (rng) {
      var c = R(rng, 0, 9), r0 = R(rng, 0, 3), cells = [];
      for (var i = 0; i < 7; i++) cells.push(numAt(r0 + i, c));
      return { cells: cells, given: pick(rng, cells) };
    },
    corner: function (rng) {
      var r0 = R(rng, 0, 6), c0 = R(rng, 0, 5), cells = [numAt(r0, c0)];
      for (var i = 1; i <= 4; i++) cells.push(numAt(r0, c0 + i));
      for (var j = 1; j <= 3; j++) cells.push(numAt(r0 + j, c0));
      return { cells: cells, given: numAt(r0, c0) };
    },
    block: function (rng) {
      var r0 = R(rng, 0, 7), c0 = R(rng, 0, 7), cells = [];
      for (var r = r0; r < r0 + 3; r++) for (var c = c0; c < c0 + 3; c++) cells.push(numAt(r, c));
      return { cells: cells, given: numAt(r0 + 1, c0 + 1) };
    }
  };

  function fillWorksheet(level, def, questionIndex) {
    if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= def.questionCount) {
      throw new RangeError('Invalid worksheet question index');
    }
    var question = WORKSHEET_QUESTIONS[def.questionFrom + questionIndex - 1];
    var firstCol = question.rows[0].findIndex(function (n) { return n !== 0; });
    var first = question.rows[0][firstCol];
    var origin = question.origin || [rowOf(first), colOf(first) - firstCol];
    level.questionIndex = questionIndex;
    level.questionCount = def.questionCount;
    level.sourceQuestion = def.questionFrom + questionIndex;
    level.goal = '本关第 ' + (questionIndex + 1) + ' / ' + def.questionCount + ' 题 · PDF 原题 ' + level.sourceQuestion + ' / 35。' +
      (question.origin ? '原题跨十片段按原样保留，以已知数字为准。' : '') +
      '向右一格 +1，向下一格 +10；从候选数字补全图案。';
    level.activeCells = [];
    level.givens = [];
    range(1, 100).forEach(function (cell) { level.values[cell] = null; });
    question.rows.forEach(function (row, r) {
      row.forEach(function (value, c) {
        if (!value) return;
        var cell = numAt(origin[0] + r, origin[1] + c);
        level.activeCells.push(cell);
        level.values[cell] = value;
        if (question.givens.indexOf(value) >= 0) level.givens.push(cell);
        else {
          level.blanks.push(cell);
          level.clues[cell] = '按原题已知数字推算：横着相差 1，竖着相差 10。';
        }
      });
    });
    level.fillOrder = level.blanks.slice();
  }

  function fillPattern(level, def, rng) {
    var shape = SHAPES[def.shape](rng);
    level.activeCells = shape.cells.slice().sort(function (a, b) { return a - b; });
    range(1, 100).forEach(function (cell) {
      level.values[cell] = level.activeCells.indexOf(cell) >= 0 ? cell : null;
    });
    level.givens = [shape.given];
    level.blanks = level.activeCells.filter(function (cell) { return cell !== shape.given; });
    level.fillOrder = level.blanks.slice();
    level.blanks.forEach(function (cell) {
      level.clues[cell] = '看提供的数字：横着相邻相差 1，竖着相邻相差 10，推出这一格。';
    });
  }

  function fillDiagonal(level, def, rng) {
    var main = def.dir === 'main';
    level.dir = def.dir;
    level.activeCells = range(0, 9).map(function (i) { return main ? numAt(i, i) : numAt(i, 9 - i); });
    range(1, 100).forEach(function (cell) {
      level.values[cell] = level.activeCells.indexOf(cell) >= 0 ? cell : null;
    });
    level.givens = shuffle(rng, level.activeCells).slice(0, def.givenCount)
      .sort(function (a, b) { return a - b; });
    level.blanks = level.activeCells.filter(function (cell) { return level.givens.indexOf(cell) < 0; });
    level.fillOrder = level.blanks.slice();
    var clue = main
      ? '左上→右下对角线：每往右下走一格 +11，按提供的数字推这一格。'
      : '右上→左下对角线：每往左下走一格 +9，按提供的数字推这一格。';
    level.blanks.forEach(function (cell) { level.clues[cell] = clue; });
  }

  function fillPrime(level, def) {
    level.minNumber = def.minNumber;
    level.maxNumber = def.maxNumber;
    level.knownPrimes = range(2, def.minNumber - 1).filter(isPrime);
    level.primeCells = range(def.minNumber, def.maxNumber).filter(isPrime);
    var interval = def.minNumber + '～' + def.maxNumber;
    if (level.interaction === 'select') {
      level.tasks = level.primeCells.map(function (cell) {
        return { cell: cell, prompt: '找齐 ' + interval + ' 中的质数，先点哪一个都可以。' };
      });
    } else {
      level.blanks = level.primeCells.slice();
      level.blanks.forEach(function (n, index) {
        level.clues[n] = interval + ' 中从小到大，第 ' + (index + 1) + ' 个质数 = ?（恰好有两个正因数）';
      });
    }
  }

  function selectTasks(level, def, rng) {
    level.tasks = [];
    if (def.kind === 'addition' || def.kind === 'subtraction') {
      var adding = def.kind === 'addition', step = def.step;
      level.step = step; level.maxNumber = 100;
      // 可用起点充足，先洗牌再取题；绝不按答案的格子编号重排题目。
      shuffle(rng, range(adding ? 1 : step + 1, adding ? 100 - step : 100))
        .slice(0, 6 + def.stage).forEach(function (a) {
          level.tasks.push({ cell: adding ? a + step : a - step, start: a,
            prompt: a + (adding ? ' + ' : ' - ') + step + ' = ?' });
        });
    } else if (def.kind === 'multiple') {
      level.factor = def.factor; level.maxNumber = def.maxNumber;
      range(1, def.maxNumber).filter(function (n) { return n % def.factor === 0; }).forEach(function (n) {
        level.tasks.push({ cell: n,
          prompt: '请按从小到大的顺序，点选下一个 ' + def.factor + ' 的正倍数（从第一个正倍数开始）。' });
      });
    } else if (def.kind === 'decompose') {
      level.maxNumber = def.maxNumber;
      var pairs = [];
      range(2, def.maxNumber).forEach(function (total) {
        range(1, total - 1).forEach(function (part) { pairs.push({ total: total, part: part }); });
      });
      // 每关先练习本关上限，再使用不同分解式；允许答案重复。
      var first = { total: def.maxNumber, part: R(rng, 1, def.maxNumber - 1) };
      var rest = shuffle(rng, pairs.filter(function (pair) {
        return pair.total !== first.total || pair.part !== first.part;
      }));
      [first].concat(rest.slice(0, Math.min(12, 6 + def.stage) - 1)).forEach(function (pair) {
        level.tasks.push({ cell: pair.total - pair.part,
          prompt: pair.total + ' 分成 ' + pair.part + ' 和几？' });
      });
    } else if (def.kind === 'bonds') {
      level.target = def.target;
      var parts = shuffle(rng, range(1, def.target - 1));
      for (var i = 0; i < Math.min(12, 6 + def.stage); i++) {
        var part = parts[i % parts.length];
        level.tasks.push({ cell: def.target - part,
          prompt: '已有 ' + part + '，再添几凑成 ' + def.target + '？' });
      }
    } else if (def.kind === 'coordinate') {
      var animals = ['小兔', '小猫', '小熊', '小鹿'];
      shuffle(rng, range(1, 81)).slice(0, 8 + def.stage).forEach(function (cell, index) {
        var x = (cell - 1) % 9 + 1, y = Math.floor((cell - 1) / 9) + 1;
        var animal = animals[(def.stage + index) % animals.length];
        level.tasks.push({ cell: cell, animal: animal,
          prompt: '请把' + animal + '放到横坐标 x=' + x + '、纵坐标 y=' + y + ' 的格子。' });
      });
    } else if (def.kind === 'schulte') {
      var positions = {};
      shuffle(rng, range(1, def.size * def.size)).forEach(function (value, index) {
        level.values[index + 1] = value;
        positions[value] = index + 1;
      });
      range(1, def.size * def.size).forEach(function (value) {
        level.tasks.push({ cell: positions[value], prompt: '请在棋盘中找到 ' + value });
      });
    }
  }

  /* ---------- 右/下迷宫：状态为 (当前位置, 已完成打卡数)，不保存标准路径 ---------- */
  var MAZE_UNREACHABLE = 101;
  function rightDown(cell) {
    var next = [];
    if (colOf(cell) < 9) next.push(cell + 1);
    if (cell <= 90) next.push(cell + 10);
    return next;
  }
  function mazeCosts(level) {
    var count = level.checkpoints.length, costs = [], given = {};
    level.givens.forEach(function (cell) { given[cell] = true; });
    for (var index = count; index >= 0; index--) {
      costs[index] = new Array(101).fill(MAZE_UNREACHABLE);
      costs[index][100] = index === count ? 0 : MAZE_UNREACHABLE;
      for (var head = 99; head >= 1; head--) {
        rightDown(head).forEach(function (next) {
          var nextIndex = index + (next === level.checkpoints[index] ? 1 : 0);
          // head 自身已走过，只支付下一格；漏打卡到终点的成本保持不可达。
          var cost = (given[next] ? 0 : 1) + costs[nextIndex][next];
          costs[index][head] = Math.min(costs[index][head], cost);
        });
      }
    }
    return costs;
  }
  function mazeCost(level, head, checkpointIndex) {
    var index = checkpointIndex == null ? 0 : checkpointIndex;
    if (!Number.isInteger(head) || head < 1 || head > 100 || !Number.isInteger(index) ||
        index < 0 || index > level.checkpoints.length) return MAZE_UNREACHABLE;
    return level.mazeCosts[index][head];
  }
  function mazeMoves(level, head, checkpointIndex) {
    var index = checkpointIndex == null ? 0 : checkpointIndex;
    var best = mazeCost(level, head, index);
    if (best === MAZE_UNREACHABLE || head === 100) return [];
    return rightDown(head).filter(function (next) {
      var nextIndex = index + (next === level.checkpoints[index] ? 1 : 0);
      return (level.givens.indexOf(next) >= 0 ? 0 : 1) + mazeCost(level, next, nextIndex) === best;
    });
  }
  function fillMaze(level, rng) {
    var head = 1, route = [head];
    shuffle(rng, new Array(9).fill(1).concat(new Array(9).fill(10))).forEach(function (step) {
      head += step; route.push(head);
    });
    level.checkpoints = shuffle(rng, range(1, 17)).slice(0, R(rng, 1, 3))
      .sort(function (a, b) { return a - b; }).map(function (index) { return route[index]; });
    // 留一道空白斜带：所有右/下路线都会穿过它，保证至少要补一个数。
    var pool = range(2, 99).filter(function (cell) { return rowOf(cell) + colOf(cell) !== 9; });
    level.givens = [1, 100].concat(shuffle(rng, pool).slice(0, R(rng, 20, 28)))
      .sort(function (a, b) { return a - b; });
    level.blanks = range(1, 100).filter(function (cell) { return level.givens.indexOf(cell) < 0; });
    level.blanks.forEach(function (cell) { level.clues[cell] = '只向右或向下，按顺序打卡，并让补入的数字总数最少。'; });
    level.mazeCosts = mazeCosts(level); // 101 表示不可达；整张成本表可直接 JSON 持久化。
    level.minimumFills = mazeCost(level, 1, 0);
  }

  /* ---------- 真数独：保留宫结构的置换 + 挖空时计数至两个解 ---------- */
  function sudokuSolutionCount(board, size, boxRows, boxCols) {
    var rows = new Array(size).fill(0), cols = rows.slice(), boxes = rows.slice();
    var all = (1 << size) - 1, holes = [], count = 0;
    function box(r, c) { return Math.floor(r / boxRows) * (size / boxCols) + Math.floor(c / boxCols); }
    board.forEach(function (value, i) {
      if (!value) { holes.push(i); return; }
      var r = Math.floor(i / size), c = i % size, bit = 1 << (value - 1);
      rows[r] |= bit; cols[c] |= bit; boxes[box(r, c)] |= bit;
    });
    function visit(depth) {
      if (count >= 2) return;
      if (depth === holes.length) { count++; return; }
      var best = depth, mask = 0, minimum = size + 1;
      for (var j = depth; j < holes.length; j++) {
        var i = holes[j], r = Math.floor(i / size), c = i % size;
        var allowed = all & ~(rows[r] | cols[c] | boxes[box(r, c)]);
        var bits = allowed, length = 0;
        while (bits) { bits &= bits - 1; length++; }
        if (!length) return;
        if (length < minimum) { best = j; mask = allowed; minimum = length; }
        if (length === 1) break;
      }
      var temp = holes[depth]; holes[depth] = holes[best]; holes[best] = temp;
      var cell = holes[depth], rr = Math.floor(cell / size), cc = cell % size, bb = box(rr, cc);
      while (mask && count < 2) {
        var bit = mask & -mask; mask &= mask - 1;
        rows[rr] |= bit; cols[cc] |= bit; boxes[bb] |= bit;
        visit(depth + 1);
        rows[rr] ^= bit; cols[cc] ^= bit; boxes[bb] ^= bit;
      }
      temp = holes[depth]; holes[depth] = holes[best]; holes[best] = temp;
    }
    visit(0);
    return count;
  }

  function fillSudoku(level, def, rng) {
    var size = def.size, br = def.boxRows, bc = def.boxCols;
    level.boxRows = br; level.boxCols = bc;
    function permuteGroups(groupSize) {
      var order = [];
      shuffle(rng, range(0, size / groupSize - 1)).forEach(function (group) {
        order = order.concat(shuffle(rng, range(0, groupSize - 1)).map(function (offset) {
          return group * groupSize + offset;
        }));
      });
      return order;
    }
    var rows = permuteGroups(br), cols = permuteGroups(bc), digits = shuffle(rng, range(1, size));
    var solved = [];
    rows.forEach(function (r) {
      cols.forEach(function (c) { solved.push(digits[(r * bc + Math.floor(r / br) + c) % size]); });
    });
    solved.forEach(function (n, i) { level.values[i + 1] = n; });
    for (var attempt = 0; attempt < 8; attempt++) {
      var puzzle = solved.slice(), blanks = [];
      shuffle(rng, range(1, size * size)).some(function (cell) {
        var old = puzzle[cell - 1]; puzzle[cell - 1] = 0;
        if (sudokuSolutionCount(puzzle, size, br, bc) === 1) blanks.push(cell);
        else puzzle[cell - 1] = old;
        return blanks.length === def.holes;
      });
      if (blanks.length === def.holes) {
        level.blanks = blanks;
        blanks.forEach(function (cell) { level.clues[cell] = '观察所在行、列和宫，排除已有数字；只填 1～' + size + '。'; });
        return;
      }
    }
    throw new Error('Could not generate the requested unique sudoku: ' + level.id);
  }

  /* ---------- 教学雷区：仅从初始可见数字和总雷数证明每个位置 ---------- */
  var CELLS = range(1, 100);
  var AROUND = {};
  CELLS.forEach(function (cell) {
    var nearby = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var r = rowOf(cell) + dr, c = colOf(cell) + dc;
      if ((dr || dc) && r >= 0 && r < 10 && c >= 0 && c < 10) nearby.push(numAt(r, c));
    }
    AROUND[cell] = nearby;
  });

  // 此函数不接收完整答案！已推断安全的空格也不能自动变成数字线索。
  function deduceMines(visible, mineCount) {
    var state = {}, equations = [];
    Object.keys(visible).forEach(function (key) {
      state[key] = 0;
      equations.push({ cells: AROUND[key], count: visible[key] });
    });
    equations.push({ cells: CELLS, count: mineCount });
    while (true) {
      var reduced = [], progress = false, invalid = false;
      function assign(cells, count) {
        if (!cells.length || (count !== 0 && count !== cells.length)) return;
        var value = count === 0 ? 0 : 1;
        cells.forEach(function (cell) {
          if (state[cell] == null) { state[cell] = value; progress = true; }
          else if (state[cell] !== value) invalid = true;
        });
      }
      equations.forEach(function (eq) {
        var left = eq.count, unknown = [];
        eq.cells.forEach(function (cell) {
          if (state[cell] == null) unknown.push(cell);
          else left -= state[cell];
        });
        if (left < 0 || left > unknown.length) invalid = true;
        assign(unknown, left);
        if (unknown.length) reduced.push({ cells: unknown, count: left });
      });
      if (invalid) return false;
      if (Object.keys(state).length === 100) return true;
      if (progress) continue;
      // 包含关系：B 包含 A 时，相减得到 B\A 中的雷数。
      for (var i = 0; i < reduced.length && !progress; i++) {
        for (var j = 0; j < reduced.length && !progress; j++) {
          var a = reduced[i], b = reduced[j];
          if (a.cells.length >= b.cells.length) continue;
          if (!a.cells.every(function (cell) { return b.cells.indexOf(cell) >= 0; })) continue;
          var difference = b.cells.filter(function (cell) { return a.cells.indexOf(cell) < 0; });
          assign(difference, b.count - a.count);
        }
      }
      if (invalid || !progress) return false;
    }
  }

  function fillMines(level, def, rng) {
    level.mineCount = def.mineCount;
    var mines = shuffle(rng, CELLS).slice(0, def.mineCount), visible = {};
    CELLS.forEach(function (cell) {
      var value = mines.indexOf(cell) >= 0 ? -1 : AROUND[cell].filter(function (n) { return mines.indexOf(n) >= 0; }).length;
      level.values[cell] = value;
      if (value !== -1) visible[cell] = value;
    });
    level.blanks = mines.slice();
    var removed = 0;
    shuffle(rng, Object.keys(visible).map(Number)).some(function (cell) {
      var value = visible[cell]; delete visible[cell];
      if (deduceMines(visible, def.mineCount)) { level.blanks.push(cell); removed++; }
      else visible[cell] = value;
      return removed === def.safeHoles;
    });
    // 停在仍能完全推理的位置，而不为凑空格数量牺牲可解性。
    if (!removed || !deduceMines(visible, def.mineCount)) throw new Error('Invalid mines puzzle: ' + level.id);
    level.blanks.forEach(function (cell) {
      level.clues[cell] = '只看已显示的数字和总雷数：确定是雷填“雷”，否则填周围八格的雷数（0～8）。';
    });
  }

  /* ---------- 飞行棋：独立题型、蛇形棋盘上的梯子与陷阱 ---------- */
  function fillRaceBoard(level, rng) {
    level.ladders = [];
    level.traps = [];
    if (level.stage === 0) return;
    // 行区间内部互不重叠；公共边界行的端点也不共用，因此梯子不会交叉。
    var bands = level.stage === 1 ? [[0, 3], [3, 6], [6, 9]] : [[0, 2], [2, 4], [4, 6], [6, 8], [8, 9]];
    var occupied = {};
    function snakeNumber(row, column) { return row * 10 + (row % 2 ? 10 - column : column + 1); }
    bands.forEach(function (band) {
      var options = [];
      for (var row = band[0]; row < band[1]; row++) {
        for (var rise = 1; rise <= 2 && row + rise <= band[1]; rise++) {
          for (var col = 0; col < 10; col++) {
            [-1, 1].forEach(function (offset) {
              if (col + offset < 0 || col + offset > 9) return;
              var from = snakeNumber(row, col), to = snakeNumber(row + rise, col + offset);
              if (from >= 2 && to <= 99 && !occupied[from] && !occupied[to]) options.push({ from: from, to: to });
            });
          }
        }
      }
      // 每个区域枚举全部合法边；此前至多占用其边界的一个端点，不会因重试上限少生成。
      var ladder = pick(rng, options);
      level.ladders.push(ladder);
      occupied[ladder.from] = occupied[ladder.to] = true;
    });
    var trapCount = level.stage === 1 ? 5 : 6;
    for (var i = 0; i < trapCount; i++) {
      // 11～98 均匀分区，每区一个陷阱，保留至少 5 格间距及后退 10 格的空间。
      var first = 11 + Math.floor(i * 88 / trapCount);
      var last = 10 + Math.floor((i + 1) * 88 / trapCount);
      var available = range(first, last).filter(function (cell) {
        return !occupied[cell] && level.traps.every(function (trap) { return Math.abs(trap - cell) >= 5; });
      });
      level.traps.push(pick(rng, available));
    }
  }

  function fillRace(level, def, rng) {
    level.maxNumber = def.maxNumber;
    level.stage = def.stage;
    level.cardsEnabled = def.cardsEnabled;
    level.questions = {};
    var max = def.maxNumber, types = ['add', 'subtract', 'decompose', 'bond'];
    if (def.stage >= 2) types.push('multiply');
    if (def.stage >= 4) types.push('divide');
    var questionTypes = shuffle(rng, range(1, 100).map(function (n) { return types[(n - 1) % types.length]; }));
    range(1, 100).forEach(function (cell) {
      var type = questionTypes[cell - 1], operator, a, b, answer, prompt;
      if (type === 'add') {
        operator = '+'; a = R(rng, 0, max); b = R(rng, 0, max - a); answer = a + b;
      } else if (type === 'subtract') {
        operator = '-'; a = R(rng, 0, max); b = R(rng, 0, a); answer = a - b;
      } else if (type === 'decompose') {
        operator = '-'; a = R(rng, 2, max); b = R(rng, 1, a - 1); answer = a - b;
        prompt = a + ' 分成 ' + b + ' 和几？';
      } else if (type === 'bond') {
        operator = '+'; b = R(rng, 2, max); a = R(rng, 1, b - 1); answer = b - a;
        prompt = a + ' + ? = ' + b;
      } else if (type === 'multiply') {
        operator = '×'; a = R(rng, 1, 9); b = R(rng, 1, 9); answer = a * b;
      } else {
        operator = '÷'; b = R(rng, 1, 10); answer = R(rng, 1, Math.floor(max / b)); a = b * answer;
      }
      var minimum = type === 'multiply' ? 1 : 0, maximum = type === 'multiply' ? 81 : max;
      var decoys = shuffle(rng, range(minimum, maximum).filter(function (n) { return n !== answer; })).slice(0, 3);
      level.questions[cell] = { type: type, left: a, right: b, operator: operator, answer: answer,
        prompt: prompt || a + ' ' + operator + ' ' + b + ' = ?', choices: shuffle(rng, [answer].concat(decoys)) };
    });
    fillRaceBoard(level, rng);
  }

  /* ---------- 生成关卡实例；默认固定种子，可由调用方传入随机种子 ---------- */
  function build(id, seed, questionIndex) {
    if (!Number.isInteger(id) || id < 1 || id > LEVELS.length) throw new RangeError('Level id must be an integer from 1 to ' + LEVELS.length);
    // 先还原重排前编号，再还原插关前编号，让默认题目始终跟随原关卡。
    var previousId = id >= 61 && id <= 80 ? id + 55 : id >= 81 && id <= 135 ? id - 20 : id;
    var seedId = previousId > 40 ? previousId - 15 : previousId > 30 && previousId < 36 ? previousId - 10 : previousId;
    var def = LEVELS[id - 1], actualSeed = seed === undefined ? seedId * 7919 + 13 : seed;
    var rng = mulberry32(actualSeed);
    var level = { id: id, name: def.name, goal: def.goal, kind: def.kind, size: def.size,
      interaction: def.interaction || 'fill',
      blanks: [], values: {}, answers: {}, clues: {}, candidates: [], total: LEVELS.length };
    // 只为 race 记录 RNG 实际使用的 32 位种子，不改变旧关数据或随机序列。
    if (def.kind === 'race') level.seed = actualSeed >>> 0;
    if (def.kind === 'sudoku') fillSudoku(level, def, rng);
    else if (def.kind === 'mines') fillMines(level, def, rng);
    else if (def.kind === 'multiplication') fillMultiplication(level, def, rng);
    else {
      range(1, def.size * def.size).forEach(function (cell) {
        level.values[cell] = def.kind === 'coordinate' ? null : cell;
      });
      if (def.kind === 'prime') fillPrime(level, def);
      else if (def.kind === 'race') fillRace(level, def, rng);
      else if (level.interaction === 'select') selectTasks(level, def, rng);
      else if (def.kind === 'maze') fillMaze(level, rng);
      else if (def.kind === 'diagonal') fillDiagonal(level, def, rng);
      else if (def.questionCount) fillWorksheet(level, def, questionIndex === undefined ? 0 : questionIndex);
      else if (def.kind === 'pattern') fillPattern(level, def, rng);
      else if (def.kind === 'hundred') {
        var fn = G[def.gen[0]];
        // 不改变旧生成器的调用顺序和种子，保留前 25 关的全部位置和解。
        level.blanks = fn.apply(null, [rng].concat(def.gen.slice(1)))
          .filter(function (n, i, all) { return n >= 1 && n <= 100 && all.indexOf(n) === i; })
          .sort(function (a, b) { return a - b; }).slice(0, 10);
        level.blanks.forEach(function (cell) { level.clues[cell] = def.goal; });
      }
    }
    if (def.reverse) {
      level.reverse = true;
      range(1, 100).forEach(function (cell) {
        if (level.values[cell] != null) level.values[cell] = 101 - level.values[cell];
      });
      level.blanks.forEach(function (cell) { level.clues[cell] = def.goal; });
    }
    level.blanks.sort(function (a, b) { return a - b; });
    level.blanks.forEach(function (cell) { level.answers[cell] = level.values[cell]; });
    level.candidates = level.interaction === 'maze' ? candidates(level, null, null, rng) :
      candidates(level, level.blanks, (level.fillOrder || level.blanks)[0], rng);
    // 保留旧接口；新 UI 应直接使用 candidates 数值，而非把它们当成 cellId。
    level.decoys = level.candidates.filter(function (n) {
      return !level.blanks.some(function (cell) { return level.answers[cell] === n; });
    });
    return level;
  }

  function isFree(id) {
    return id <= 20 || CHAPTERS.some(function (ch) { return ch.from === id; });
  }

  function nearestFree(id) {
    var best = 0;
    for (var i = 1; i <= LEVELS.length; i++) if (isFree(i) && i <= id) best = i;
    return best || 1;
  }

  window.HB.levels = {
    total: LEVELS.length,
    progressVersion: 4,
    list: LEVELS,
    chapters: CHAPTERS,
    isFree: isFree,
    nearestFree: nearestFree,
    build: build,
    candidates: candidates,
    mazeCost: mazeCost,
    mazeMoves: mazeMoves,
    numAt: numAt
  };
})();
