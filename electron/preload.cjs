/* 沙箱预加载：只暴露机器指纹查询，不暴露 Node 能力 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('HB_HOST', {
  machineId: () => ipcRenderer.invoke('hb-machine-id')
});
