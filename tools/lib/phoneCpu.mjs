// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  phoneCpu.mjs — a cost harness measures at a phone's CPU speed, not this machine's.
 *
 * A desktop core runs the frame's CPU work several times faster than a phone's, so a cost that reads as nothing here is
 * a missed frame there. Every cost harness slows the page's CPU by the same factor, through the browser's own throttle
 * (the one DevTools' Performance panel offers), and says so beside its numbers. The factor is 5 unless `--slow` or
 * ESTELLA_CPU_SLOWDOWN says otherwise; 1 measures this machine as it is.
 *
 * The throttle slows the page's threads, JavaScript and wasm alike. It does not slow the GPU: a pass's GPU time is
 * this machine's whatever the factor, and only the CPU side of a frame is a phone's.
 */

export const PHONE_CPU_SLOWDOWN = 5;

/** The slowdown a harness runs at: its `--slow`, else ESTELLA_CPU_SLOWDOWN, else a phone's. Throws on a factor below 1. */
export function cpuSlowdown(arg) {
  const raw = arg ?? process.env.ESTELLA_CPU_SLOWDOWN ?? String(PHONE_CPU_SLOWDOWN);
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 1) throw new Error(`a CPU slowdown is a factor of 1 or more, got "${raw}"`);
  return rate;
}

/** Slow `page`'s CPU by `rate` for as long as it lives. Call it before the page loads, so loading is slowed as well. */
export async function slowCpu(page, rate) {
  if (rate === 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

/** The line a harness prints beside its numbers. */
export const slowdownLabel = (rate) => (rate === 1 ? 'CPU at this machine\'s speed' : `CPU slowed x${rate} (a phone; GPU times are not slowed)`);
