import type { App, Plugin } from './app';
import type { World } from './world';
import type { Entity } from './types';
import type { AssetServer } from './asset/AssetServer';
import { Assets } from './asset';
import { defineResource } from './resource';
import {
    instantiatePrefab,
    type PrefabOverride,
    type InstantiatePrefabResult,
} from './prefab';

// =============================================================================
// PrefabServer
// =============================================================================

export class PrefabServer {
    private readonly world_: World;
    private readonly assetServer_: AssetServer;

    constructor(world: World, assetServer: AssetServer) {
        this.world_ = world;
        this.assetServer_ = assetServer;
    }

    async instantiate(pathOrAddress: string, options?: {
        baseUrl?: string;
        parent?: Entity;
        overrides?: PrefabOverride[];
    }): Promise<InstantiatePrefabResult> {
        const resolved = this.assetServer_.resolveAddress(pathOrAddress);
        const prefabPath = resolved ? resolved.path : pathOrAddress;
        const prefab = await this.assetServer_.loadPrefab(prefabPath, options?.baseUrl);
        return instantiatePrefab(this.world_, prefab, {
            assetServer: this.assetServer_,
            assetBaseUrl: options?.baseUrl,
            parent: options?.parent,
            overrides: options?.overrides,
        });
    }
}

// =============================================================================
// Prefabs Resource
// =============================================================================

export const Prefabs = defineResource<PrefabServer>(null!, 'Prefabs');

// =============================================================================
// PrefabsPlugin
// =============================================================================

export class PrefabsPlugin implements Plugin {
    build(app: App): void {
        const assetServer = app.getResource(Assets);
        if (!assetServer) {
            console.warn('PrefabsPlugin: Assets resource not available');
            return;
        }

        app.insertResource(Prefabs, new PrefabServer(app.world, assetServer));
    }
}

export const prefabsPlugin = new PrefabsPlugin();
