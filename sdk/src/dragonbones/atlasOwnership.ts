// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLease, AssetScope } from '../asset/AssetLease';
import type { DragonBonesManager } from './DragonBonesManager';
import { disposeAll } from '../util/disposeAll';

type AtlasPage = { textureId: number };
const pending = new WeakMap<AtlasPage, { lease: AssetLease; scope?: AssetScope }>();
const bound = new WeakMap<object, Map<number, AssetLease>>();

export function ownAtlas(info: AtlasPage, lease: AssetLease, scope?: AssetScope): void {
    scope?.add(lease);
    pending.set(info, { lease, scope });
}

/** A prepared scene owns the page until its native skeleton accepts it. */
export function bindAtlasTexture(info: AtlasPage, manager: DragonBonesManager, handle: number): void {
    const owner = pending.get(info);
    if (owner?.scope && !owner.scope.forget(owner.lease)) {
        pending.delete(info);
        info.textureId = -1;
        return;
    }
    try {
        if (info.textureId >= 0) manager.setAtlasTexture(handle, info.textureId);
    } catch (error) {
        owner?.scope?.add(owner.lease);
        throw error;
    }
    if (!owner) return;
    pending.delete(info);
    let owners = bound.get(manager);
    if (!owners) bound.set(manager, owners = new Map());
    const previous = owners.get(handle);
    owners.set(handle, owner.lease);
    previous?.release();
}

export function releaseAtlasOwner(manager: object, handle: number): void {
    const owners = bound.get(manager), lease = owners?.get(handle);
    owners?.delete(handle);
    lease?.release();
}
export function releaseAllAtlasOwners(manager: object): void {
    const owners = bound.get(manager);
    bound.delete(manager);
    if (owners) disposeAll([...owners.values()], lease => lease.release());
}

export function releaseUnusedAtlases(infos: Iterable<AtlasPage>): void {
    disposeAll([...infos], info => {
        const owner = pending.get(info);
        if (!owner) return;
        pending.delete(info);
        info.textureId = -1;
        owner.scope?.forget(owner.lease);
        owner.lease.release();
    });
}
