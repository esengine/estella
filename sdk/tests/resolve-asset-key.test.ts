// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The one primitive shared by every path-keyed runtime store (FSM, BT, tilemap,
 * timeline) to map an authored component ref to its resolved store key.
 */
import { describe, it, expect } from 'vitest';
import { resolveAssetKey } from '../src/asset/resolveAssetKey';
import type { AssetsData } from '../src/asset/AssetPlugin';

const assets = (fn: (ref: string) => string | null) =>
    ({ resolveRef: fn } as unknown as AssetsData);

describe('resolveAssetKey', () => {
    it('returns the resolver output when it resolves', () => {
        expect(resolveAssetKey(assets((r) => `estella://project/${r}`), 'a/b.esfsm'))
            .toBe('estella://project/a/b.esfsm');
    });

    it('falls back to the raw ref when the resolver returns null (code-registered name)', () => {
        expect(resolveAssetKey(assets(() => null), 'myCodeFsm')).toBe('myCodeFsm');
    });

    it('falls back to the raw ref when there is no Assets resource', () => {
        expect(resolveAssetKey(null, 'a/b.esbt')).toBe('a/b.esbt');
        expect(resolveAssetKey(undefined, 'a/b.esbt')).toBe('a/b.esbt');
    });
});
