// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Addressing a field of an open asset document from outside.
 *
 *        The eight asset editors share AssetDocument, whose `edit(label, mutate)`
 *        is already the one undoable write door — but a closure does not cross a
 *        tool call, so the address is a dotted path instead. These pin the part
 *        that has to be strict: a path that does not already exist is refused
 *        rather than created, because these are typed documents whose editors
 *        rely on their shape.
 */
import { describe, it, expect } from 'vitest';
import { setByPath } from '@/document/assetDocumentOps';

const clip = () => ({
  fps: 12,
  loop: true,
  frames: [
    { duration: 1, sprite: 'a.png' },
    { duration: 2, sprite: 'b.png' },
  ],
  meta: { author: null as string | null },
});

describe('addressing an asset document by path', () => {
  it('writes a top-level field', () => {
    const doc = clip();
    setByPath(doc, 'fps', 24);
    expect(doc.fps).toBe(24);
  });

  it('indexes into an array on the way down', () => {
    const doc = clip();
    setByPath(doc, 'frames.1.duration', 5);
    expect(doc.frames[1].duration).toBe(5);
    expect(doc.frames[0].duration).toBe(1);
  });

  it('replaces a whole array element', () => {
    const doc = clip();
    setByPath(doc, 'frames.0', { duration: 9, sprite: 'z.png' });
    expect(doc.frames[0]).toEqual({ duration: 9, sprite: 'z.png' });
  });

  it('writes a field whose current value is null', () => {
    const doc = clip();
    setByPath(doc, 'meta.author', 'me');
    expect(doc.meta.author).toBe('me');
  });

  // The strict half. Autovivifying `frames.7` on a clip with two frames produces
  // a file that loads as something else — refusing is the only honest answer.
  it('refuses a field the document does not have', () => {
    expect(() => setByPath(clip(), 'speed', 2)).toThrow(/no such field/);
    // and says what IS there, so the caller can correct itself
    expect(() => setByPath(clip(), 'speed', 2)).toThrow(/fps/);
  });

  it('refuses an index past the end of an array', () => {
    expect(() => setByPath(clip(), 'frames.7.duration', 1)).toThrow(/no frames\.7/);
    expect(() => setByPath(clip(), 'frames.2', {})).toThrow(/outside an array of 2/);
  });

  it('refuses to walk through a leaf', () => {
    expect(() => setByPath(clip(), 'fps.value', 1)).toThrow(/not an object/);
  });

  it('refuses an empty path', () => {
    expect(() => setByPath(clip(), '', 1)).toThrow(/empty path/);
    expect(() => setByPath(clip(), '..', 1)).toThrow(/empty path/);
  });
});
