// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { sameAcquisition } from '../src/asset/leaseBindings';

it('preserves acquisition order as indexed scopes add, transfer and give back receipts', () => {
    const owner = new AssetScope(), donor = new AssetScope();
    const dispose = vi.fn();
    const first = owner.add(ownedAssetLease('first', 1, 7, dispose, 'mesh'));
    const second = donor.add(ownedAssetLease('second', 2, 7, dispose, 'mesh'));
    const texture = donor.add(ownedAssetLease('first', 1, 7, dispose, 'texture'));
    expect(sameAcquisition(first, texture)).toBe(false);
    const retained = first.retain()!;
    expect(sameAcquisition(first, retained)).toBe(true);
    retained.release();
    owner.add(ownedAssetLease('other', 1, 4, dispose, 'font'));
    for (let i = 0; i < 2; i++) {
        expect(owner.bindingLease('mesh', 7)).toBe(first);
        expect(donor.bindingLease('texture', 7)).toBe(texture);
    }
    owner.absorb(donor);
    expect(donor.bindingLease('mesh', 7)).toBeUndefined();
    expect(owner.bindingLease('mesh', 7)).toBe(first);
    expect(owner.bindingLease('texture', 7)).toBe(texture);
    expect(owner.forget(first)).toBe(true);
    first.release();
    expect(owner.bindingLease('mesh', 7)).toBe(second);
    const added = owner.add(ownedAssetLease('new', 1, 8, dispose, 'mesh'));
    expect(owner.bindingLease('mesh', 8)).toBe(added);
    owner.releaseAll();
    expect(owner.bindingLease('mesh', 7)).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(5);
});

it('reads legacy project receipts live and keeps receipts acquired during disposal', () => {
    const scope = new AssetScope();
    const names = ['first'];
    const legacy = { ...ownedAssetLease('declared', 1, { handle: 23 }, () => {}), names };
    const incoming = ownedAssetLease('next', 2, 2, () => {}, 'mesh');
    scope.add(legacy);
    scope.add(ownedAssetLease('initial', 1, 2, () => { scope.add(incoming); }, 'mesh'));
    expect(scope.bindingLease('texture', 23)).toBe(legacy);
    expect(scope.bindingLease('avatar', 'first')).toBe(legacy);
    names[0] = 'second';
    expect(scope.bindingLease('avatar', 'first')).toBeUndefined();
    expect(scope.bindingLease('avatar', 'second')).toBe(legacy);
    scope.releaseAll();
    expect(scope.bindingLease('avatar', 'second')).toBeUndefined();
    expect(scope.bindingLease('mesh', 2)).toBe(incoming);
    scope.releaseAll();
});

it('preserves handle-before-name lookup for legacy receipts before and after indexing', () => {
    const scope = new AssetScope();
    const named = { ...ownedAssetLease('named', 1, {}, () => {}), names: ['atlas'] };
    const handle = ownedAssetLease('held', 1, { handle: 'atlas' }, () => {});
    scope.add(named);
    scope.add(handle);
    expect(scope.bindingLease('texture', 'atlas')).toBe(handle);
    expect(scope.bindingLease('texture', 'atlas')).toBe(handle);
    scope.releaseAll();
});
