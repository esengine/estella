/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */

import type { App, Plugin } from '../app';
import { Assets, assetPlugin } from '../asset';
import type { SceneData } from '../scene';
import { LocalTransform, Camera, Canvas, type LocalTransformData, type CameraData, type CanvasData } from '../component';
import { platformFetch } from '../platform';

// =============================================================================
// PreviewPlugin
// =============================================================================

export class PreviewPlugin implements Plugin {
    private sceneUrl_: string;
    private app_: App | null = null;
    private loadPromise_: Promise<void> | null = null;

    constructor(sceneUrl: string) {
        this.sceneUrl_ = sceneUrl;
    }

    build(app: App): void {
        this.app_ = app;

        if (!app.hasResource(Assets)) {
            app.addPlugin(assetPlugin);
        }

        this.loadPromise_ = this.loadScene();
    }

    /**
     * @brief Wait for scene loading to complete
     */
    async waitForReady(): Promise<void> {
        if (this.loadPromise_) {
            await this.loadPromise_;
        }
    }

    private async loadScene(): Promise<void> {
        if (!this.app_) return;

        try {
            const response = await platformFetch(this.sceneUrl_);
            if (!response.ok) {
                throw new Error(`Failed to fetch scene: ${response.status}`);
            }
            const sceneData = await response.json<SceneData>();

            const assets = this.app_.getResource(Assets);
            await assets.loadScene(this.app_.world, sceneData);

            this.ensureCamera();
        } catch (err) {
            console.error('[PreviewPlugin] Failed to load scene:', err);
        }
    }

    private ensureCamera(): void {
        if (!this.app_) return;

        const world = this.app_.world;
        let hasActiveCamera = false;

        const cameraEntities = world.getEntitiesWithComponents([Camera]);
        for (const entity of cameraEntities) {
            const camera = world.get(entity, Camera) as CameraData;
            if (camera.isActive) {
                hasActiveCamera = true;
                break;
            }
        }

        if (!hasActiveCamera) {
            console.warn('[PreviewPlugin] No active camera found, creating default camera');

            let orthoSize = 540;
            let aspectRatio = 1920 / 1080;

            const canvasEntities = world.getEntitiesWithComponents([Canvas]);
            for (const entity of canvasEntities) {
                const canvas = world.get(entity, Canvas) as CanvasData;
                if (canvas.designResolution) {
                    const ppu = canvas.pixelsPerUnit || 100;
                    orthoSize = (canvas.designResolution.y / 2) / ppu;
                    aspectRatio = canvas.designResolution.x / canvas.designResolution.y;
                    break;
                }
            }

            const cameraEntity = world.spawn();

            const transformData: LocalTransformData = {
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            };
            world.insert(cameraEntity, LocalTransform, transformData);

            const cameraData: CameraData = {
                isActive: true,
                projectionType: 0,
                fov: 60,
                orthoSize,
                nearPlane: 0.1,
                farPlane: 1000,
                aspectRatio,
                priority: 0,
                showFrustum: true,
            };
            world.insert(cameraEntity, Camera, cameraData);
        }
    }
}
