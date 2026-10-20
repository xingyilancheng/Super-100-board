(function () {
  'use strict';

  function showBootError() {
    var panel = document.getElementById('bootError') || document.createElement('div');
    panel.id = 'bootError';
    panel.textContent = '游戏启动失败，已停止运行。请关闭其他游戏窗口后重新加载页面；若仍然失败，请检查浏览器是否允许本地存储。';
    panel.hidden = false;
    panel.inert = false;
    panel.removeAttribute('aria-hidden');
    panel.setAttribute('role', 'alert');
    panel.tabIndex = -1;
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:32px;background:#fff8ee;color:#642d20;font:20px/1.6 sans-serif;white-space:normal;';
    document.body.appendChild(panel);
    Array.prototype.forEach.call(document.body.children, function (element) {
      if (element !== panel) element.inert = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('button,input,select,textarea'), function (element) {
      element.disabled = true;
    });
    document.body.dataset.bootState = 'error';
    panel.focus();
  }

  async function boot() {
    try {
      await HB.store.init();
      if (HB.license) await HB.license.load();
      document.body.dataset.motion = HB.store.data.settings.motion;
      HB.board.render();
      HB.ui.init();
      HB.game.init();
      HB.game.start(HB.store.data.currentLevel || 1);

      var unlock = function () {
        HB.audio.unlock();
        document.removeEventListener('pointerdown', unlock);
      };
      document.addEventListener('pointerdown', unlock);
    } catch (error) {
      showBootError();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
