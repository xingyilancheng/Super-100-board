/* 界面：账户 / 积分 / 关卡地图 / 设置 / 提示气泡 / 通关弹窗 */
(function () {
  'use strict';
  window.HB = window.HB || {};

  var AVATARS = ['🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐧', '🦄'];
  var WORDS = {
    idle: ['一起玩百数板吧！', '点一点数字，送它回家～', '慢慢想，你一定可以！'],
    correct: ['太棒了！', '答对啦！', '你真厉害！', '漂亮！', '就是这个位置！'],
    wrong: ['再想一想～', '不对哦，看看前后邻居', '换个数字试试吧', '别着急，仔细找找'],
    win: ['哇！全部填好啦！', '厉害，又一关通过！', '你越来越棒啦！']
  };
  var FACES = {
    idle: ['🐻', '🐼', '🐨'],
    correct: ['🥳', '😻', '🤩'],
    wrong: ['🤔', '😯', '🙈'],
    win: ['🎉', '🏆', '🌟']
  };
  var MAT_LABEL = { wood: '实木', acrylic: '亚克力', macaron: '马卡龙', starry: '星空' };
  var SUPPORT_IMAGES = {
    follow: {
      src: 'assets/follow.jpg',
      alt: '微信关注图片（用户提供的原图）',
      title: '关注我们',
      note: '请备注“百数板”。本页仅展示微信关注原图，不上传任何信息。'
    },
    donate: {
      src: 'assets/donate.jpg',
      alt: '支付宝捐赠图片（用户提供的原图）',
      title: '自愿捐赠',
      note: '捐赠完全自愿，不影响游戏或积分。未成年人请在监护人陪同下操作；本页仅展示图片，不会自动发起付款。'
    }
  };

  function $(id) { return document.getElementById(id); }
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  var scoreShown = 0, scoreFrame = 0, mapSelection = '';

  function countUp(to) {
    cancelAnimationFrame(scoreFrame);
    var el = $('scoreValue');
    var from = scoreShown;
    scoreShown = to;
    if (from === to) { el.textContent = to; return; }
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    var t0 = performance.now(), dur = 420;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var v = Math.round(from + (to - from) * (p * (2 - p)));
      el.textContent = v;
      if (p < 1) scoreFrame = requestAnimationFrame(step);
      else el.textContent = to;
    })(performance.now());
  }

  function deactivatedPlayers() {
    return HB.store.players.filter(function (player) { return player.deactivated === true; });
  }

  function renderAccount() {
    var d = HB.store.data;
    $('avatarBtn').textContent = d.avatar;
    $('nameInput').value = d.name;
    $('accTitle').textContent = HB.store.title();
    var select = $('playerSelect');
    select.innerHTML = '';
    HB.store.players.filter(function (player) { return player.deactivated !== true; }).forEach(function (player) {
      var option = document.createElement('option');
      option.value = player.id;
      option.textContent = player.name;
      select.appendChild(option);
    });
    select.value = d.id;
    var deactivated = deactivatedPlayers();
    $('deactivatedPlayerCount').textContent = deactivated.length;
  }

  function renderScore() {
    cancelAnimationFrame(scoreFrame);
    scoreShown = HB.store.data.score;
    $('scoreValue').textContent = scoreShown;
    $('statLevels').textContent = HB.store.doneCount();
    $('statStars').textContent = HB.store.totalStars();
    $('totalLevels').textContent = HB.levels.total;
    $('totalStars').textContent = HB.levels.total * 3;
  }

  function renderMode() {
    var state = HB.game.state, free = state.mode !== 'normal';
    $('freeModeToggle').checked = free;
    $('freeControls').hidden = !free;
    $('practiceLevel').value = state.level ? state.level.id : 1;
    $('modeNote').textContent = state.race && state.raceMode === 'local'
      ? '本局为本地双人对战：不计积分，不改变星星和解锁进度。'
      : free ? '练习不加分、不扣分，不改变星星和解锁进度。' +
        (HB.license && !HB.license.status().active ? '完整版关卡仍需激活。' : '取消勾选即可回到正式闯关。')
      : '闯关模式：按顺序解锁，成绩计入积分。';
  }

  function renderSaveStatus() {
    var status = HB.store.status;
    $('saveStatus').textContent = status === 'error' ? '保存失败，请重试，暂勿关闭页面' : (status === 'saving' ? '正在保存…' : '已保存到本机数据库');
    $('saveStatus').classList.toggle('save-error', status === 'error');
    $('retrySaveBtn').hidden = status !== 'error';
  }

  async function changePlayer(action) {
    var previous = { id: HB.game.state.level.id, mode: HB.game.state.mode };
    HB.game.suspend();
    var controls = Array.from(document.querySelectorAll('button, input, select'));
    var disabled = controls.map(function (el) { return el.disabled; });
    controls.forEach(function (el) { el.disabled = true; });
    var error = null;
    try { await action(); } catch (e) { error = e; }
    controls.forEach(function (el, i) { el.disabled = disabled[i]; });
    renderAccount();
    renderScore();
    renderSettings();
    HB.game.start(error ? previous.id : HB.store.data.currentLevel, error ? previous.mode : 'normal');
    if (error) {
      $('saveStatus').textContent = '账户操作失败：' + error.message;
      $('saveStatus').classList.add('save-error');
    } else {
      $('newPlayerName').value = '';
      renderSaveStatus();
    }
  }

  function initAccountDialogs() {
    var manager = $('deactivatedPlayersDialog');
    var list = $('deactivatedPlayerList');
    var confirmation = $('accountConfirmDialog');
    var confirmationAction = null;

    function renderDeactivatedPlayers() {
      list.innerHTML = '';
      var players = deactivatedPlayers();
      if (!players.length) {
        var empty = document.createElement('p');
        empty.className = 'deactivated-empty';
        empty.textContent = '暂时没有已注销账户。';
        list.appendChild(empty);
        return;
      }
      players.forEach(function (player) {
        var row = document.createElement('div');
        row.className = 'deactivated-player-row';
        var profile = document.createElement('span');
        profile.className = 'deactivated-player-name';
        profile.textContent = player.avatar + ' ' + player.name;
        var remove = document.createElement('button');
        remove.className = 'ghost-btn deactivated-delete-btn';
        remove.type = 'button';
        remove.dataset.playerId = player.id;
        remove.textContent = '永久删除';
        row.appendChild(profile);
        row.appendChild(remove);
        list.appendChild(row);
      });
    }

    function openManager() {
      if (manager.open) return;
      renderDeactivatedPlayers();
      manager.showModal();
      $('closeDeactivatedBtn').focus({ preventScroll: true });
    }

    function requestConfirmation(title, message, label, action) {
      if (confirmation.open) return;
      $('accountConfirmTitle').textContent = title;
      $('accountConfirmText').textContent = message;
      $('accountConfirmBtn').textContent = label;
      confirmationAction = action;
      confirmation.showModal();
      $('accountConfirmCancel').focus({ preventScroll: true });
    }

    $('deactivatePlayerBtn').addEventListener('click', function () {
      var activeCount = HB.store.players.filter(function (player) { return player.deactivated !== true; }).length;
      var suffix = activeCount === 1
        ? '当前没有其他可用账户，系统会新建一个空白账户继续使用游戏。'
        : '系统会自动切换到其他可用账户。';
      requestConfirmation('确认注销当前账户？', '注销后，当前账户不会出现在下拉列表中，但数据仍会保留。' + suffix, '确认注销', function () {
        return HB.store.deactivatePlayer(HB.store.data.id);
      });
    });
    $('manageDeactivatedBtn').addEventListener('click', openManager);
    $('closeDeactivatedBtn').addEventListener('click', function () { manager.close(); });
    list.addEventListener('click', function (event) {
      var button = event.target.closest('.deactivated-delete-btn');
      if (!button) return;
      var player = deactivatedPlayers().find(function (item) { return item.id === button.dataset.playerId; });
      if (!player) return;
      manager.close();
      requestConfirmation('永久删除“' + player.name + '”？', '删除后，该账户的积分、关卡和设置会从本机数据库彻底移除，无法恢复。', '永久删除', function () {
        return HB.store.deleteDeactivatedPlayer(player.id);
      });
    });
    $('accountConfirmCancel').addEventListener('click', function () { confirmation.close(); });
    $('accountConfirmBtn').addEventListener('click', function () {
      var action = confirmationAction;
      confirmation.close();
      confirmationAction = null;
      if (action) changePlayer(action);
    });
  }

  function renderLevels() {
    var host = $('levelList');
    var scroll = host.scrollTop;
    host.innerHTML = '';
    var d = HB.store.data;
    var state = HB.game.state, free = state.mode !== 'normal';
    var current = state.level ? state.level.id : d.currentLevel;
    HB.levels.chapters.forEach(function (ch) {
      var name = document.createElement('div');
      name.className = 'chapter-name';
      name.textContent = ch.name;
      host.appendChild(name);
      var row = document.createElement('div');
      row.className = 'chapter-row';
      for (var id = ch.from; id <= ch.to; id++) {
        (function (id) {
          var stars = d.stars[id] || 0;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lv-btn';
          var paywall = !licensed(id);
          var locked = paywall || (!free && id > d.unlocked);
          btn.disabled = locked && !paywall;
          if (paywall) btn.classList.add('paywall');
          if (stars > 0) btn.classList.add('done');
          if (id === current) btn.classList.add('current');
          var label = id;
          btn.setAttribute('aria-label', '第 ' + id + ' 关 ' + HB.levels.list[id - 1].name +
            (paywall ? '，完整版关卡，需要激活' : locked ? '，未解锁' : ''));
          btn.dataset.level = id;
          btn.innerHTML = '<span>' + label + '</span><span class="stars">' +
            [1, 2, 3].map(function (i) { return '<i class="' + (stars >= i ? 'on' : '') + '">★</i>'; }).join('') +
            '</span>';
          btn.title = HB.levels.list[id - 1].name;
          btn.addEventListener('click', function () {
            if (!licensed(id)) {
              bubble('这是完整版关卡，输入激活码后就能畅玩啦～', 'idle');
              openLicenseDialog();
              return;
            }
            var practice = HB.game.state.mode !== 'normal';
            if (!practice && id > HB.store.data.unlocked) return;
            HB.audio.play('click');
            HB.game.start(id, practice ? 'free' : 'normal');
          });
          row.appendChild(btn);
        })(id);
      }
      host.appendChild(row);
    });
    host.scrollTop = scroll;
    var selection = d.id + ':' + current;
    if (selection !== mapSelection) {
      var active = host.querySelector('.current');
      if (active) host.scrollTop += active.getBoundingClientRect().top - host.getBoundingClientRect().top - 30;
      mapSelection = selection;
    }
  }

  function renderMaterials() {
    var host = $('materialPicker');
    host.innerHTML = '';
    var cur = HB.store.data.settings.material;
    Object.keys(MAT_LABEL).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mat-btn' + (key === cur ? ' on' : '');
      b.dataset.mat = key;
      b.innerHTML = '<i></i><span>' + MAT_LABEL[key] + '</span>';
      b.addEventListener('click', function () {
        HB.audio.play('click');
        setMaterial(key);
      });
      host.appendChild(b);
    });
  }

  function setMaterial(key) {
    HB.store.data.settings.material = key;
    HB.store.save();
    HB.board.applyMaterial(key);
    if (HB.game && HB.game.retint) HB.game.retint();
    Array.prototype.forEach.call(document.querySelectorAll('.mat-btn'), function (b) {
      b.classList.toggle('on', b.dataset.mat === key);
    });
  }

  function setSwitch(el, on) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function renderSettings() {
    var s = HB.store.data.settings;
    setSwitch($('soundToggle'), !!s.sound);
    $('soundToggle').querySelector('span').textContent = s.sound ? '开' : '关';
    setSwitch($('motionToggle'), s.motion === 'full');
    $('motionToggle').querySelector('span').textContent = s.motion === 'full' ? '完整' : '精简';
    document.body.dataset.motion = s.motion;
    renderMaterials();
  }

  var bubbleTimer = 0;
  function bubble(text, mood) {
    var b = $('mascotBubble');
    var face = $('mascotFace');
    if (text) b.textContent = text;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    if (mood) {
      face.textContent = rnd(FACES[mood] || FACES.idle);
      face.classList.remove('happy', 'sad');
      void face.offsetWidth;
      if (mood === 'correct' || mood === 'win') face.classList.add('happy');
      if (mood === 'wrong') face.classList.add('sad');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () {
        face.textContent = rnd(FACES.idle);
      }, 1600);
    }
  }

  function say(kind) { bubble(rnd(WORDS[kind]), kind); }

  function licensed(id) {
    return HB.license && typeof HB.license.canPlay === 'function'
      ? HB.license.canPlay(id) : HB.levels.isFree(id);
  }

  function refreshPracticeOptions() {
    var select = $('practiceLevel');
    Array.prototype.forEach.call(select.options, function (option) {
      option.disabled = !licensed(Number(option.value));
    });
    if (select.selectedOptions[0] && select.selectedOptions[0].disabled) {
      for (var i = 0; i < select.options.length; i++) {
        if (!select.options[i].disabled) { select.selectedIndex = i; break; }
      }
    }
  }

  function openLicenseDialog() {
    var dialog = $('licenseDialog');
    if (!HB.license || dialog.open) return;
    $('licenseError').hidden = true;
    dialog.showModal();
    $('licenseCode').focus({ preventScroll: true });
  }

  function renderLicense() {
    if (!HB.license) return;
    var status = HB.license.status();
    $('licenseStatus').textContent = status.active
      ? '（已激活）激活码 ' + status.serial
      : status.reason === 'machine'
        ? '（未激活）授权绑定其他设备'
        : status.reason === 'invalid'
          ? '（未激活）授权校验失败'
          : '（未激活）';
    $('licenseActivateBtn').textContent = status.active ? '更换激活码' : '输入激活码';
    $('licenseExportBtn').hidden = !status.active;
    $('licenseImportBtn').hidden = status.active;
    HB.license.machineId().then(function (mid) {
      $('licenseMachine').textContent = '设备码 ' + mid.slice(0, 4) + '-' + mid.slice(4, 8) +
        '-' + mid.slice(8, 12) + '-' + mid.slice(12, 16);
    });
    refreshPracticeOptions();
    renderLevels();
    renderMode();
  }

  function initLicenseDialog() {
    var dialog = $('licenseDialog');
    $('licenseActivateBtn').addEventListener('click', openLicenseDialog);
    $('licenseCopyMachineBtn').addEventListener('click', function () {
      HB.license.machineId().then(function (mid) {
        var fail = function () { bubble('复制失败，设备码：' + mid, 'idle'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(mid).then(function () {
            bubble('设备码已复制，发给卖家即可换取本机绑定码。', 'win');
          }, fail);
        } else fail();
      });
    });
    $('licenseCancelBtn').addEventListener('click', function () { dialog.close(); });
    $('licenseConfirmBtn').addEventListener('click', function () {
      var error = $('licenseError');
      error.hidden = true;
      HB.license.activate($('licenseCode').value).then(function () {
        dialog.close();
        $('licenseCode').value = '';
        renderLicense();
        HB.audio.play('win');
        bubble('完整版已激活，全部关卡开放！', 'win');
      }).catch(function (e) {
        error.textContent = e && e.message ? e.message : '激活失败，请检查激活码';
        error.hidden = false;
      });
    });
    $('licenseExportBtn').addEventListener('click', function () {
      var blob = new Blob([HB.license.exportFile()], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'hundred-board-license.hblicense';
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
    });
    $('licenseImportBtn').addEventListener('click', function () { $('licenseFile').click(); });
    $('licenseFile').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (!file) return;
      file.text().then(function (text) { return HB.license.importFile(text); })
        .then(function () { renderLicense(); bubble('授权文件已导入，完整版已激活。', 'win'); })
        .catch(function (e) { bubble('导入失败：' + (e && e.message ? e.message : '文件格式不正确'), 'idle'); });
    });
  }

  function showOverlay(opt) {
    var ov = $('overlay');
    var stars = opt.stars;
    $('ovStars').innerHTML = [1, 2, 3].map(function (i) {
      return '<span class="' + (stars >= i ? 'on' : 'off') + '" style="animation-delay:' + (i * 0.14) + 's">★</span>';
    }).join('');
    $('ovStars').hidden = !!(opt.localRace || opt.lost);
    $('ovTitle').textContent = opt.localRace ? opt.winnerName + '获胜！' : opt.lost ? '电脑先到了，再挑战一次！' : opt.race ? '你先到终点，获胜！' : opt.practice ? '练习完成！' : (opt.allDone ? '全部通关！' : (stars === 3 ? '完美通关！' : '闯关成功！'));
    $('ovText').textContent = opt.allDone
      ? HB.levels.total + ' 关全部完成，你就是百数板大师！'
      : '第 ' + opt.levelId + ' 关 · ' + opt.levelName + '（错误 ' + opt.mistakes + ' 次）';
    if (opt.elapsed != null) $('ovText').textContent += ' · 用时 ' + opt.elapsed.toFixed(1) + ' 秒';
    $('ovScore').textContent = opt.localRace ? '双人对战不计积分与星星，不改变解锁进度' : opt.practice ? '本次练习不计积分与星星' : opt.lost ? '本局未通关，不增加积分和星星' : '+' + opt.gained + ' 积分';
    $('ovNext').textContent = opt.nextLabel;
    $('ovNext').hidden = !!opt.last;
    $('ovLicense').hidden = !opt.paywall;
    ov.hidden = false;
    if (!opt.lost) {
      HB.fx.confetti(ov, 46);
      HB.audio.play('win');
    }
    ov._onNext = opt.onNext;
    ov._onReplay = opt.onReplay;
  }

  function hideOverlay() {
    $('overlay').hidden = true;
  }

  function initSupportDialog() {
    var dialog = $('supportDialog');
    var image = $('supportImage');
    var error = $('supportError');
    var close = $('closeSupportBtn');
    var backdropPressed = false;

    function outside(event) {
      var rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
    }

    function open(kind) {
      var content = SUPPORT_IMAGES[kind];
      if (!content || dialog.open) return;
      $('supportTitle').textContent = content.title;
      $('supportNote').textContent = content.note;
      error.hidden = true;
      image.hidden = true;
      image.alt = content.alt;
      image.src = content.src;
      backdropPressed = false;
      dialog.showModal();
      close.focus({ preventScroll: true });
    }

    image.addEventListener('load', function () {
      error.hidden = true;
      image.hidden = false;
    });
    image.addEventListener('error', function () {
      image.hidden = true;
      error.textContent = '图片未能加载，请确认本地文件 ' + image.getAttribute('src') + ' 已放入游戏目录。';
      error.hidden = false;
    });
    $('followBtn').addEventListener('click', function () { open('follow'); });
    $('donateBtn').addEventListener('click', function () { open('donate'); });
    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('pointerdown', function (event) {
      backdropPressed = event.target === dialog && outside(event);
    });
    dialog.addEventListener('click', function (event) {
      if (backdropPressed && event.target === dialog && outside(event)) dialog.close();
      backdropPressed = false;
    });
  }

  function init() {
    renderAccount();
    renderScore();
    renderLevels();
    renderSettings();
    initSupportDialog();
    initAccountDialogs();
    initLicenseDialog();
    HB.store.onStatus = renderSaveStatus;
    renderSaveStatus();
    HB.levels.chapters.forEach(function (chapter) {
      var group = document.createElement('optgroup');
      group.label = chapter.name;
      for (var id = chapter.from; id <= chapter.to; id++) {
        var option = document.createElement('option');
        option.value = id;
        option.textContent = id + ' · ' + HB.levels.list[id - 1].name;
        group.appendChild(option);
      }
      $('practiceLevel').appendChild(group);
    });
    refreshPracticeOptions();
    renderLicense();
    $('freeModeToggle').addEventListener('change', function () {
      HB.game.setMode(this.checked ? 'free' : 'normal');
    });
    $('startPracticeBtn').addEventListener('click', function () {
      var id = Number($('practiceLevel').value);
      if (!licensed(id)) { openLicenseDialog(); return; }
      HB.game.start(id, 'free');
    });
    $('randomLevelBtn').addEventListener('click', function () { HB.game.randomLevel(); });
    $('ovLicense').addEventListener('click', function () {
      $('overlay').hidden = true;
      openLicenseDialog();
    });
    $('playerSelect').addEventListener('change', function () {
      var id = this.value;
      changePlayer(function () { return HB.store.switchPlayer(id); });
    });
    $('createPlayerForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var name = $('newPlayerName').value.trim();
      if (!name) { $('newPlayerName').focus(); return; }
      changePlayer(function () { return HB.store.createPlayer(name); });
    });
    $('retrySaveBtn').addEventListener('click', function () { HB.store.save(); });

    $('avatarBtn').addEventListener('click', function () {
      var p = $('avatarPicker');
      if (!p.hidden) { p.hidden = true; return; }
      p.innerHTML = '';
      AVATARS.forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = a;
        b.addEventListener('click', function () {
          HB.store.data.avatar = a;
          HB.store.save();
          renderAccount();
          p.hidden = true;
          HB.audio.play('click');
        });
        p.appendChild(b);
      });
      p.hidden = false;
    });

    document.addEventListener('click', function (e) {
      var p = $('avatarPicker');
      if (!p.hidden && !p.contains(e.target) && e.target !== $('avatarBtn')) p.hidden = true;
    });

    var nameInput = $('nameInput');
    nameInput.addEventListener('change', function () {
      HB.store.data.name = (nameInput.value || '').trim().slice(0, 8) || '小玩家';
      nameInput.value = HB.store.data.name;
      HB.store.save();
      renderAccount();
    });
    nameInput.addEventListener('blur', function () { nameInput.dispatchEvent(new Event('change')); });

    $('soundToggle').addEventListener('click', function () {
      var s = HB.store.data.settings;
      s.sound = !s.sound;
      HB.store.save();
      renderSettings();
      if (s.sound) HB.audio.play('correct');
    });

    $('motionToggle').addEventListener('click', function () {
      var s = HB.store.data.settings;
      s.motion = s.motion === 'full' ? 'lite' : 'full';
      HB.store.save();
      renderSettings();
      HB.audio.play('click');
    });

    $('ovNext').addEventListener('click', function () {
      var f = $('overlay')._onNext;
      hideOverlay();
      if (f) f();
    });
    $('ovReplay').addEventListener('click', function () {
      var f = $('overlay')._onReplay;
      hideOverlay();
      if (f) f();
    });
  }

  HB.ui = {
    init: init,
    renderAccount: renderAccount,
    renderScore: renderScore,
    renderLevels: renderLevels,
    renderSettings: renderSettings,
    renderMode: renderMode,
    countUp: countUp,
    bubble: bubble,
    say: say,
    showOverlay: showOverlay,
    hideOverlay: hideOverlay
  };
})();
