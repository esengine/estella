// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { uiHitTestWorld, uiPickWorld, uiPickAllWorld, type PickableWorld } from '../src/ui/util/ui-pick';

const REGISTRY = { registry: true };

/** A world whose engine core is the given stub — the pair the helpers resolve. */
const world = (engine: unknown, registry: unknown = REGISTRY) =>
  ({ getWasmModule: () => engine, getCppRegistry: () => registry }) as unknown as PickableWorld;

const hitTester = (hit: number) =>
  ({ uiHitTest_update: vi.fn(), uiHitTest_getHitEntity: () => hit }) as any;

describe('uiHitTestWorld', () => {
  it('returns the hit entity', () => {
    const engine = hitTester(42);
    expect(uiHitTestWorld(world(engine), 10, 20)).toBe(42);
    expect(engine.uiHitTest_update).toHaveBeenCalledWith(REGISTRY, 10, 20, false, false, false);
  });

  it('maps the no-hit sentinel to null', () => {
    expect(uiHitTestWorld(world(hitTester(0xffffffff)), 0, 0)).toBeNull();
  });

  it('passes mouse flags through (the input path)', () => {
    const engine = hitTester(7);
    uiHitTestWorld(world(engine), 1, 2, true, true, false);
    expect(engine.uiHitTest_update).toHaveBeenCalledWith(REGISTRY, 1, 2, true, true, false);
  });

  it('answers null when the world has no engine core behind it', () => {
    expect(uiHitTestWorld(world(null), 1, 2)).toBeNull();
  });

  it('answers null when the engine is there but no registry is bound', () => {
    expect(uiHitTestWorld(world(hitTester(42), null), 1, 2)).toBeNull();
  });
});

describe('uiPickWorld', () => {
  it('picks through the world it is given', () => {
    const engine = { uiHitTest_pick: vi.fn(() => 9) } as any;
    expect(uiPickWorld(world(engine), 3, 4)).toBe(9);
    expect(engine.uiHitTest_pick).toHaveBeenCalledWith(REGISTRY, 3, 4);
  });

  it('maps the no-hit sentinel to null', () => {
    expect(uiPickWorld(world({ uiHitTest_pick: () => 0xffffffff } as any), 0, 0)).toBeNull();
  });

  it('answers null on a core that does not carry the entry point', () => {
    expect(uiPickWorld(world({} as any), 0, 0)).toBeNull();
  });
});

describe('uiPickAllWorld', () => {
  it('collects the results, dropping the sentinel', () => {
    const results = [5, 0xffffffff, 6];
    const engine = {
      uiHitTest_pickAll: vi.fn(() => results.length),
      uiHitTest_pickResult: (i: number) => results[i],
    } as any;
    expect(uiPickAllWorld(world(engine), 1, 1)).toEqual([5, 6]);
    expect(engine.uiHitTest_pickAll).toHaveBeenCalledWith(REGISTRY, 1, 1);
  });

  it('answers empty on a core that does not carry the entry points', () => {
    expect(uiPickAllWorld(world({} as any), 0, 0)).toEqual([]);
  });
});
