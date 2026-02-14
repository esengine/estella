/**
 * @file    PreviewPlugin.ts
 * @brief   Plugin for editor preview functionality
 */

import type { App, Plugin } from '../app';
import type { SceneData } from '../scene';
import { loadRuntimeScene } from '../runtimeLoader';
import { LocalTransform, Camera, Canvas, type LocalTransformData, type CameraData, type CanvasData } from '../component';
import { platformFetch } from '../platform';
import { WebAssetProvider } from './WebAssetProvider';

// =============================================================================
// PreviewPlugin
// =============================================================================

export class PreviewPlugin implements Plugin {
    private sceneUrl_: string;
    private baseUrl_: string;
    private app_: App | null = null;
    private loadPromise_: Promise<void> | null = null;

    constructor(sceneUrl: string, baseUrl?: string) {
        this.sceneUrl_ = sceneUrl;
        this.baseUrl_ = baseUrl ?? '';
    }

    build(app: App): void {
        this.app_ = app;

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

        let step = 'fetch scene';
        try {
            const response = await platformFetch(this.sceneUrl_);
            if (!response.ok) {
                throw new Error(`Failed to fetch scene: ${response.status}`);
            }
            step = 'parse scene JSON';
            const sceneData = await response.json<SceneData>();

            step = 'prefetch assets';
            const provider = new WebAssetProvider(this.baseUrl_);
            await provider.prefetch(sceneData);

            let spineModule = null;
            const spinePromise = (this.app_ as any).__spineInitPromise;
            if (spinePromise) {
                step = 'init spine';
                const result = await spinePromise;
                spineModule = result.controller.raw;
            }

            step = 'loadRuntimeScene';
            await loadRuntimeScene(this.app_, this.app_.wasmModule!, sceneData, provider, spineModule);

            step = 'ensureCamera';
            this.ensureCamera();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : '';
            console.error(`[PreviewPlugin] Failed at step "${step}": ${msg}\n${stack}`);
            throw new Error(`[PreviewPlugin:${step}] ${msg}`);
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
                projectionType: 1,
                fov: 60,
                orthoSize,
                nearPlane: 0.1,
                farPlane: 1000,
                aspectRatio,
                priority: 0,
                showFrustum: true,
                viewportX: 0,
                viewportY: 0,
                viewportW: 1,
                viewportH: 1,
                clearFlags: 3,
            };
            world.insert(cameraEntity, Camera, cameraData);
        }
    }
}
