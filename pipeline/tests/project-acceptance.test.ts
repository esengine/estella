// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The claims a PROJECT makes about itself, in its manifest.
 *
 * The reader is a whitelist, so a field with no branch persists and does
 * nothing — which for this one would mean a project whose standing checks were
 * silently never run, while the file said they were there.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';

const project = (acceptance: unknown) =>
  parseManifest({ formatVersion: '1', name: 'Platformer', acceptance });

describe('standing acceptance in the manifest', () => {
  it('survives the read — it is not a field that persists and does nothing', () => {
    const m = project([{ says: 'the player can always reach the exit', probe: 'reachable()' }]);
    expect(m.acceptance).toEqual([
      { says: 'the player can always reach the exit', probe: 'reachable()' },
    ]);
  });

  it('keeps one only a person can settle, with the reason', () => {
    const m = project([{ says: 'the HUD reads at 1080p', manual: 'a judgement about legibility' }]);
    expect(m.acceptance).toEqual([
      { says: 'the HUD reads at 1080p', manual: 'a judgement about legibility' },
    ]);
  });

  // A hand-edited claim that settles nothing must not become a claim that
  // silently holds. Dropped here rather than failing the load: a bad line must
  // not cost anyone their project (the same rule screenPresets follows).
  it('drops a claim that names nothing to settle it', () => {
    expect(project([{ says: 'it feels good' }]).acceptance).toBeUndefined();
  });

  it('drops a claim that says nothing', () => {
    expect(project([{ probe: 'true' }]).acceptance).toBeUndefined();
    expect(project([{ says: '   ', probe: 'true' }]).acceptance).toBeUndefined();
  });

  it('keeps the good ones when one is bad', () => {
    const m = project([
      { says: 'good', probe: 'ok' },
      { says: 'bad' },
      { says: 'also good', manual: 'a look' },
    ]);
    expect(m.acceptance?.map((c) => c.says)).toEqual(['good', 'also good']);
  });

  // One criterion, one thing that settles it — the probe wins, because it is
  // the half a machine can act on.
  it('keeps one settler for a claim that gave two', () => {
    const m = project([{ says: 'x', probe: 'ok', manual: 'also a look' }]);
    expect(m.acceptance).toEqual([{ says: 'x', probe: 'ok' }]);
  });

  it('leaves a project with none alone', () => {
    expect(project(undefined).acceptance).toBeUndefined();
    expect(project([]).acceptance).toBeUndefined();
    expect(project('nonsense').acceptance).toBeUndefined();
  });
});
