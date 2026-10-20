/* Electron 主进程：加载本地 index.html，无 Node 注入，窗口状态可记忆 */
'use strict';

const { app, BrowserWindow, shell, screen, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const APP_DIR = path.join(__dirname, '..');
const MIN_W = 1100;
const MIN_H = 720;

let win = null;
let tray = null;
let forceQuit = false;
let machineIdCache = '';

/* 单机绑定指纹：Windows 用 MachineGuid，其他平台用硬件型号，均不上传 */
function machineId() {
  if (machineIdCache) return machineIdCache;
  let seed = process.platform + ':' + os.arch();
  if (process.platform === 'win32') {
    try {
      seed += ':' + execFileSync('reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true });
    } catch (e) { /* 读不到注册表时退回硬件型号 */ }
  }
  try { seed += ':' + os.machine(); } catch (e) {}
  machineIdCache = crypto.createHash('sha256').update(seed).digest('hex');
  return machineIdCache;
}

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    const s = JSON.parse(raw);
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch (e) { /* 首次启动没有存档 */ }
  return { width: 1440, height: 900 };
}

function writeState(w) {
  if (!w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
  const b = w.getNormalBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
  } catch (e) { /* 忽略写入失败 */ }
}

/* 窗口比屏幕还大时（换了小屏幕）回退到居中默认尺寸 */
function fitToScreen(s) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(MIN_W, Math.min(s.width, area.width));
  const height = Math.max(MIN_H, Math.min(s.height, area.height));
  const out = { width, height };
  if (typeof s.x === 'number' && typeof s.y === 'number') {
    const visible =
      s.x >= 0 && s.y >= 0 &&
      s.x + 80 <= area.width && s.y + 60 <= area.height;
    if (visible) {
      out.x = Math.min(s.x, area.width - width);
      out.y = Math.min(s.y, area.height - height);
    }
  }
  return out;
}

function createWindow() {
  const state = fitToScreen(readState());

  win = new BrowserWindow({
    ...state,
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    title: '百数板乐园',
    icon: path.join(APP_DIR, 'assets', 'icon.png'),
    backgroundColor: '#fff4ef',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(APP_DIR, 'index.html'));

  if (win.webContents.setVisualZoomLevelLimits) {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  }

  /* F12 / Ctrl+Shift+I 调试，Ctrl+R 刷新；屏蔽误触缩放快捷键 */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const devTools = key === 'f12' || (input.control && input.shift && key === 'i');
    const reload = input.control && key === 'r';
    if (devTools) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    } else if (reload) {
      event.preventDefault();
      win.webContents.reload();
    } else if (input.control && (key === '+' || key === '-' || key === '=' || key === '0')) {
      event.preventDefault();
    }
  });

  /* 站内跳转留在窗口内，外部链接交给系统浏览器 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  const persist = () => writeState(win);
  win.on('resize', persist);
  win.on('move', persist);

  /* 关闭前询问：最小化到托盘 / 退出 / 取消 */
  win.on('close', (event) => {
    persist();
    if (forceQuit) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['最小化到托盘', '退出程序', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '关闭百数板乐园',
      message: '要退出游戏吗？',
      detail: '选择「最小化到托盘」可继续在后台运行，从右下角托盘图标随时唤回。'
    });
    if (choice === 0) {
      win.hide();
    } else if (choice === 1) {
      forceQuit = true;
      app.quit();
    }
  });

  win.on('closed', () => { win = null; });
}

/* 托盘图标：单击唤回窗口，右键菜单可显示或退出 */
function createTray() {
  const iconPath = path.join(APP_DIR, 'assets', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  image = image.resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('百数板乐园');
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { forceQuit = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.hundredboard.kids');
    ipcMain.handle('hb-machine-id', () => machineId());
    createWindow();
    createTray();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => { forceQuit = true; });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
