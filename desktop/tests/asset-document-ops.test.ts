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
import { describe, it, expect, afterEach } from 'vitest';
import { setByPath, saveAssetDocument } from '@/document/assetDocumentOps';
import { AssetDocument } from '@/document/AssetDocument';
import { DirtyRegistry } from '@/document/DirtyRegistry';

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

/** A stand-in for the eight real editors: only the AssetDocument shape matters here. */
class TestDoc extends AssetDocument<{ n: number }> {
  open(asset: { n: number }, path: string | null): void {
    this.openAsset(asset, path);
  }
  close(): void {
    this.closeAsset();
  }
}

describe('saving an open asset document', () => {
  const doc = new TestDoc('testdoc');

  afterEach(() => {
    doc.close();
    DirtyRegistry.clearAll();
  });

  const register = (save: () => Promise<void>) =>
    DirtyRegistry.register({ id: 'testdoc', isDirty: () => doc.dirty, save });

  it("goes through the document's own registered save", async () => {
    // Not a JSON write of what get_asset_document returns: a tileset and a
    // timeline serialize, and a material graph compiles a sibling `.esshader`.
    doc.open({ n: 1 }, 'fx/thing.json');
    doc.replaceAsset({ n: 2 }); // dirty
    const calls: string[] = [];
    register(async () => {
      calls.push('save');
      doc.markSaved();
    });

    await expect(saveAssetDocument()).resolves.toEqual({
      docId: 'testdoc', path: 'fx/thing.json', saved: true,
    });
    expect(calls).toEqual(['save']);
    expect(doc.dirty).toBe(false);
  });

  it('reports a clean document as "nothing to write", not as a failure', async () => {
    doc.open({ n: 1 }, 'fx/thing.json');
    register(async () => {
      throw new Error('a clean document must not be saved');
    });
    await expect(saveAssetDocument()).resolves.toMatchObject({ saved: false });
  });

  it('refuses a document whose save nothing registered', async () => {
    // Otherwise this is indistinguishable from "it was clean" — the caller is
    // told the file matches the document when nothing ever wrote it.
    doc.open({ n: 1 }, 'fx/thing.json');
    doc.replaceAsset({ n: 2 });
    await expect(saveAssetDocument()).rejects.toThrow(/registered no save/);
  });

  it('refuses an untitled document instead of raising a Save As nobody can answer', async () => {
    doc.open({ n: 1 }, null);
    doc.replaceAsset({ n: 2 });
    register(async () => {});
    await expect(saveAssetDocument()).rejects.toThrow(/no file path/);
  });

  it('names the document that is not open, when none is', async () => {
    await expect(saveAssetDocument()).rejects.toThrow(/no asset document is open/);
  });
});
