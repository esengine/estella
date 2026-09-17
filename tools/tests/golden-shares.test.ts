// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  golden-shares.test.ts
 * @brief CI launches the golden corpus one shard per runner. A project the split
 *        drops is a project nothing launches, and every shard still passes.
 */
import { describe, it, expect } from 'vitest';
import { atTier, sharesOf } from '../goldenProjects.mjs';

const OWNED = new Set(['web', 'playable', 'wechat']);

describe('golden shards', () => {
  it.each(['pr', 'nightly', 'release'])('put every %s project in exactly one shard', (tier) => {
    const all = atTier(tier).map((g) => g.id).sort();
    for (let n = 1; n <= 6; n++) {
      const shares = sharesOf(atTier(tier), n, OWNED);
      expect(shares).toHaveLength(n);
      expect(shares.flat().map((g) => g.id).sort()).toEqual(all);
    }
  });

  it('keeps a shard index naming the same projects from run to run', () => {
    const ids = () => sharesOf(atTier('pr'), 4, OWNED).map((s) => s.map((g) => g.id));
    expect(ids()).toEqual(ids());
  });
});
