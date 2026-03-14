import type { App, Plugin } from './app';
import type { World } from './world';
import type { Entity } from './types';
import type { Assets as AssetsClass } from './asset/Assets';
import { Assets } from './asset/AssetPlugin';
import { defineResource } from './resource';
import {
    instantiatePrefab,
    type PrefabData,
    type PrefabOverride,
    type InstantiatePrefabResult,
} from './prefab';

export class PrefabServer {
    private readonly world_: World;
    private readonly assets_: AssetsClass;

    constructor(world: World, assets: AssetsClass) {
        this.world_ = world;
        this.assets_ = assets;
    }

    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: PrefabOverride[];
    }): Promise<InstantiatePrefabResult> {
        const prefabResult = await this.assets_.loadPrefab(pathOrAddress);
        const prefab = prefabResult.data as PrefabData;
        return instantiatePrefab(this.world_, prefab, {
            assets: this.assets_,
            assetBaseUrl: options?.baseUrl,
            parent: options?.parent,
            overrides: options?.overrides,
        });
    }
}

export const Prefabs = defineResource<PrefabServer>(null!, 'Prefabs');

export class PrefabsPlugin implements Plugin {
    name = 'PrefabsPlugin';
    dependencies = [Assets];

    build(app: App): void {
        const assets = app.getResource(Assets);
        app.insertResource(Prefabs, new PrefabServer(app.world, assets));
    }
}

export const prefabsPlugin = new PrefabsPlugin();
