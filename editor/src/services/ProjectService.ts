import { showBuildSettingsDialog, BuildService } from '../builder';
import { getBuildConfigService } from '../builder/BuildConfigService';
import { showSettingsDialog, ProjectSettingsSync } from '../settings';
import { getEditorContext } from '../context/EditorContext';
import { getAssetLibrary } from '../asset/AssetLibrary';
import { getGlobalPathResolver } from '../asset';
import type { SpineService } from './SpineService';

export class ProjectService {
    private projectPath_: string | null;
    private settingsSync_: ProjectSettingsSync | null = null;
    private spineService_: SpineService;

    constructor(projectPath: string | null, spineService: SpineService) {
        this.projectPath_ = projectPath;
        this.spineService_ = spineService;
    }

    get projectPath(): string | null {
        return this.projectPath_;
    }

    async initializeAssetLibrary(): Promise<void> {
        console.log(`[Editor] initializeAssetLibrary: projectPath=${this.projectPath_}`);
        if (!this.projectPath_) {
            console.warn('[Editor] initializeAssetLibrary: no projectPath');
            return;
        }

        const fs = getEditorContext().fs;
        if (!fs) {
            console.warn('[Editor] initializeAssetLibrary: no fs in context');
            return;
        }

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');
        try {
            await getAssetLibrary().initialize(projectDir, fs);
        } catch (err) {
            console.error('Failed to initialize AssetLibrary:', err);
        }
    }

    async initProjectSettingsSync(): Promise<void> {
        if (!this.projectPath_) return;
        this.settingsSync_ = new ProjectSettingsSync(
            this.projectPath_,
            (version) => this.spineService_.notifyVersionChange(version),
        );
        await this.settingsSync_.loadFromProject();
        this.settingsSync_.startAutoSync();
    }

    initializeProjectDir(): void {
        if (this.projectPath_) {
            const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');
            getGlobalPathResolver().setProjectDir(projectDir);
        }
    }

    showBuildSettings(): void {
        if (!this.projectPath_) {
            alert('请先打开一个项目');
            return;
        }

        const buildService = new BuildService(this.projectPath_);
        showBuildSettingsDialog({
            projectPath: this.projectPath_,
            onBuild: async (config, options) => {
                return await buildService.build(config, options);
            },
            onClose: () => {},
        });
    }

    async quickBuild(notify?: (msg: string, durationMs?: number) => void): Promise<void> {
        const show = notify ?? ((msg: string) => console.log(`[Build] ${msg}`));

        if (!this.projectPath_) {
            show('No project open');
            return;
        }

        const configService = getBuildConfigService();
        const config = configService.getActiveConfig();
        if (!config) {
            show('No build config — opening Build Settings');
            this.showBuildSettings();
            return;
        }

        show(`Building "${config.name}"...`);
        const buildService = new BuildService(this.projectPath_);
        try {
            const result = await buildService.build(config);
            if (result.success) {
                show(`Build "${config.name}" succeeded`, 3000);
            } else {
                show(`Build "${config.name}" failed: ${result.error ?? 'unknown error'}`, 5000);
            }
        } catch (e) {
            show(`Build error: ${e}`, 5000);
        }
    }

    showSettings(): void {
        showSettingsDialog();
    }
}
