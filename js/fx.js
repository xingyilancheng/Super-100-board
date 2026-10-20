/* 视觉特效：飞入尾迹 / 落点爆星 / 错误摆动 / 庆祝彩带 */
(function () {
  'use strict';
  window.HB = window.HB || {};

  function layer() { return document.getElementById('fxLayer'); }
  function lite() { return HB.store.data.settings.motion !== 'full'; }

  function makeTile(size, num, cls, hue) {
    var el = document.createElement('div');
    el.className = 'tile-look ' + cls;
    el.textContent = num;
    el.style.width = el.style.height = size + 'px';
    el.style.fontSize = Math.round(size * 0.44) + 'px';
    if (hue != null) el.style.setProperty('--h', hue);
    return el;
  }

  function centerOf(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

  /* ---------- 飞入（抛物线 + 尾迹） ---------- */
  function flyTo(opt) {
    var from = opt.fromEl.getBoundingClientRect();
    var to = opt.toEl.getBoundingClientRect();
    var host = layer();
    var fast = lite();
    var hue = opt.hue;
    var size = Math.max(22, Math.round(Math.min(to.width, to.height) * 1.25));
    var head = makeTile(size, opt.num, 'fly-tile', hue);
    host.appendChild(head);

    var s = centerOf(from), t = centerOf(to);
    var dx = t.x - s.x, dy = t.y - s.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var lift = Math.min(230, 70 + dist * 0.36);
    var cx = (s.x + t.x) / 2 + dy * 0.1;
    var cy = (s.y + t.y) / 2 - lift;
    var dur = fast ? 240 : Math.round(Math.min(900, 420 + dist * 0.42));

    var N = fast ? 2 : 28;
    var frames = [];
    for (var i = 0; i <= N; i++) {
      var p = i / N;
      var e = p * p * (3 - 2 * p);            /* 起步/落点缓入缓出 */
      var m = 1 - e;
      var x = m * m * s.x + 2 * m * e * cx + e * e * t.x;
      var y = m * m * s.y + 2 * m * e * cy + e * e * t.y;
      var sc = 1.12 - 0.14 * e - 0.1 * p;
      var rot = fast ? 0 : (p * 320 - 20);
      frames.push({
        offset: p,
        transform: 'translate(' + (x - size / 2) + 'px,' + (y - size / 2) + 'px) rotate(' + rot.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')'
      });
    }
    var anim = head.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' });

    /* 尾迹：跟随头部实时位置生成残影 + 星尘 */
    var t0 = performance.now();
    var lastGhost = 0, lastSpark = 0, raf = 0, incoming = false;
    if (!fast) {
      var tick = function (now) {
        var el = now - t0;
        if (el >= dur) return;
        var r = head.getBoundingClientRect();
        var hx = r.left + r.width / 2, hy = r.top + r.height / 2;
        if (el - lastGhost > 78) {
          lastGhost = el;
          ghost(hx, hy, size * 0.92, opt.num, hue);
        }
        if (el - lastSpark > 26) {
          lastSpark = el;
          spark(hx, hy, 4 + Math.random() * 12, hue, 0);
        }
        if (!incoming && el > dur * 0.55) {
          incoming = true;
          opt.toEl.classList.add('incoming');
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    var cancelled = false;
    function finish() {
      if (raf) cancelAnimationFrame(raf);
      head.remove();
      opt.toEl.classList.remove('incoming');
      if (!cancelled && opt.onDone) opt.onDone();
    }
    if (anim.finished) anim.finished.then(finish, function () {}); else anim.onfinish = finish;
    return function () {
      cancelled = true;
      anim.cancel();
      finish();
    };
  }

  function ghost(x, y, size, num, hue) {
    var el = makeTile(Math.round(size), num, 'fly-trail', hue);
    el.style.opacity = '.5';
    layer().appendChild(el);
    var kf = [
      { transform: 'translate(' + (x - size / 2) + 'px,' + (y - size / 2) + 'px) scale(1)', opacity: .5 },
      { transform: 'translate(' + (x - size / 2) + 'px,' + (y - size / 2) + 'px) scale(.42)', opacity: 0 }
    ];
    var a = el.animate(kf, { duration: 360, easing: 'ease-out', fill: 'forwards' });
    if (a.finished) a.finished.then(function () { el.remove(); }); else a.onfinish = function () { el.remove(); };
  }

  function spark(x, y, size, hue, kind) {
    var el = document.createElement('div');
    el.className = 'spark' + (kind === 1 ? ' star' : '');
    el.style.width = el.style.height = size + 'px';
    el.style.fontSize = size + 'px';
    if (kind === 1) el.textContent = '✦';
    el.style.setProperty('--h', (Number(hue || 0) + Math.random() * 60 - 30).toFixed(0));
    layer().appendChild(el);
    var jx = (Math.random() - 0.5) * 14, jy = (Math.random() - 0.5) * 14;
    var kf = [
      { transform: 'translate(' + (x - size / 2 + jx) + 'px,' + (y - size / 2 + jy) + 'px) scale(1)', opacity: .95 },
      { transform: 'translate(' + (x - size / 2 + jx + (Math.random() - .5) * 26) + 'px,' + (y - size / 2 + jy + (Math.random() - .5) * 26) + 'px) scale(0)', opacity: 0 }
    ];
    var a = el.animate(kf, { duration: 300 + Math.random() * 240, easing: 'ease-out', fill: 'forwards' });
    if (a.finished) a.finished.then(function () { el.remove(); }); else a.onfinish = function () { el.remove(); };
  }

  /* ---------- 落点特效 ---------- */
  function land(el, hue) {
    var r = el.getBoundingClientRect();
    var c = centerOf(r);
    var ring = document.createElement('div');
    ring.className = 'ripple';
    var size = Math.max(r.width, r.height) * 0.9;
    ring.style.width = ring.style.height = size + 'px';
    ring.style.setProperty('--h', hue);
    if (hue != null) ring.style.borderColor = 'hsl(' + hue + ' 95% 70%)';
    layer().appendChild(ring);
    var kf = [
      { transform: 'translate(' + (c.x - size / 2) + 'px,' + (c.y - size / 2) + 'px) scale(.5)', opacity: .9, borderWidth: '4px' },
      { transform: 'translate(' + (c.x - size / 2) + 'px,' + (c.y - size / 2) + 'px) scale(2.1)', opacity: 0, borderWidth: '1px' }
    ];
    var a = ring.animate(kf, { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    if (a.finished) a.finished.then(function () { ring.remove(); }); else a.onfinish = function () { ring.remove(); };

    var n = lite() ? 4 : 9;
    for (var i = 0; i < n; i++) {
      (function (i) {
        setTimeout(function () { spark(c.x, c.y, 10 + Math.random() * 12, hue, 1); }, i * 26);
      })(i);
    }
  }

  function floatText(x, y, text, cls) {
    var el = document.createElement('div');
    el.className = 'float-text ' + (cls || '');
    el.textContent = text;
    el.style.transform = 'translate(' + (x - 20) + 'px,' + (y - 12) + 'px)';
    layer().appendChild(el);
    var a = el.animate([
      { transform: 'translate(' + (x - 20) + 'px,' + (y - 12) + 'px) scale(.7)', opacity: 0 },
      { transform: 'translate(' + (x - 20) + 'px,' + (y - 46) + 'px) scale(1.15)', opacity: 1, offset: .35 },
      { transform: 'translate(' + (x - 20) + 'px,' + (y - 92) + 'px) scale(1)', opacity: 0 }
    ], { duration: 1000, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    if (a.finished) a.finished.then(function () { el.remove(); }); else a.onfinish = function () { el.remove(); };
  }

  /* ---------- 错误摆动 ---------- */
  function shakeWrong(el) {
    el.classList.remove('wrong-shake', 'wrong-tint');
    void el.offsetWidth;
    el.classList.add('wrong-shake', 'wrong-tint');
    var done = function () {
      el.classList.remove('wrong-shake', 'wrong-tint');
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
  }

  /* ---------- 彩带庆祝 ---------- */
  function confetti(host, count) {
    var colors = ['#ff8fb1', '#ffc86b', '#7fe0b8', '#8fc9ff', '#c9a7ff', '#ff9f7f'];
    var n = lite() ? Math.min(14, count) : count;
    for (var i = 0; i < n; i++) {
      var el = document.createElement('i');
      el.className = 'confetti';
      el.style.left = (Math.random() * 100) + '%';
      el.style.background = colors[i % colors.length];
      el.style.animation = 'confettiFall ' + (1.6 + Math.random() * 1.6) + 's linear ' + (Math.random() * .6) + 's forwards';
      el.style.width = (7 + Math.random() * 8) + 'px';
      el.style.height = (10 + Math.random() * 10) + 'px';
      el.style.opacity = String(.75 + Math.random() * .25);
      host.appendChild(el);
      setTimeout(function (node) { return function () { node.remove(); }; }(el), 4200);
    }
  }

  HB.fx = {
    flyTo: flyTo,
    land: land,
    spark: spark,
    floatText: floatText,
    shakeWrong: shakeWrong,
    confetti: confetti
  };
})();
