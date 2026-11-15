// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import os from 'node:os';

const TICK_MS = 1000;
const STALL_MS = 5000;
const MAX_STALLS = 40;
const MB = 1024 * 1024;

function swapUsedMb() {
  try {
    const info = readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1] ?? 0);
    return Math.round((kb('SwapTotal') - kb('SwapFree')) / 1024);
  } catch {
    return 0;
  }
}

function sample() {
  return {
    at: new Date().toISOString(),
    freeMb: Math.round(os.freemem() / MB),
    swapMb: swapUsedMb(),
    rssMb: Math.round(process.memoryUsage().rss / MB),
    load: Number(os.loadavg()[0].toFixed(1)),
  };
}

export function watchMainProcess(now = () => performance.now()) {
  const stalls = [];
  let ticks = 0;
  let worstStallMs = 0;
  let lowest = sample();
  let mostSwap = lowest;
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const stallMs = Math.round(at - last - TICK_MS);
    last = at;
    ticks++;
    const seen = sample();
    if (seen.freeMb < lowest.freeMb) lowest = seen;
    if (seen.swapMb > mostSwap.swapMb) mostSwap = seen;
    if (stallMs > worstStallMs) worstStallMs = stallMs;
    if (stallMs >= STALL_MS && stalls.length < MAX_STALLS) stalls.push({ stallMs, ...seen });
  }, TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    return { ticks, worstStallMs, totalMb: Math.round(os.totalmem() / MB), cpus: os.cpus().length, lowest, mostSwap, stalls };
  };
}

export function formatDiagnostics(report) {
  const line = (s) => `${s.at} free ${s.freeMb} MB, swap ${s.swapMb} MB, main rss ${s.rssMb} MB, load ${s.load}`;
  const out = [
    `[engine-test-diagnostics] ${report.cpus} cpu(s), ${report.totalMb} MB; ${report.ticks} tick(s); the main process was held for at most ${report.worstStallMs} ms`,
    `[engine-test-diagnostics] least free memory: ${line(report.lowest)}`,
    `[engine-test-diagnostics] most swap in use: ${line(report.mostSwap)}`,
  ];
  for (const s of report.stalls) out.push(`[engine-test-diagnostics] held ${s.stallMs} ms until ${line(s)}`);
  return out.join('\n');
}

export default function setup() {
  const stop = watchMainProcess();
  return () => {
    console.log(formatDiagnostics(stop()));
  };
}
