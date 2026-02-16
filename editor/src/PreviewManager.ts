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
            const { enablePhysics, physicsConfig, previewSpineVersion } = this.collectPreviewConfig(spineVersion);
            await this.previewService_.startPreview(scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig);
        } catch (err) {
            console.error('Failed to start preview:', err);
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
        const { enablePhysics, physicsConfig, previewSpineVersion } = this.collectPreviewConfig(spineVersion);
        this.previewService_.updatePreviewFiles(scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig);
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
        return { enablePhysics, physicsConfig, previewSpineVersion };
    }

    dispose(): void {
        this.previewService_ = null;
    }
}
