/* 轻量音效：用 WebAudio 现场合成，无需音频素材 */
(function () {
  'use strict';
  window.HB = window.HB || {};

  var ctx = null;

  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(opt) {
    var a = ac();
    if (!a) return;
    var t0 = a.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.16;
    var osc = a.createOscillator();
    var gain = a.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq || 440, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opt.to), t0 + dur);
    var vol = opt.vol == null ? 0.16 : opt.vol;
    var atk = opt.atk == null ? 0.012 : opt.atk;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  var VOICES = {
    click: function () { tone({ freq: 720, dur: 0.06, type: 'triangle', vol: 0.1 }); },
    pick: function () { tone({ freq: 520, to: 880, dur: 0.14, type: 'triangle', vol: 0.13 }); },
    correct: function () {
      [659.25, 783.99, 987.77].forEach(function (f, i) {
        tone({ freq: f, dur: 0.22, delay: i * 0.07, type: 'triangle', vol: 0.15 });
      });
    },
    wrong: function () {
      tone({ freq: 300, to: 190, dur: 0.26, type: 'sine', vol: 0.13 });
      tone({ freq: 226, to: 150, dur: 0.26, delay: 0.02, type: 'triangle', vol: 0.07 });
    },
    hint: function () { tone({ freq: 1180, dur: 0.1, type: 'sine', vol: 0.1 }); tone({ freq: 1560, dur: 0.12, delay: 0.09, type: 'sine', vol: 0.09 }); },
    win: function () {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
        tone({ freq: f, dur: 0.4, delay: i * 0.1, type: 'triangle', vol: 0.15 });
      });
    },
    star: function () { tone({ freq: 1320, to: 1760, dur: 0.18, type: 'sine', vol: 0.1 }); }
  };

  HB.audio = {
    unlock: function () { ac(); },
    play: function (name) {
      if (!HB.store.data.settings.sound) return;
      var v = VOICES[name];
      if (!v) return;
      try { v(); } catch (e) { /* 音频不可用则静默 */ }
    }
  };
})();
