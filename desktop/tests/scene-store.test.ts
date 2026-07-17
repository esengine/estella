// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { SceneStoreImpl } from '@/engine/SceneStore';

// A stand-in for the SceneModel change bus: captures the store's listener and
// lets a test fire model events (only `.kind` is read, via isStructural).
function fakeModel() {
  let listener: ((ev: { kind: string }) => void) | null = null;
  return {
    subscribe: (fn: (ev: { kind: string }) => void) => { listener = fn; return () => {}; },
    emit: (kind: string) => listener?.({ kind }),
  };
}

describe('SceneStore reactivity coalescing', () => {
  it('bumps the revision once per model change when live', () => {
    const m = fakeModel();
    const s = new SceneStoreImpl(m as never);
    s.install();
    const r0 = s.getRevision();
    m.emit('componentChanged');
    m.emit('componentChanged');
    expect(s.getRevision()).toBe(r0 + 2);
  });

  it('suspend coalesces a burst of changes into a single bump on resume', () => {
    const m = fakeModel();
    const s = new SceneStoreImpl(m as never);
    s.install();
    const r0 = s.getRevision();
    s.suspend();
    for (let i = 0; i < 20; i++) m.emit('componentChanged');
    expect(s.getRevision()).toBe(r0); // frozen for the whole gesture
    s.resume();
    expect(s.getRevision()).toBe(r0 + 1); // exactly one flush
  });

  it('preserves structural-ness across a coalesced gesture', () => {
    const m = fakeModel();
    const s = new SceneStoreImpl(m as never);
    s.install();
    const sr0 = s.getStructureRevision();
    s.suspend();
    m.emit('componentChanged'); // non-structural field edit
    m.emit('entityAdded');      // structural
    s.resume();
    expect(s.getStructureRevision()).toBe(sr0 + 1); // structural survives the merge
  });

  it('resume with nothing pending does not bump, and is safe when not suspended', () => {
    const m = fakeModel();
    const s = new SceneStoreImpl(m as never);
    s.install();
    const r0 = s.getRevision();
    s.resume(); // not suspended → no-op
    expect(s.getRevision()).toBe(r0);
    s.suspend();
    s.resume(); // suspended but nothing changed → no bump
    expect(s.getRevision()).toBe(r0);
  });
});
