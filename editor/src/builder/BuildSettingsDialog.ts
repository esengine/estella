import { icons } from '../utils/icons';
import {
    type BuildConfig,
    type BuildSettings,
    createDefaultBuildSettings,
} from '../types/BuildTypes';
import type { BuildResult, BuildOptions } from './BuildService';
import { BuildHistory } from './BuildHistory';
import { BuildConfigService, initBuildConfigService } from './BuildConfigService';
import { BatchBuilder } from './BatchBuilder';
import { renderSidebar, renderDetail, renderNoConfig, renderOutputPanel } from './BuildSettingsRenderer';
import { setupEvents, setupSceneDragAndDrop } from './BuildSettingsActions';
import { checkToolchainStatus, handleBrowseEmsdk, handleInstallEmsdk, handleRepairToolchain } from './BuildSettingsToolchain';

export interface BuildSettingsDialogOptions {
    projectPath: string;
    onBuild: (config: BuildConfig, options?: BuildOptions) => Promise<BuildResult>;
    onClose: () => void;
}

export type ToolchainStatus = {
    installed: boolean;
    emsdk_path: string | null;
    emscripten_version: string | null;
    emscripten_ok: boolean;
    cmake_found: boolean;
    cmake_version: string | null;
    cmake_ok: boolean;
    python_found: boolean;
    python_version: string | null;
    python_ok: boolean;
    corrupted: boolean;
    missing_tools: string[];
};

export interface BuildSettingsRenderContext {
    settings: BuildSettings;
    history: BuildHistory;
    expandedSections: Set<string>;
    lastBuildOutputFiles: Map<string, Array<{ path: string; size: number }>>;
    toolchainStatus: ToolchainStatus | null;
    toolchainError: boolean;
}

export interface BuildSettingsToolchainContext {
    overlay: HTMLElement | null;
    toolchainStatus: ToolchainStatus | null;
    toolchainError: boolean;
}

export interface BuildSettingsActionContext extends BuildSettingsRenderContext {
    overlay: HTMLElement;
    batchBuilder: BatchBuilder;
    keyHandler: ((e: KeyboardEvent) => void) | null;
    dragSourceIndex: number;
    render(): void;
    close(): void;
    saveSettings(): Promise<void>;
    getActiveConfig(): BuildConfig | null;
    getProjectDir(): string;
    onBuild: (config: BuildConfig, options?: BuildOptions) => Promise<BuildResult>;
    handleBrowseEmsdk(): void;
    handleInstallEmsdk(): void;
    handleRepairToolchain(): void;
}

export class BuildSettingsDialog {
    constructor(options: BuildSettingsDialogOptions) {
        this.options_ = options;
        this.settings_ = createDefaultBuildSettings();

        const projectDir = this.getProjectDir();
        this.configService_ = initBuildConfigService(projectDir);
        this.history_ = new BuildHistory(projectDir);
        this.batchBuilder_ = new BatchBuilder(projectDir, this.history_);

        this.initAsync();
    }

    private async initAsync(): Promise<void> {
        await Promise.all([
            this.configService_.load(),
            this.history_.load(),
        ]);

        this.settings_ = this.configService_.getSettings();

        if (!this.settings_.activeConfigId && this.settings_.configs.length > 0) {
            this.settings_.activeConfigId = this.settings_.configs[0].id;
        }

        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-dialog-overlay';
        document.body.appendChild(this.overlay_);

        this.render();
        setupEvents(this.createActionContext());
        checkToolchainStatus(this.createToolchainContext());
    }

    dispose(): void {
        this.saveSettings();
        if (this.keyHandler_) {
            document.removeEventListener('keydown', this.keyHandler_);
        }
        this.overlay_?.remove();
    }

    private async saveSettings(): Promise<void> {
        await this.configService_.save();
    }

    private getActiveConfig(): BuildConfig | null {
        return this.settings_.configs.find(c => c.id === this.settings_.activeConfigId) ?? null;
    }

    private getProjectDir(): string {
        const normalized = this.options_.projectPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
    }

    private close(): void {
        this.dispose();
        this.options_.onClose();
    }

    private render(): void {
        if (!this.overlay_) return;

        const config = this.getActiveConfig();
        const ctx = this.createRenderContext();

        this.overlay_.innerHTML = `
            <div class="es-build-dialog es-build-dialog-wide">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">${icons.cog(16)} Build Settings</span>
                    <button class="es-dialog-close" data-action="close">&times;</button>
                </div>
                <div class="es-build-toolbar">
                    <div class="es-build-toolbar-left">
                        <button class="es-btn es-btn-icon" data-action="add-config" title="Add Build Config">
                            ${icons.plus(14)} Add
                        </button>
                        <button class="es-btn es-btn-icon" data-action="import-configs" title="Import Configs">
                            ${icons.upload(14)} Import
                        </button>
                        <button class="es-btn es-btn-icon" data-action="export-configs" title="Export Configs">
                            ${icons.download(14)} Export
                        </button>
                        <button class="es-btn es-btn-icon" data-action="show-templates" title="Templates">
                            ${icons.template(14)} Templates
                        </button>
                    </div>
                    <div class="es-build-toolbar-right">
                        <label class="es-build-clean-toggle" title="Delete cached build and recompile from scratch">
                            <input type="checkbox" data-action="clean-build"> Clean Build
                        </label>
                        <button class="es-btn" data-action="build-all" title="Build All Configs">
                            Build All
                        </button>
                        <button class="es-btn es-btn-primary" data-action="build" ${!config ? 'disabled' : ''}>
                            ${icons.play(14)} Build
                        </button>
                    </div>
                </div>
                <div class="es-build-body es-build-body-three-col">
                    <div class="es-build-sidebar">
                        ${renderSidebar(ctx)}
                    </div>
                    <div class="es-build-detail">
                        ${config ? renderDetail(ctx, config) : renderNoConfig()}
                    </div>
                    <div class="es-build-output">
                        ${config ? renderOutputPanel(ctx, config) : ''}
                    </div>
                </div>
            </div>
        `;

        setupSceneDragAndDrop(this.createActionContext());
    }

    private createRenderContext(): BuildSettingsRenderContext {
        return {
            settings: this.settings_,
            history: this.history_,
            expandedSections: this.expandedSections_,
            lastBuildOutputFiles: this.lastBuildOutputFiles_,
            toolchainStatus: this.toolchainStatus_,
            toolchainError: this.toolchainError_,
        };
    }

    private createToolchainContext(): BuildSettingsToolchainContext {
        const self = this;
        return {
            get overlay() { return self.overlay_; },
            get toolchainStatus() { return self.toolchainStatus_; },
            set toolchainStatus(v) { self.toolchainStatus_ = v; },
            get toolchainError() { return self.toolchainError_; },
            set toolchainError(v) { self.toolchainError_ = v; },
        };
    }

    private createActionContext(): BuildSettingsActionContext {
        const self = this;
        return {
            get settings() { return self.settings_; },
            get history() { return self.history_; },
            get expandedSections() { return self.expandedSections_; },
            get lastBuildOutputFiles() { return self.lastBuildOutputFiles_; },
            get toolchainStatus() { return self.toolchainStatus_; },
            get toolchainError() { return self.toolchainError_; },
            get overlay() { return self.overlay_; },
            get batchBuilder() { return self.batchBuilder_; },
            get keyHandler() { return self.keyHandler_; },
            set keyHandler(v) { self.keyHandler_ = v; },
            get dragSourceIndex() { return self.dragSourceIndex_; },
            set dragSourceIndex(v) { self.dragSourceIndex_ = v; },
            render: () => self.render(),
            close: () => self.close(),
            saveSettings: () => self.saveSettings(),
            getActiveConfig: () => self.getActiveConfig(),
            getProjectDir: () => self.getProjectDir(),
            onBuild: (config, options) => self.options_.onBuild(config, options),
            handleBrowseEmsdk: () => handleBrowseEmsdk(self.createToolchainContext()),
            handleInstallEmsdk: () => handleInstallEmsdk(self.createToolchainContext()),
            handleRepairToolchain: () => handleRepairToolchain(self.createToolchainContext()),
        };
    }

    private overlay_!: HTMLElement;
    private options_!: BuildSettingsDialogOptions;
    private settings_!: BuildSettings;
    private configService_!: BuildConfigService;
    private history_!: BuildHistory;
    private batchBuilder_!: BatchBuilder;
    private expandedSections_: Set<string> = new Set(['scenes', 'defines', 'platform', 'engine-modules']);
    private keyHandler_: ((e: KeyboardEvent) => void) | null = null;
    private dragSourceIndex_ = -1;
    private lastBuildOutputFiles_: Map<string, Array<{ path: string; size: number }>> = new Map();
    private toolchainStatus_: ToolchainStatus | null = null;
    private toolchainError_ = false;
}

let activeDialog: BuildSettingsDialog | null = null;

export function showBuildSettingsDialog(options: BuildSettingsDialogOptions): BuildSettingsDialog {
    if (activeDialog) {
        return activeDialog;
    }

    const originalOnClose = options.onClose;
    options.onClose = () => {
        activeDialog = null;
        originalOnClose?.();
    };

    activeDialog = new BuildSettingsDialog(options);
    return activeDialog;
}
