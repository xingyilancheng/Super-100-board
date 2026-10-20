(function () {
  'use strict';
  window.HB = window.HB || {};

  var HUES = {
    wood: null,
    acrylic: [196, 208, 220, 232, 246, 262, 278, 296, 318, 340],
    macaron: [352, 22, 42, 88, 152, 188, 212, 264, 296, 326],
    starry: [228, 242, 256, 272, 288, 302, 268, 252, 238, 224]
  };
  var TAGS = { wood: '实木棋盘', acrylic: '亚克力棋盘', macaron: '马卡龙棋盘', starry: '星空棋盘' };
  var cells = [], blankSet = {}, targetN = null, originN = null, current = null;

  function label(value) { return value === -1 ? '雷' : (value == null ? '' : String(value)); }

  function axis(text, corner) {
    var el = document.createElement('span');
    el.className = 'coordinate-axis' + (corner ? ' axis-corner' : '');
    el.textContent = text;
    return el;
  }

  function showAnimal(host, name) {
    host.innerHTML = '';
    var face = document.createElement('span');
    face.className = 'animal-face ' + (name.indexOf('兔') >= 0 ? 'rabbit' : name.indexOf('猫') >= 0 ? 'cat' : name.indexOf('鹿') >= 0 ? 'deer' : 'bear');
    face.setAttribute('aria-hidden', 'true');
    var eyes = document.createElement('i');
    face.appendChild(eyes);
    host.appendChild(face);
    var text = document.createElement('span');
    text.className = 'animal-name';
    text.textContent = name;
    host.appendChild(text);
  }

  function render(level) {
    current = level || null;
    var size = level ? level.size : 10, coordinate = level && level.kind === 'coordinate';
    var multiplication = level && level.kind === 'multiplication', axes = coordinate || multiplication;
    var inertKind = level && (level.kind === 'diagonal' || level.kind === 'pattern');
    var givenSet = {};
    if (inertKind) level.givens.forEach(function (n) { givenSet[n] = 1; });
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = 'repeat(' + (axes ? size + 1 : size) + ', 1fr)';
    grid.dataset.kind = level ? level.kind : 'chart';
    grid.dataset.interaction = level ? level.interaction : 'fill';
    document.getElementById('board').style.setProperty('--cell-font', (38.5 / (axes ? size + 1 : size)) + 'cqw');
    cells = [];
    blankSet = {};
    targetN = null;
    originN = null;
    if (level && level.interaction !== 'select') level.blanks.forEach(function (n) { blankSet[n] = 1; });
    if (axes) {
      grid.appendChild(axis('横 →\n纵 ↓', true));
      for (var x = 1; x <= size; x++) grid.appendChild(axis(x));
    }
    for (var n = 1; n <= size * size; n++) {
      var r = Math.floor((n - 1) / size), c = (n - 1) % size;
      if (axes && c === 0) grid.appendChild(axis(r + 1));
      if (multiplication && c > r) {
        var space = document.createElement('span');
        space.className = 'cell table-void';
        space.setAttribute('aria-hidden', 'true');
        grid.appendChild(space);
        cells[n - 1] = space;
        continue;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell tile-look';
      b.dataset.n = n;
      if (level && level.kind === 'race') {
        b.style.gridRow = r + 1;
        b.style.gridColumn = r % 2 === 0 ? c + 1 : size - c;
        b.disabled = true;
        if (n === 1 || n === 100) {
          var endpoint = document.createElement('span');
          endpoint.className = 'cell-marker';
          endpoint.textContent = n === 1 ? '起点' : '终点';
          b.appendChild(endpoint);
          b.classList.add('race-endpoint');
        }
      }
      var value = level ? level.values[n] : n;
      var inert = inertKind && level.activeCells.indexOf(n) < 0;
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = (blankSet[n] || inert) ? '' : label(value);
      var q = document.createElement('span');
      q.className = 'q';
      q.textContent = level && (level.kind === 'maze' || multiplication) ? '' : '?';
      if (blankSet[n]) b.classList.add('blank');
      if (inert) { b.classList.add('inert'); b.disabled = true; }
      if (givenSet[n]) { b.classList.add('given'); b.disabled = true; }
      var knownPrime = level && level.kind === 'prime' && level.knownPrimes.indexOf(n) >= 0;
      if (knownPrime) { b.classList.add('prime-known'); b.disabled = true; }
      if (multiplication && r === c) b.classList.add('table-diagonal');
      if (!blankSet[n] && value === -1) b.classList.add('mine');
      if (level && level.kind === 'sudoku') {
        if (c > 0 && c % level.boxCols === 0) b.classList.add('box-left');
        if (r > 0 && r % level.boxRows === 0) b.classList.add('box-top');
      }
      var position = level && level.kind === 'race' ? '飞行棋第 ' + n + ' 格' : axes ? '横 ' + (c + 1) + '，纵 ' + (r + 1) : '第 ' + (r + 1) + ' 行，第 ' + (c + 1) + ' 列';
      var marker = '';
      if (level && level.kind === 'maze') {
        var checkpoint = level.checkpoints.indexOf(n);
        marker = n === 1 ? '入口' : n === 100 ? '出口' : checkpoint >= 0 ? '打卡 ' + (checkpoint + 1) : '';
        if (marker) {
          var tag = document.createElement('span');
          tag.className = 'cell-marker';
          tag.textContent = marker;
          b.appendChild(tag);
          b.classList.add('waypoint');
        }
        if (n === 1) b.classList.add('route', 'route-head');
      }
      b.setAttribute('aria-label', position + (coordinate ? '，空白方格' : inert ? '，空格（不参与）' : blankSet[n] ? '，待填写' : givenSet[n] ? '，已知 ' + label(value) : '，' + label(value)) + (marker ? '，' + marker : '') + (knownPrime ? '，此前区间的质数' : ''));
      b.appendChild(num);
      b.appendChild(q);
      grid.appendChild(b);
      cells[n - 1] = b;
    }
    applyMaterial(HB.store.data.settings.material);
    if (level && level.kind === 'race') {
      renderRaceObstacles(level, grid);
      ['player', 'ai'].forEach(function (actor) {
        var piece = document.createElement('span');
        piece.id = 'racePiece-' + actor;
        piece.className = 'race-piece race-piece-' + actor;
        piece.setAttribute('role', 'img');
        piece.innerHTML = raceAvatar(actor);
        grid.appendChild(piece);
        placeRacePiece(actor, 1);
      });
    }
  }

  function raceAvatar(actor) {
    var rabbit = actor === 'player', fur = rabbit ? '#fff7ec' : '#c99462';
    var outline = rabbit ? '#825457' : '#714938', shirt = rabbit ? '#e45165' : '#368fd4';
    return '<svg class="race-avatar" viewBox="0 0 80 96" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      '<ellipse cx="40" cy="91" rx="23" ry="4" fill="#352136" opacity=".18"/>' +
      '<g stroke="' + outline + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M25 79L23 88Q24 93 34 90L37 79M43 79L46 90Q57 93 57 88L55 79" fill="' + fur + '"/>' +
      '<path d="M24 62Q15 63 10 73Q9 79 14 80Q19 81 25 72M56 62Q65 63 70 73Q71 79 66 80Q61 81 55 72" fill="' + fur + '"/>' +
      '<path d="M26 60Q40 55 54 60L61 69L55 73L56 83Q40 89 24 83L25 73L19 69Z" fill="' + shirt + '"/>' +
      '<path d="M32 60L40 68L48 60" fill="#fff8e7" stroke="#fff8e7" stroke-width="2"/>' +
      '<path d="M35 74H45V79Q40 84 35 79Z" fill="' + (rabbit ? '#ffb6a6' : '#a9def3') + '" stroke="none"/>' +
      (rabbit ?
        '<path d="M21 35Q11 6 23 4Q34 4 33 34M46 33Q45 2 56 5Q67 9 58 37" fill="' + fur + '"/>' +
        '<path d="M24 12Q21 19 26 29M55 13Q58 21 53 30" fill="none" stroke="#efa8ae" stroke-width="5"/>' :
        '<circle cx="19" cy="27" r="12" fill="' + fur + '"/><circle cx="61" cy="27" r="12" fill="' + fur + '"/>' +
        '<circle cx="19" cy="27" r="6" fill="#edc099" stroke="none"/><circle cx="61" cy="27" r="6" fill="#edc099" stroke="none"/>') +
      '<path d="M15 43Q15 27 40 27Q65 27 65 43L64 51Q61 65 40 65Q19 65 16 51Z" fill="' + fur + '"/>' +
      '<path d="M22 37Q27 31 34 32" fill="none" stroke="' + (rabbit ? '#ffffff' : '#e9bc8a') + '" stroke-width="3"/>' +
      '<ellipse cx="40" cy="53" rx="12" ry="9" fill="' + (rabbit ? '#ffffff' : '#f7dfb8') + '" stroke="none"/>' +
      '<path class="race-eyes-open" d="M29 43V46M51 43V46" stroke="#493339" stroke-width="3.5"/>' +
      '<path class="race-eyes-closed" d="M25 46Q29 49 33 46M47 46Q51 49 55 46" fill="none" stroke="#493339"/>' +
      '<ellipse cx="22" cy="51" rx="5" ry="3" fill="#ef9d9c" opacity=".7" stroke="none"/>' +
      '<ellipse cx="58" cy="51" rx="5" ry="3" fill="#ef9d9c" opacity=".7" stroke="none"/>' +
      '<path d="M37 50Q40 48 43 50L40 53Z" fill="' + (rabbit ? '#d97b85' : '#684333') + '" stroke="none"/>' +
      '<path d="M40 53V55M35 55Q40 60 45 55" fill="none" stroke-width="1.8"/></g></svg>';
  }

  function raceSvg(tag, attributes) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attributes || {}).forEach(function (key) { el.setAttribute(key, attributes[key]); });
    return el;
  }

  function raceCellTag(n, text, className, description) {
    var cell = cells[n - 1];
    if (!cell) return;
    var tag = document.createElement('span');
    tag.className = 'race-cell-tag ' + className;
    tag.textContent = text;
    tag.setAttribute('aria-hidden', 'true');
    cell.appendChild(tag);
    cell.setAttribute('aria-label', cell.getAttribute('aria-label') + '，' + description);
    cell.classList.add(className);
  }

  function renderRaceObstacles(level, grid) {
    var ladders = (level.ladders || []).filter(function (ladder) {
      return ladder.to > ladder.from && cells[ladder.from - 1] && cells[ladder.to - 1];
    });
    if (ladders.length) {
      var overlay = raceSvg('svg', {
        'class': 'race-ladders', viewBox: '0 0 ' + grid.clientWidth + ' ' + grid.clientHeight,
        preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false'
      });
      ladders.forEach(function (ladder) {
        var start = cells[ladder.from - 1], end = cells[ladder.to - 1];
        // Read rendered cells, not numeric columns: odd rows run right to left.
        var x1 = start.offsetLeft + start.offsetWidth * .5, y1 = start.offsetTop + start.offsetHeight * .52;
        var x2 = end.offsetLeft + end.offsetWidth * .5, y2 = end.offsetTop + end.offsetHeight * .52;
        var dx = x2 - x1, dy = y2 - y1, length = Math.sqrt(dx * dx + dy * dy);
        var unit = start.offsetWidth, half = unit * .105;
        var ux = dx / length, uy = dy / length, px = -uy * half, py = ux * half;
        var path = 'M' + (x1 + px) + ',' + (y1 + py) + 'L' + (x2 + px) + ',' + (y2 + py) +
          'M' + (x1 - px) + ',' + (y1 - py) + 'L' + (x2 - px) + ',' + (y2 - py);
        var rungs = Math.max(4, Math.round(length / (unit * .3)));
        for (var i = 1; i < rungs; i++) {
          var x = x1 + dx * i / rungs, y = y1 + dy * i / rungs;
          path += 'M' + (x + px) + ',' + (y + py) + 'L' + (x - px) + ',' + (y - py);
        }
        var group = raceSvg('g', { 'data-from': ladder.from, 'data-to': ladder.to });
        ['halo', 'edge', 'wood'].forEach(function (layer, index) {
          group.appendChild(raceSvg('path', {
            d: path, 'class': 'race-ladder-' + layer, 'stroke-width': unit * [.105, .075, .035][index]
          }));
        });
        group.appendChild(raceSvg('circle', {
          cx: x1, cy: y1, r: unit * .075, 'class': 'race-ladder-start', 'stroke-width': unit * .035
        }));
        var tipX = x2 + ux * unit * .06, tipY = y2 + uy * unit * .06;
        var baseX = x2 - ux * unit * .14, baseY = y2 - uy * unit * .14;
        group.appendChild(raceSvg('path', {
          d: 'M' + tipX + ',' + tipY + 'L' + (baseX + px * 1.4) + ',' + (baseY + py * 1.4) +
            'L' + (baseX - px * 1.4) + ',' + (baseY - py * 1.4) + 'Z', 'class': 'race-ladder-arrow',
          'stroke-width': unit * .035
        }));
        overlay.appendChild(group);
        raceCellTag(ladder.from, '梯→' + ladder.to, 'race-ladder-from', '梯子起点，前往 ' + ladder.to);
        raceCellTag(ladder.to, '梯终点', 'race-ladder-to', '梯子终点，来自 ' + ladder.from);
      });
      grid.appendChild(overlay);
    }
    (level.traps || []).forEach(function (n) {
      var cell = cells[n - 1];
      if (!cell) return;
      raceCellTag(n, '陷阱', 'race-trap', '陷阱');
      var pit = raceSvg('svg', { 'class': 'race-pit', viewBox: '0 0 80 34', 'aria-hidden': 'true', focusable: 'false' });
      pit.innerHTML = '<path d="M6 18L13 8L27 10L34 4L48 8L65 7L75 17L69 27L52 29L37 32L18 27Z" fill="#bd927e" stroke="#fff0d7" stroke-width="2.5"/>' +
        '<ellipse cx="40" cy="18" rx="27" ry="10" fill="#4b354f" stroke="#825d66" stroke-width="3"/>' +
        '<path d="M17 19Q40 6 64 19Q55 9 40 9Q25 9 17 19" fill="#261e34"/>' +
        '<path d="M5 25L10 29M71 5L75 9M28 5L24 2" stroke="#f7e2cc" stroke-width="3" stroke-linecap="round"/>';
      cell.appendChild(pit);
    });
  }

  function applyMaterial(mat) {
    if (!Object.prototype.hasOwnProperty.call(TAGS, mat)) mat = 'wood';
    document.body.dataset.material = mat;
    var size = current ? current.size : 10;
    cells.forEach(function (el, i) {
      var h = mat === 'wood' ? 32 : HUES[mat][(mat === 'acrylic' ? i % size : Math.floor(i / size)) % 10];
      el.style.setProperty('--h', h);
    });
    var kind = current && current.kind;
    var names = { sudoku: size + '×' + size + ' 数独', mines: '扫雷推理', coordinate: '动物坐标', maze: '最少补数迷宫', schulte: '舒尔特方格', multiplication: '9×9 乘法表', pattern: '图案补数', diagonal: '对角线补数', race: '飞行棋 · 蛇形 1→100' };
    document.getElementById('boardTag').textContent = TAGS[mat] + (current && current.reverse ? ' · 倒序 100→1' : names[kind] ? ' · ' + names[kind] : '');
  }

  function hueOf(n) {
    var cell = cells[n - 1];
    return cell ? cell.style.getPropertyValue('--h') : 320;
  }

  function setTarget(n) {
    if (targetN != null && cells[targetN - 1]) {
      cells[targetN - 1].classList.remove('target');
      cells[targetN - 1].setAttribute('aria-pressed', 'false');
    }
    targetN = n;
    if (n != null && cells[n - 1]) {
      cells[n - 1].classList.add('target');
      cells[n - 1].setAttribute('aria-pressed', 'true');
    }
  }

  function setOrigin(n) {
    if (originN != null) {
      cells[originN - 1].classList.remove('origin');
      cells[originN - 1].removeAttribute('aria-current');
      cells[originN - 1].removeAttribute('title');
    }
    originN = n;
    if (n != null) {
      cells[n - 1].classList.add('origin');
      cells[n - 1].setAttribute('aria-current', 'step');
      cells[n - 1].setAttribute('title', '起点：' + label(current.values[n]));
    }
  }

  function markCorrect(n, animal) {
    var cell = cells[n - 1];
    cell.classList.remove('landed');
    void cell.offsetWidth;
    cell.classList.add('answered', 'landed');
    if (current.kind === 'multiple' || current.kind === 'prime') {
      cell.setAttribute('aria-label', label(current.values[n]) + '，已选正确答案');
    }
    if (animal) {
      showAnimal(cell.querySelector('.num'), animal);
      cell.setAttribute('aria-label', '横 ' + ((n - 1) % 9 + 1) + '，纵 ' + (Math.floor((n - 1) / 9) + 1) + '，' + animal + '已到达');
    }
    setTimeout(function () { cell.classList.remove('landed'); }, 520);
  }

  function moveMaze(from, to) {
    var previous = cells[from - 1], next = cells[to - 1];
    previous.classList.remove('route-head');
    var link = document.createElement('span');
    link.className = 'path-link ' + (to - from === 1 ? 'path-right' : 'path-down');
    previous.appendChild(link);
    next.classList.add('route', 'route-head');
    next.setAttribute('aria-current', 'step');
    previous.removeAttribute('aria-current');
  }

  function fill(n, value) {
    var cell = cells[n - 1];
    delete blankSet[n];
    cell.querySelector('.num').textContent = label(value);
    cell.setAttribute('aria-label', '已填写：' + label(value));
    cell.classList.remove('blank', 'target');
    cell.classList.add('filled', 'landed');
    cell.classList.toggle('mine', value === -1);
    setTimeout(function () { cell.classList.remove('landed'); }, 520);
  }

  function placeRacePiece(actor, n) {
    var piece = document.getElementById('racePiece-' + actor);
    var grid = document.getElementById('grid'), cell = cells[n - 1];
    piece.style.left = (cell.offsetLeft + cell.offsetWidth * (actor === 'player' ? .27 : .73)) / grid.clientWidth * 100 + '%';
    piece.style.top = (cell.offsetTop + cell.offsetHeight * .74) / grid.clientHeight * 100 + '%';
    piece.dataset.cell = n;
    var state = HB.game && HB.game.state;
    var name = state && state.race && state.raceMode === 'local'
      ? (actor === 'player' ? '玩家1 · 小兔' : '玩家2 · 小熊')
      : (actor === 'player' ? '你' : '电脑');
    piece.setAttribute('aria-label', name + '，位于 ' + n);
  }

  function moveRacePiece(actor, n, duration, onDone) {
    var piece = document.getElementById('racePiece-' + actor);
    var before = piece.getBoundingClientRect();
    if (piece.raceAnimation) {
      piece.raceAnimation.onfinish = null;
      piece.raceAnimation.cancel();
    }
    placeRacePiece(actor, n);
    var after = piece.getBoundingClientRect(), dx = before.left - after.left, dy = before.top - after.top;
    var cellHeight = cells[n - 1].offsetHeight, distance = Math.sqrt(dx * dx + dy * dy);
    var lift = Math.max(cellHeight * .52, Math.min(distance * .3, cellHeight * 1.4));
    function frame(offset, progress, height, scaleX, scaleY) {
      return { offset: offset, transform: 'translate(calc(-50% + ' + (dx * (1 - progress)) +
        'px), calc(-50% + ' + (dy * (1 - progress) - height) + 'px)) scale(' + scaleX + ',' + scaleY + ')' };
    }
    piece.classList.add('race-jumping');
    var animation = piece.animate([
      frame(0, 0, 0, 1, 1),
      frame(.23, .25, lift * .72, .96, 1.06),
      frame(.5, .54, lift, 1, 1.04),
      frame(.74, .8, lift * .62, .98, 1.04),
      frame(.9, 1, 0, 1.12, .86),
      frame(1, 1, 0, 1, 1)
    ], { duration: duration, easing: 'linear' });
    piece.raceAnimation = animation;
    function cleanup() {
      if (piece.raceAnimation !== animation) return;
      piece.raceAnimation = null;
      piece.classList.remove('race-jumping');
    }
    animation.onfinish = function () {
      cleanup();
      if (typeof onDone === 'function') onDone();
    };
    animation.oncancel = cleanup;
    return function () {
      animation.onfinish = null;
      cleanup();
      animation.cancel();
    };
  }

  HB.board = {
    render: render, applyMaterial: applyMaterial, setTarget: setTarget, setOrigin: setOrigin,
    fill: fill, markCorrect: markCorrect, moveMaze: moveMaze, showAnimal: showAnimal,
    placeRacePiece: placeRacePiece, moveRacePiece: moveRacePiece,
    isBlank: function (n) { return !!blankSet[n]; },
    el: function (n) { return cells[n - 1]; }, hueOf: hueOf, label: label
  };
})();
