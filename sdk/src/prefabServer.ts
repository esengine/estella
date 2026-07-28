// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from './app';
import type { World } from './ecs/world';
import type { Entity } from './types';
import type { Assets as AssetsClass } from './asset/Assets';
import { Assets } from './asset/AssetPlugin';
import { defineResource } from './ecs/resource';
import {
    instantiatePrefab,
    type PrefabData,
    type PrefabOverride,
    type InstantiatePrefabResult,
} from './prefab';

export class PrefabServer {
    private readonly world_: World;
    private readonly getAssets_: () => AssetsClass;

    // Resolved per call, not captured: the play/cooked runtime replaces the
    // Assets resource after plugin build (ensureRuntimeAssets), and a captured
    // instance would silently bypass its resolveRef/manifest channel.
    constructor(world: World, getAssets: () => AssetsClass) {
        this.world_ = world;
        this.getAssets_ = getAssets;
    }

    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: PrefabOverride[];
    }): Promise<InstantiatePrefabResult> {
        const assets = this.getAssets_();
        const prefabResult = await assets.loadPrefab(pathOrAddress);
        const prefab = prefabResult.data as PrefabData;
        return instantiatePrefab(this.world_, prefab, {
            assets,
            assetBaseUrl: options?.baseUrl,
            parent: options?.parent,
            overrides: options?.overrides,
        });
    }
}

export const Prefabs = defineResource<PrefabServer>(null!, 'Prefabs');

export class PrefabsPlugin implements Plugin {
    name = 'prefabs';
    dependencies = [Assets];

    build(app: App): void {
        app.insertResource(Prefabs, new PrefabServer(app.world, () => app.getResource(Assets)));
    }
}

export const prefabsPlugin = new PrefabsPlugin();
