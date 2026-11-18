// SPDX-License-Identifier: Apache-2.0
import {expect, it} from 'vitest';
import {runInNewContext} from 'node:vm';
import {packageFramesScript} from '../launchers/packageFrames.mjs';

function fixture() {
  let covered = true, canvas = true, overlay = true, now = 0;
  let next = 0;
  const frames = new Map<number, () => void>(), timers = new Map<number, () => void>();
  const sandbox: Record<string, unknown> = {
    document: {
      querySelector: () => canvas ? {width: 800, height: 600} : null,
      getElementById: () => overlay ? {classList: {contains: () => !covered}} : null,
    },
    Date: {now: () => now},
    requestAnimationFrame: (callback: () => void) => {frames.set(++next, callback); return next;},
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => {timers.set(++next, callback); return next;},
    clearTimeout: (id: number) => timers.delete(id),
  };
  const result = runInNewContext(packageFramesScript(2, 100), sandbox);
  return {result, frames, timers,
    identPlaying: () => {sandbox.__estellaIdentDone = false;},
    identDone: () => {sandbox.__estellaIdentDone = true;},
    uncover: () => {covered = false;},
    cover: () => {covered = true;},
    noOverlay: () => {overlay = false;},
    noCanvas: () => {canvas = false;},
    frame: () => {const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());},
    timeout: () => {now = 101; [...timers.values()].forEach(callback => callback());},
  };
}

it('counts settling frames only after the boot overlay releases input', async () => {
  const f = fixture();
  let complete = false; void f.result.then(() => {complete = true;});
  f.frame(); f.frame(); await Promise.resolve();
  expect(complete).toBe(false);
  f.uncover(); f.frame(); await Promise.resolve();
  expect(complete).toBe(false);
  f.frame(); expect(await f.result).toMatchObject({ok: true, frames: 2});
  expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
});

it.each(['boot', 'canvas'])('the deadline finishes a stalled %s without another animation frame', async phase => {
  const f = fixture();
  if (phase === 'canvas') {f.uncover(); f.noCanvas();}
  let result: unknown; void f.result.then((value: unknown) => {result = value;});
  f.frame(); f.timeout(); await Promise.resolve();
  expect(result).toMatchObject({ok: false, frames: 0, phase});
  expect(f.frames.size).toBe(0); expect(f.timers.size).toBe(0);
});

it('waits for the runtime to say the ident has gone, even once the overlay has let go', async () => {
  const f = fixture();
  let complete = false; void f.result.then(() => {complete = true;});
  f.identPlaying(); f.uncover(); f.frame(); f.frame(); f.frame(); await Promise.resolve();
  expect(complete).toBe(false);
  f.identDone(); f.frame(); await Promise.resolve();
  expect(complete).toBe(false);
  f.frame(); expect(await f.result).toMatchObject({ok: true, frames: 2});
});

it('retains settling for older exports without a startup overlay', async () => {
  const f=fixture();f.noOverlay();f.frame();f.frame();
  expect(await f.result).toMatchObject({ok:true,frames:2});
});

it('requires consecutive ready frames if the overlay returns', async () => {
  const f=fixture();let done=false;void f.result.then(()=>{done=true;});
  f.uncover();f.frame();f.cover();f.frame();f.uncover();f.frame();
  await Promise.resolve();expect(done).toBe(false);
  f.frame();expect(await f.result).toMatchObject({ok:true,frames:2});
});

it.each([[NaN,100],[Infinity,100],[-1,100],[2,NaN],[2,Infinity],[2,-1]])(
  'rejects an unbounded wait: settle=%s timeout=%s', (settle,timeout) => {
    expect(()=>packageFramesScript(settle,timeout)).toThrow('finite timeout');
  });
