// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The pure, world-free helpers in ui/util/helpers: word-aware text
 *        wrapping, power-of-two rounding, colour math, and the entity/state map
 *        cleanup. wrapText in particular carries real branching (word boundary
 *        vs. hard break vs. paragraph split) that nothing exercised directly.
 */
import { describe, it, expect } from 'vitest';
import {
  isWordChar,
  wrapText,
  nextPowerOf2,
  colorScale,
  colorWithAlpha,
  colorToRgba,
  EntityStateMap,
} from '../src/ui/util/helpers';
import type { Color, Entity } from '../src/types';

// A deterministic text metric: every glyph is 10 units wide, so a maxWidth of N
// means "at most N/10 characters per line" — no real font or canvas required.
const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D;

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

describe('wrapText', () => {
  it('returns a single empty line for empty input', () => {
    expect(wrapText(ctx, '', 100)).toEqual(['']);
  });

  it('does not wrap when everything fits', () => {
    expect(wrapText(ctx, 'abc', 100)).toEqual(['abc']); // 30 < 100
  });

  it('splits on hard newlines, preserving blank paragraphs', () => {
    expect(wrapText(ctx, 'ab\ncd', 100)).toEqual(['ab', 'cd']);
    expect(wrapText(ctx, 'ab\n\ncd', 100)).toEqual(['ab', '', 'cd']);
  });

  it('treats maxWidth <= 0 as "newlines only", never measuring', () => {
    expect(wrapText(ctx, 'abcdef', 0)).toEqual(['abcdef']);
    expect(wrapText(ctx, 'ab\ncd', -5)).toEqual(['ab', 'cd']);
  });

  it('hard-breaks a single word with no break opportunity', () => {
    // 8 glyphs, 3 per line → 3/3/2.
    expect(wrapText(ctx, 'aaaaaaaa', 30)).toEqual(['aaa', 'aaa', 'aa']);
  });

  it('breaks at a word boundary and keeps every character', () => {
    const lines = wrapText(ctx, 'alpha beta', 50); // 5 glyphs/line
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('').replace(/\s/g, '')).toBe('alphabeta'); // no glyph lost
    expect(lines[0]).toBe('alpha'); // the first word survives intact on line 1
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

describe('colour helpers', () => {
  const c: Color = { r: 0.4, g: 0.5, b: 0.6, a: 0.8 };

  it('colorScale multiplies rgb, clamps to 1, and preserves alpha', () => {
    expect(colorScale(c, 0.5)).toEqual({ r: 0.2, g: 0.25, b: 0.3, a: 0.8 });
    const bright = colorScale({ r: 0.8, g: 0.9, b: 1, a: 0.5 }, 2);
    expect(bright).toEqual({ r: 1, g: 1, b: 1, a: 0.5 }); // clamped, alpha untouched
  });

  it('colorWithAlpha replaces only alpha', () => {
    expect(colorWithAlpha(c, 0.1)).toEqual({ r: 0.4, g: 0.5, b: 0.6, a: 0.1 });
  });

  it('colorToRgba rounds rgb to 0..255 and passes alpha through raw', () => {
    expect(colorToRgba({ r: 1, g: 0, b: 0.5, a: 0.25 })).toBe('rgba(255, 0, 128, 0.25)');
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
