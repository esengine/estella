// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The pure, world-free helpers in ui/util/helpers: word-boundary
 *        classification, power-of-two rounding, and the entity/state map
 *        cleanup.
 */
import { describe, it, expect } from 'vitest';
import {
  isWordChar,
  nextPowerOf2,
  EntityStateMap,
} from '../src/ui/util/helpers';
import type { Entity } from '../src/types';

describe('isWordChar', () => {
  it('accepts letters, digits and underscore; rejects space and punctuation', () => {
    expect(isWordChar('A'.charCodeAt(0))).toBe(true);
    expect(isWordChar('z'.charCodeAt(0))).toBe(true);
    expect(isWordChar('7'.charCodeAt(0))).toBe(true);
    expect(isWordChar('_'.charCodeAt(0))).toBe(true);
    expect(isWordChar(' '.charCodeAt(0))).toBe(false);
    expect(isWordChar('-'.charCodeAt(0))).toBe(false);
    expect(isWordChar('.'.charCodeAt(0))).toBe(false);
  });
});

describe('nextPowerOf2', () => {
  it('rounds up to the next power of two (and is idempotent on exact powers)', () => {
    expect(nextPowerOf2(1)).toBe(1);
    expect(nextPowerOf2(3)).toBe(4);
    expect(nextPowerOf2(5)).toBe(8);
    expect(nextPowerOf2(16)).toBe(16);
    expect(nextPowerOf2(17)).toBe(32);
    expect(nextPowerOf2(0)).toBe(1); // p starts at 1, loop never runs
  });
});

describe('EntityStateMap', () => {
  it('stores and retrieves per-entity state', () => {
    const m = new EntityStateMap<string>();
    const e = 1 as Entity;
    expect(m.has(e)).toBe(false);
    m.set(e, 'hovered');
    expect(m.get(e)).toBe('hovered');
    expect(m.has(e)).toBe(true);
    m.delete(e);
    expect(m.get(e)).toBeUndefined();
  });

  it('cleanup() drops entries whose entity is no longer valid', () => {
    const m = new EntityStateMap<number>();
    m.set(1 as Entity, 10);
    m.set(2 as Entity, 20);
    m.set(3 as Entity, 30);
    const alive = new Set([1, 3]);
    const world = { valid: (e: Entity) => alive.has(e as unknown as number) };
    m.cleanup(world as never);
    expect(m.has(1 as Entity)).toBe(true);
    expect(m.has(2 as Entity)).toBe(false); // pruned
    expect(m.has(3 as Entity)).toBe(true);
  });
});
