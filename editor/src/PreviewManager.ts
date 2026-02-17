import type { SceneData } from './types/SceneTypes';
import { PreviewService } from './preview';
import { getSettingsValue } from './settings';
import type { ScriptLoader } from './scripting';

export class PreviewManager {
    private previewService_: PreviewService | null = null;

    constructor(projectPath: string | null) {
        if (projectPath) {
            this.previewService_ = new PreviewService({ projectPath });
        }
    }

    async startPreview(
        scene: SceneData,
        scriptLoader: ScriptLoader | null,
        spineVersion: string,
    ): Promise<void> {
        if (!this.previewService_) {
            console.warn('Preview not available: no project loaded');
            return;
        }

        try {
            if (scriptLoader) {
                await scriptLoader.compile();
            }
            const compiledScript = scriptLoader?.getCompiledCode() ?? undefined;
            const { enablePhysics, physicsConfig, previewSpineVersion, runtimeConfig } = this.collectPreviewConfig(spineVersion);
            await this.previewService_.startPreview(scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig, runtimeConfig);
        } catch (err) {
            console.error('Failed to start preview:', err);
        }
    }

    async startServer(
        scene: SceneData,
        scriptLoader: ScriptLoader | null,
        spineVersion: string,
    ): Promise<number | null> {
        if (!this.previewService_) {
            console.warn('Preview not available: no project loaded');
            return null;
        }

        try {
            if (scriptLoader) {
                await scriptLoader.compile();
            }
            const compiledScript = scriptLoader?.getCompiledCode() ?? undefined;
            const { enablePhysics, physicsConfig, previewSpineVersion, runtimeConfig } = this.collectPreviewConfig(spineVersion);
            return await this.previewService_.startServer(scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig, runtimeConfig);
        } catch (err) {
            console.error('Failed to start preview server:', err);
            return null;
        }
    }

    async stopPreview(): Promise<void> {
        await this.previewService_?.stopPreview();
    }

    refreshFiles(
        scene: SceneData,
        scriptLoader: ScriptLoader | null,
        spineVersion: string,
    ): void {
        if (!this.previewService_) return;
        const compiledScript = scriptLoader?.getCompiledCode() ?? undefined;
        const { enablePhysics, physicsConfig, previewSpineVersion, runtimeConfig } = this.collectPreviewConfig(spineVersion);
        this.previewService_.updatePreviewFiles(scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig, runtimeConfig);
    }

    private collectPreviewConfig(spineVersion: string) {
        const enablePhysics = getSettingsValue<boolean>('project.enablePhysics') ?? false;
        const physicsConfig = enablePhysics ? {
            gravityX: getSettingsValue<number>('physics.gravityX') ?? 0,
            gravityY: getSettingsValue<number>('physics.gravityY') ?? -9.81,
            fixedTimestep: getSettingsValue<number>('physics.fixedTimestep') ?? 1 / 60,
            subStepCount: getSettingsValue<number>('physics.subStepCount') ?? 4,
        } : undefined;
        const previewSpineVersion = spineVersion === 'none' ? undefined : spineVersion;
        const runtimeConfig = {
            sceneTransitionDuration: getSettingsValue<number>('runtime.sceneTransitionDuration') ?? 0.3,
            sceneTransitionColor: getSettingsValue<string>('runtime.sceneTransitionColor') ?? '#000000',
            defaultFontFamily: getSettingsValue<string>('runtime.defaultFontFamily') ?? 'Arial',
            canvasScaleMode: getSettingsValue<string>('runtime.canvasScaleMode') ?? 'FixedHeight',
            canvasMatchWidthOrHeight: getSettingsValue<number>('runtime.canvasMatchWidthOrHeight') ?? 0.5,
            maxDeltaTime: getSettingsValue<number>('runtime.maxDeltaTime') ?? 0.25,
            maxFixedSteps: getSettingsValue<number>('runtime.maxFixedSteps') ?? 8,
            textCanvasSize: parseInt(getSettingsValue<string>('runtime.textCanvasSize') ?? '512', 10),
        };
        return { enablePhysics, physicsConfig, previewSpineVersion, runtimeConfig };
    }

    dispose(): void {
        this.previewService_ = null;
    }
}
