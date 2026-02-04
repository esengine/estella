/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */

import type { App, Plugin } from '../app';
import { Schedule, defineSystem } from '../system';
import { Assets, assetPlugin } from '../asset';
import { loadSceneWithAssets, type SceneData } from '../scene';

// =============================================================================
// PreviewPlugin
// =============================================================================

export class PreviewPlugin implements Plugin {
    private sceneUrl_: string;
    private sceneLoaded_ = false;

    constructor(sceneUrl: string) {
        this.sceneUrl_ = sceneUrl;
    }

    build(app: App): void {
        if (!app.hasResource(Assets)) {
            app.addPlugin(assetPlugin);
        }

        const plugin = this;
        app.addSystemToSchedule(Schedule.Startup, defineSystem(
            [],
            async function previewSceneLoader() {
                if (plugin.sceneLoaded_) return;
                plugin.sceneLoaded_ = true;

                try {
                    const response = await fetch(plugin.sceneUrl_);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch scene: ${response.status}`);
                    }
                    const sceneData = await response.json() as SceneData;

                    const assets = app.getResource(Assets);
                    await loadSceneWithAssets(app.world, sceneData, {
                        assetServer: assets.server
                    });

                    console.log(`[PreviewPlugin] Loaded scene: ${sceneData.name}`);
                } catch (err) {
                    console.error('[PreviewPlugin] Failed to load scene:', err);
                }
            }
        ));
    }
}
