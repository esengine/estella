// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The JS-side value tween manager (the fallback path for fields the C++
 *        TweenTarget doesn't cover). Pure timing/easing/loop/sequence logic —
 *        the only wasm touchpoint is polling a linked C++ sequence's state, which
 *        a stub module stands in for. It sat at ~20% with none of its branches
 *        (delay carry-over, ping-pong, loop counts, chaining, same-frame resume)
 *        asserted.
 */
import { describe, it, expect, vi } from 'vitest';
import { ValueTweenManager, ValueTweenHandle } from '../src/animation/ValueTween';
import { TweenGroup } from '../src/animation/TweenGroup';
import { TweenState, LoopMode } from '../src/animation/TweenTypes';
import type { CppRegistry } from '../src/wasm';
import type { AnimCore } from '../src/animation/Tween';

// The manager only ever calls module.anim_getTweenState (for C++ sequences);
// everything else is pure JS. A closure-controlled stub covers that one seam.
function makeManager(cppState: () => number = () => TweenState.Running) {
  const module = { anim_getTweenState: vi.fn(() => cppState()) } as unknown as AnimCore;
  const registry = {} as CppRegistry;
  return new ValueTweenManager(module, registry);
}

describe('ValueTweenManager progression', () => {
  it('drives the callback with the linearly-eased value', () => {
    const m = makeManager();
    const seen: number[] = [];
    m.create(0, 100, 1, (v) => seen.push(v));
    m.update(0.25);
    m.update(0.25);
    expect(seen).toEqual([25, 50]);
  });

  it('delivers the end value, then stays queryable as Completed until the NEXT update', () => {
    const m = makeManager();
    let last = -1;
    const id = m.create(10, 30, 1, (v) => { last = v; });
    m.update(1);
    expect(last).toBe(30);
    // Sweep is deferred one frame: a just-completed entry stays queryable as
    // Completed for the rest of this frame so a composition polling afterwards
    // observes Completed (not a same-frame-deleted → Cancelled). It's reaped at
    // the start of the next update.
    expect(m.getState(id)).toBe(TweenState.Completed);
    m.update(0.016);
    expect(m.getState(id)).toBe(TweenState.Cancelled);
  });

  it('a parallel group of value tweens completes (not stuck as Cancelled)', () => {
    const m = makeManager();
    const id = m.create(0, 1, 1, () => {});
    // How a composition observes a member: a Completable reading the live state.
    const member = { get state() { return m.getState(id); }, pause() {}, resume() {}, cancel() {} };
    let done = false;
    const group = new TweenGroup([member]);
    group.onComplete(() => { done = true; });
    // TweenAPI.update order: value manager advances/completes first, THEN the
    // composition polls. The completed member must read Completed, not Cancelled.
    m.update(1);
    expect(group.checkComplete()).toBe(true);
    expect(done).toBe(true);
  });

  it('holds during the delay, then applies the leftover dt once it elapses', () => {
    const m = makeManager();
    const seen: number[] = [];
    m.create(0, 100, 1, (v) => seen.push(v), { delay: 0.5 });
    m.update(0.3);          // still inside the delay
    expect(seen).toEqual([]);
    m.update(0.3);          // 0.1 of dt spills past the delay into the tween
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(10, 6); // ~0.1s into a 1s 0→100 tween (float carry)
  });
});

describe('ValueTweenManager state transitions', () => {
  it('pause() freezes progress and resume() thaws it', () => {
    const m = makeManager();
    const seen: number[] = [];
    const id = m.create(0, 100, 1, (v) => seen.push(v));
    m.pause(id);
    m.update(0.5);
    expect(seen).toEqual([]);
    expect(m.getState(id)).toBe(TweenState.Paused);
    m.resume(id);
    m.update(0.5);
    expect(seen).toEqual([50]);
  });

  it('cancel() stops the tween and drops it on the next update', () => {
    const m = makeManager();
    const cb = vi.fn();
    const id = m.create(0, 100, 1, cb);
    m.cancel(id);
    expect(m.getState(id)).toBe(TweenState.Cancelled);
    m.update(1);
    expect(cb).not.toHaveBeenCalled();
    expect(m.getState(id)).toBe(TweenState.Cancelled); // swept
  });

  it('getState() reports Cancelled for an unknown id', () => {
    expect(makeManager().getState(999)).toBe(TweenState.Cancelled);
  });
});

describe('ValueTweenManager looping', () => {
  it('Restart replays loopCount times then completes', () => {
    const m = makeManager();
    const seen: number[] = [];
    m.create(0, 10, 1, (v) => seen.push(v), { loop: LoopMode.Restart, loopCount: 2 });
    m.update(1); // first pass reaches 10, loops
    m.update(1); // second pass reaches 10, completes
    expect(seen).toEqual([10, 10]);
  });

  it('PingPong reverses from/to each cycle', () => {
    const m = makeManager();
    const seen: number[] = [];
    m.create(0, 10, 1, (v) => seen.push(v), { loop: LoopMode.PingPong, loopCount: 2 });
    m.update(1); // 0→10
    m.update(1); // now 10→0
    expect(seen).toEqual([10, 0]);
  });

  it('loopCount 0 loops forever (never completes)', () => {
    const m = makeManager();
    const cb = vi.fn();
    const id = m.create(0, 10, 1, cb, { loop: LoopMode.Restart, loopCount: 0 });
    for (let i = 0; i < 4; i++) m.update(1);
    expect(m.getState(id)).toBe(TweenState.Running);
    expect(cb).toHaveBeenCalledTimes(4);
  });
});

describe('ValueTweenManager sequencing', () => {
  it('setSequenceNext pauses the follow-up until the leader completes, then resumes it in-frame', () => {
    const m = makeManager();
    const bSeen: number[] = [];
    const a = m.create(0, 10, 1, () => {});
    const b = m.create(0, 20, 10, (v) => bSeen.push(v)); // long, so it survives its first tick
    m.setSequenceNext(a, b);
    expect(m.getState(b)).toBe(TweenState.Paused);
    m.update(1); // a completes → b resumes and advances by the same dt
    expect(m.getState(b)).toBe(TweenState.Running);
    expect(bSeen).toEqual([2]); // 1s into a 10s 0→20 tween
  });

  it('setSequenceNextExternal pauses the external immediately and resumes it on completion', () => {
    const m = makeManager();
    const ext = { pause: vi.fn(), resume: vi.fn() };
    const a = m.create(0, 10, 1, () => {});
    m.setSequenceNextExternal(a, ext);
    expect(ext.pause).toHaveBeenCalledTimes(1);
    expect(ext.resume).not.toHaveBeenCalled();
    m.update(1);
    expect(ext.resume).toHaveBeenCalledTimes(1);
  });

  it('a registered C++ sequence keeps the JS tween paused until the C++ side reports Completed', () => {
    let cpp = TweenState.Running;
    const m = makeManager(() => cpp);
    const cb = vi.fn();
    const j = m.create(0, 10, 1, cb);
    m.registerCppSequence(1 as never, j);
    expect(m.getState(j)).toBe(TweenState.Paused);
    m.update(1);                       // C++ still running → JS stays paused
    expect(m.getState(j)).toBe(TweenState.Paused);
    expect(cb).not.toHaveBeenCalled();
    cpp = TweenState.Completed;
    m.update(1);                       // C++ done → JS resumes and runs this frame
    expect(cb).toHaveBeenCalled();
  });
});

describe('ValueTweenHandle', () => {
  it('routes state and lifecycle calls back to its manager', () => {
    const m = makeManager();
    const id = m.create(0, 10, 1, () => {});
    const h = new ValueTweenHandle(m, id);
    expect(h.id).toBe(id);
    expect(h.manager).toBe(m);
    expect(h.state).toBe(TweenState.Running);
    h.pause();
    expect(m.getState(id)).toBe(TweenState.Paused);
    h.resume();
    expect(m.getState(id)).toBe(TweenState.Running);
    h.cancel();
    expect(h.state).toBe(TweenState.Cancelled);
  });

  it('then(handle) chains via setSequenceNext; then(external) chains via the external hook', () => {
    const m = makeManager();
    const a = new ValueTweenHandle(m, m.create(0, 1, 1, () => {}));
    const b = new ValueTweenHandle(m, m.create(0, 1, 1, () => {}));
    expect(a.then(b)).toBe(a);            // fluent
    expect(m.getState(b.id)).toBe(TweenState.Paused); // follow-up paused

    const c = new ValueTweenHandle(m, m.create(0, 1, 1, () => {}));
    const ext = { pause: vi.fn(), resume: vi.fn() };
    c.then(ext);
    expect(ext.pause).toHaveBeenCalledTimes(1);
  });
});
