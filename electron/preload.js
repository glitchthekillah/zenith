// The bridge between the interface and the desktop app. Only these calls are exposed.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('zenith', (e, msg) => { for (const fn of listeners) { try { fn(msg.channel, msg.data); } catch {} } });

contextBridge.exposeInMainWorld('zenithDesktop', {
  http: (url, opts) => ipcRenderer.invoke('http', url, opts),
  forget: (origin) => ipcRenderer.invoke('http-forget', origin),
  info: () => ipcRenderer.invoke('info'),
  win: (action, arg) => ipcRenderer.invoke('win', action, arg),
  open: (url) => ipcRenderer.invoke('open', url),
  showFile: (file) => ipcRenderer.invoke('show-file', file),
  download: (job) => ipcRenderer.invoke('download', job),
  cancelDownload: (id) => ipcRenderer.invoke('download-cancel', id),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  checkUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  discord: (activity) => ipcRenderer.invoke('discord', activity),
  webLogin: (url) => ipcRenderer.invoke('web-login', url),
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
});
