// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { appendFileSync, mkdirSync } from 'node:fs';
import { freemem, totalmem, loadavg } from 'node:os';
import path from 'node:path';

export const LAUNCH_LOG_DIR = process.env.ESTELLA_LAUNCH_LOG_DIR || '';

export function contextProbeScript() {
  if (!LAUNCH_LOG_DIR) return '';
  return `<script>(() => {
    let made = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, attrs) {
      const ctx = real.call(this, kind, attrs);
      if (ctx && /webgl/.test(kind) && !this.__launchWatched) {
        this.__launchWatched = true;
        const id = ++made;
        console.info('[launch] context ' + id + ' ' + kind + ' ' + this.width + 'x' + this.height + ' at ' + Math.round(performance.now()) + 'ms, attrs ' + JSON.stringify(attrs || {}));
        this.addEventListener('webglcontextlost', (e) => console.info('[launch] context ' + id + ' lost at ' + Math.round(performance.now()) + 'ms: ' + (e.statusMessage || 'no status')));
        this.addEventListener('webglcontextrestored', () => console.info('[launch] context ' + id + ' restored at ' + Math.round(performance.now()) + 'ms'));
      }
      return ctx;
    };
  })();</script>`;
}

export function openLaunchLog(app, webContents, name) {
  if (!LAUNCH_LOG_DIR) return { note() {}, close() {} };
  mkdirSync(LAUNCH_LOG_DIR, { recursive: true });
  const file = path.join(LAUNCH_LOG_DIR, `${name}-${Date.now()}-${process.pid}.log`);
  const began = Date.now();
  const write = (line) => { try { appendFileSync(file, `${String(Date.now() - began).padStart(6)}ms ${line}\n`); } catch { } };
  write(`launch ${name} pid ${process.pid} load ${loadavg().map((n) => n.toFixed(2)).join(' ')} free ${Math.round(freemem() / 1048576)}/${Math.round(totalmem() / 1048576)} MB`);
  write(`gpu features ${JSON.stringify(app.getGPUFeatureStatus())}`);
  void app.getGPUInfo('basic').then((info) => write(`gpu info ${JSON.stringify(info)}`), (e) => write(`gpu info failed ${e}`));
  const onConsole = ({ message, level }) => write(`[${level}] ${message}`);
  const onChildGone = (_e, d) => write(`child process gone ${JSON.stringify(d)}`);
  const onRenderGone = (_e, d) => write(`render process gone ${JSON.stringify(d)}`);
  const onGpuInfo = () => write('gpu info updated');
  webContents.on('console-message', onConsole);
  app.on('child-process-gone', onChildGone);
  app.on('gpu-info-update', onGpuInfo);
  webContents.on('render-process-gone', onRenderGone);
  const sample = setInterval(() => {
    const metrics = app.getAppMetrics().map((m) => `${m.type}:${Math.round((m.memory?.workingSetSize ?? 0) / 1024)}MB/${(m.cpu?.percentCPUUsage ?? 0).toFixed(0)}%`).join(' ');
    write(`metrics free ${Math.round(freemem() / 1048576)} MB load ${loadavg()[0].toFixed(2)} ${metrics}`);
  }, 500);
  return {
    note: write,
    close() {
      clearInterval(sample);
      webContents.removeListener('console-message', onConsole);
      app.removeListener('child-process-gone', onChildGone);
      app.removeListener('gpu-info-update', onGpuInfo);
      write('launch closed');
    },
  };
}
