/**
 * @file    BuildSettingsDialog.ts
 * @brief   Build settings dialog UI component with three-column layout
 */

import { icons } from '../utils/icons';
import {
    type BuildPlatform,
    type BuildConfig,
    type BuildSettings,
    PLATFORMS,
    createDefaultBuildConfig,
    createDefaultBuildSettings,
} from '../types/BuildTypes';
import { type BuildResult } from './BuildService';
import { showProgressToast, dismissToast, showToast } from '../ui/Toast';
import { BuildHistory, formatBuildTime, formatBuildDuration, getBuildStatusIcon, type BuildHistoryEntry } from './BuildHistory';
import { BuildConfigService, initBuildConfigService } from './BuildConfigService';
import { downloadConfigsAsFile, uploadConfigsFromFile } from './BuildConfigIO';
import { BUILD_TEMPLATES, createConfigFromTemplate, type BuildTemplate } from './BuildTemplates';
import { BatchBuilder } from './BatchBuilder';
import { formatSize } from './BuildProgress';

// =============================================================================
// Types
// =============================================================================

export interface BuildSettingsDialogOptions {
    projectPath: string;
    onBuild: (config: BuildConfig) => Promise<BuildResult>;
    onClose: () => void;
}

// =============================================================================
// Storage (Legacy - for migration)
// =============================================================================

const BUILD_SETTINGS_KEY = 'esengine_build_settings';

function loadBuildSettings(): BuildSettings {
    try {
        const data = localStorage.getItem(BUILD_SETTINGS_KEY);
        if (data) {
            return JSON.parse(data) as BuildSettings;
        }
    } catch {
        // Ignore parse errors
    }
    return createDefaultBuildSettings();
}

function saveBuildSettings(settings: BuildSettings): void {
    localStorage.setItem(BUILD_SETTINGS_KEY, JSON.stringify(settings));
}

// =============================================================================
// BuildSettingsDialog
// =============================================================================

export class BuildSettingsDialog {
    constructor(options: BuildSettingsDialogOptions) {
        this.options_ = options;
        this.settings_ = loadBuildSettings();

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
        this.setupEvents();
    }

    dispose(): void {
        this.saveSettings();
        if (this.keyHandler_) {
            document.removeEventListener('keydown', this.keyHandler_);
        }
        this.overlay_?.remove();
    }

    private async saveSettings(): Promise<void> {
        saveBuildSettings(this.settings_);
        await this.configService_.save();
    }

    private getActiveConfig(): BuildConfig | null {
        return this.settings_.configs.find(c => c.id === this.settings_.activeConfigId) ?? null;
    }

    private render(): void {
        if (!this.overlay_) return;

        const config = this.getActiveConfig();

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
                        ${this.renderSidebar()}
                    </div>
                    <div class="es-build-detail">
                        ${config ? this.renderDetail(config) : this.renderNoConfig()}
                    </div>
                    <div class="es-build-output">
                        ${config ? this.renderOutputPanel(config) : ''}
                    </div>
                </div>
            </div>
        `;
    }

    private renderSidebar(): string {
        const platformsHtml = PLATFORMS.map(p => {
            const isActive = this.settings_.activePlatform === p.id;
            const configs = this.settings_.configs.filter(c => c.platform === p.id);

            return `
                <div class="es-build-platform ${isActive ? 'es-active' : ''}" data-platform="${p.id}">
                    <div class="es-build-platform-header">
                        ${icons[p.icon as keyof typeof icons](14)}
                        <span>${p.name}</span>
                        ${isActive ? '<span class="es-build-badge">Active</span>' : ''}
                    </div>
                </div>
                ${configs.map(c => this.renderConfigItem(c)).join('')}
            `;
        }).join('');

        return `
            <div class="es-build-section-title">Platforms</div>
            ${platformsHtml}
        `;
    }

    private renderConfigItem(config: BuildConfig): string {
        const isActive = this.settings_.activeConfigId === config.id;
        const latestBuild = this.history_.getLatest(config.id);
        const statusIndicator = latestBuild
            ? `<span class="es-build-status-dot es-build-status-${latestBuild.status}"></span>`
            : '';

        return `
            <div class="es-build-config-item ${isActive ? 'es-active' : ''}" data-config="${config.id}">
                ${statusIndicator}
                <span class="es-build-config-name">${config.name}</span>
                <button class="es-btn-icon es-build-config-delete" data-action="delete-config" data-config="${config.id}" title="Delete">
                    ${icons.x(10)}
                </button>
            </div>
        `;
    }

    private renderNoConfig(): string {
        return `
            <div class="es-build-empty">
                <p>No build config selected</p>
                <p>Select a config from the left or create a new one</p>
            </div>
        `;
    }

    private renderDetail(config: BuildConfig): string {
        return `
            <div class="es-build-detail-header">
                <div class="es-build-detail-title">
                    <input type="text" class="es-build-name-input" id="config-name-input"
                           value="${config.name}" placeholder="Config Name">
                    <span class="es-build-detail-platform">${this.getPlatformName(config.platform)}</span>
                </div>
                <div class="es-build-detail-actions">
                    <button class="es-btn es-btn-icon" data-action="duplicate-config" title="Duplicate">
                        ${icons.copy(14)}
                    </button>
                </div>
            </div>
            <div class="es-build-detail-content">
                <div class="es-build-data-section">
                    ${this.renderScenesSection(config)}
                    ${this.renderDefinesSection(config)}
                </div>
                <div class="es-build-settings-section">
                    ${this.renderPlatformSettings(config)}
                </div>
            </div>
        `;
    }

    private renderOutputPanel(config: BuildConfig): string {
        const latestBuild = this.history_.getLatest(config.id);
        const recentBuilds = this.history_.getEntries(config.id).slice(0, 5);

        const latestSection = latestBuild ? `
            <div class="es-build-output-latest">
                <div class="es-build-output-stat">
                    <span class="es-build-output-label">Last Build</span>
                    <span class="es-build-output-value">${formatBuildTime(latestBuild.timestamp)}</span>
                </div>
                <div class="es-build-output-stat">
                    <span class="es-build-output-label">Status</span>
                    <span class="es-build-output-value es-build-status-${latestBuild.status}">
                        ${getBuildStatusIcon(latestBuild.status)} ${latestBuild.status}
                    </span>
                </div>
                ${latestBuild.outputSize ? `
                <div class="es-build-output-stat">
                    <span class="es-build-output-label">Size</span>
                    <span class="es-build-output-value">${formatSize(latestBuild.outputSize)}</span>
                </div>
                ` : ''}
                <div class="es-build-output-stat">
                    <span class="es-build-output-label">Duration</span>
                    <span class="es-build-output-value">${formatBuildDuration(latestBuild.duration)}</span>
                </div>
                ${latestBuild.outputPath ? `
                <div class="es-build-output-actions">
                    <button class="es-btn es-btn-small" data-action="open-output" data-path="${latestBuild.outputPath}">
                        ${icons.folder(12)} Open
                    </button>
                    <button class="es-btn es-btn-small" data-action="preview-output" data-path="${latestBuild.outputPath}">
                        ${icons.play(12)} Preview
                    </button>
                </div>
                ` : ''}
            </div>
        ` : `
            <div class="es-build-output-empty">
                No builds yet
            </div>
        `;

        const historySection = recentBuilds.length > 0 ? `
            <div class="es-build-history">
                <div class="es-build-section-title">Build History</div>
                <div class="es-build-history-list">
                    ${recentBuilds.map(entry => this.renderHistoryEntry(entry)).join('')}
                </div>
            </div>
        ` : '';

        return `
            <div class="es-build-output-header">
                <span class="es-build-section-title">Build Output</span>
                ${recentBuilds.length > 0 ? `
                <button class="es-btn-icon" data-action="clear-history" title="Clear History">
                    ${icons.trash(12)}
                </button>
                ` : ''}
            </div>
            ${latestSection}
            ${historySection}
        `;
    }

    private renderHistoryEntry(entry: BuildHistoryEntry): string {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        return `
            <div class="es-build-history-item es-build-status-${entry.status}">
                <span class="es-build-history-icon">${getBuildStatusIcon(entry.status)}</span>
                <span class="es-build-history-time">${time}</span>
                <span class="es-build-history-duration">${formatBuildDuration(entry.duration)}</span>
            </div>
        `;
    }

    private renderScenesSection(config: BuildConfig): string {
        const isExpanded = this.expandedSections_.has('scenes');
        const scenesHtml = config.scenes.length > 0
            ? config.scenes.map((s, i) => `
                <div class="es-build-scene-item">
                    <input type="checkbox" checked data-scene-index="${i}">
                    <span>${s}</span>
                    <button class="es-btn-icon" data-action="remove-scene" data-index="${i}">
                        ${icons.x(10)}
                    </button>
                </div>
            `).join('')
            : '<div class="es-build-empty-list">No scenes</div>';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="scenes">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Scenes</span>
                    <span class="es-build-collapse-count">${config.scenes.length}</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-scene-list">
                        ${scenesHtml}
                    </div>
                    <button class="es-btn es-btn-link" data-action="add-current-scene">
                        ${icons.plus(12)} Add Current Scene
                    </button>
                </div>
            </div>
        `;
    }

    private renderDefinesSection(config: BuildConfig): string {
        const isExpanded = this.expandedSections_.has('defines');
        const definesHtml = config.defines.length > 0
            ? config.defines.map((d, i) => `
                <div class="es-build-define-item">
                    <span>${d}</span>
                    <button class="es-btn-icon" data-action="remove-define" data-index="${i}">
                        ${icons.x(10)}
                    </button>
                </div>
            `).join('')
            : '';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="defines">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Script Defines</span>
                    <span class="es-build-collapse-count">${config.defines.length}</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-define-list">
                        ${definesHtml}
                    </div>
                    <div class="es-build-define-add">
                        <input type="text" class="es-input" id="new-define" placeholder="New define...">
                        <button class="es-btn-icon" data-action="add-define" title="Add">
                            ${icons.plus(12)}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    private renderPlatformSettings(config: BuildConfig): string {
        const isExpanded = this.expandedSections_.has('platform');

        let settingsHtml = '';
        if (config.platform === 'playable' && config.playableSettings) {
            const s = config.playableSettings;
            settingsHtml = `
                <div class="es-build-field">
                    <label class="es-build-label">Startup Scene</label>
                    <div class="es-build-path-row">
                        <input type="text" class="es-input" id="playable-startup-scene"
                               value="${s.startupScene || ''}" placeholder="assets/scenes/main.scene">
                        <button class="es-btn" data-action="browse-startup-scene">...</button>
                    </div>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-dev" ${s.isDevelopment ? 'checked' : ''}>
                        Development Build
                    </label>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-minify" ${s.minifyCode ? 'checked' : ''}>
                        Minify Code
                    </label>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-fonts" ${s.embedFonts ? 'checked' : ''}>
                        Embed Fonts
                    </label>
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">Output Path</label>
                    <div class="es-build-path-row">
                        <input type="text" class="es-input" id="playable-output" value="${s.outputPath}">
                        <button class="es-btn" data-action="browse-output">...</button>
                    </div>
                </div>
            `;
        } else if (config.platform === 'wechat' && config.wechatSettings) {
            const s = config.wechatSettings;
            settingsHtml = `
                <div class="es-build-field">
                    <label class="es-build-label">AppID</label>
                    <input type="text" class="es-input" id="wechat-appid" value="${s.appId}" placeholder="wx...">
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">Version</label>
                    <input type="text" class="es-input" id="wechat-version" value="${s.version}">
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">Screen Orientation</label>
                    <select class="es-select" id="wechat-orientation">
                        <option value="portrait" ${(s.orientation || 'portrait') === 'portrait' ? 'selected' : ''}>Portrait</option>
                        <option value="landscape" ${s.orientation === 'landscape' ? 'selected' : ''}>Landscape</option>
                    </select>
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">Bundle Mode</label>
                    <select class="es-select" id="wechat-bundle">
                        <option value="subpackage" ${s.bundleMode === 'subpackage' ? 'selected' : ''}>Subpackage (Recommended)</option>
                        <option value="single" ${s.bundleMode === 'single' ? 'selected' : ''}>Single Package</option>
                        <option value="singleFile" ${s.bundleMode === 'singleFile' ? 'selected' : ''}>Single File (Playable Ad)</option>
                    </select>
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">Output Directory</label>
                    <div class="es-build-path-row">
                        <input type="text" class="es-input" id="wechat-output" value="${s.outputDir}">
                        <button class="es-btn" data-action="browse-output">...</button>
                    </div>
                </div>
            `;
        }

        const platformName = config.platform === 'playable' ? 'Playable' : 'WeChat MiniGame';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="platform">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>${platformName} Settings</span>
                </div>
                <div class="es-build-collapse-content">
                    ${settingsHtml}
                </div>
            </div>
        `;
    }

    private getPlatformName(platform: BuildPlatform): string {
        return PLATFORMS.find(p => p.id === platform)?.name ?? platform;
    }

    private close(): void {
        this.dispose();
        this.options_.onClose();
    }

    private setupEvents(): void {
        if (!this.overlay_) return;

        this.overlay_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            if (target.closest('[data-action="close"]')) {
                this.close();
                return;
            }

            const platformEl = target.closest('.es-build-platform') as HTMLElement;
            if (platformEl) {
                const platform = platformEl.dataset.platform as BuildPlatform;
                this.settings_.activePlatform = platform;
                const firstConfig = this.settings_.configs.find(c => c.platform === platform);
                if (firstConfig) {
                    this.settings_.activeConfigId = firstConfig.id;
                }
                this.render();
                return;
            }

            const configEl = target.closest('.es-build-config-item') as HTMLElement;
            if (configEl && !target.closest('[data-action="delete-config"]')) {
                const configId = configEl.dataset.config;
                if (configId) {
                    this.settings_.activeConfigId = configId;
                    this.render();
                }
                return;
            }

            const collapseHeader = target.closest('.es-build-collapse-header') as HTMLElement;
            if (collapseHeader) {
                const collapse = collapseHeader.closest('.es-build-collapse') as HTMLElement;
                const section = collapse?.dataset.section;
                if (section) {
                    if (this.expandedSections_.has(section)) {
                        this.expandedSections_.delete(section);
                    } else {
                        this.expandedSections_.add(section);
                    }
                    this.render();
                }
                return;
            }

            const actionEl = target.closest('[data-action]') as HTMLElement;
            if (actionEl) {
                const action = actionEl.dataset.action;
                this.handleAction(action, actionEl);
            }
        });

        this.overlay_.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement | HTMLSelectElement;
            this.handleInputChange(target);
        });

        this.overlay_.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.id === 'config-name-input') {
                const config = this.getActiveConfig();
                if (config) {
                    config.name = target.value;
                    this.saveSettings();
                }
            }
        });

        this.keyHandler_ = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                const config = this.getActiveConfig();
                if (config) {
                    this.handleBuild(config);
                }
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                e.preventDefault();
                const config = this.getActiveConfig();
                if (config) {
                    this.duplicateConfig(config);
                }
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                const target = e.target as HTMLElement;
                if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
                    const config = this.getActiveConfig();
                    if (config) {
                        this.deleteConfig(config.id);
                    }
                }
            }
        };
        document.addEventListener('keydown', this.keyHandler_);
    }

    private async handleAction(action: string | undefined, element: HTMLElement): Promise<void> {
        const config = this.getActiveConfig();

        switch (action) {
            case 'add-config':
                this.showAddConfigDialog();
                break;

            case 'delete-config': {
                const configId = element.dataset.config;
                if (configId) {
                    this.deleteConfig(configId);
                }
                break;
            }

            case 'duplicate-config':
                if (config) {
                    this.duplicateConfig(config);
                }
                break;

            case 'add-current-scene':
                if (config) {
                    const editor = (window as any).__esengine_editor;
                    const scenePath = editor?.currentScenePath;
                    if (scenePath) {
                        const relativePath = this.toRelativePath(scenePath);
                        if (!config.scenes.includes(relativePath)) {
                            config.scenes.push(relativePath);
                            await this.saveSettings();
                            this.render();
                        }
                    }
                }
                break;

            case 'remove-scene': {
                const index = parseInt(element.dataset.index ?? '-1', 10);
                if (config && index >= 0) {
                    config.scenes.splice(index, 1);
                    await this.saveSettings();
                    this.render();
                }
                break;
            }

            case 'add-define': {
                const input = this.overlay_.querySelector('#new-define') as HTMLInputElement;
                const value = input?.value.trim();
                if (config && value && !config.defines.includes(value)) {
                    config.defines.push(value);
                    await this.saveSettings();
                    this.render();
                }
                break;
            }

            case 'remove-define': {
                const index = parseInt(element.dataset.index ?? '-1', 10);
                if (config && index >= 0) {
                    config.defines.splice(index, 1);
                    await this.saveSettings();
                    this.render();
                }
                break;
            }

            case 'build':
                if (config) {
                    this.handleBuild(config);
                }
                break;

            case 'build-all':
                this.handleBuildAll();
                break;

            case 'import-configs':
                this.handleImportConfigs();
                break;

            case 'export-configs':
                downloadConfigsAsFile(this.settings_.configs);
                break;

            case 'show-templates':
                this.showTemplatesDialog();
                break;

            case 'open-output': {
                const path = element.dataset.path;
                if (path) {
                    this.openOutputFolder(path);
                }
                break;
            }

            case 'preview-output': {
                const path = element.dataset.path;
                if (path) {
                    this.previewOutput(path);
                }
                break;
            }

            case 'clear-history':
                if (config) {
                    this.history_.clearHistory(config.id);
                    await this.history_.save();
                    this.render();
                }
                break;

            case 'browse-startup-scene':
                this.browseFile('playable-startup-scene', 'Scene File', ['scene']);
                break;

            case 'browse-output':
                this.browseFile('playable-output', 'HTML File', ['html']);
                break;
        }
    }

    private async browseFile(inputId: string, title: string, extensions: string[]): Promise<void> {
        const fs = (window as any).__esengine_fs;
        if (!fs?.showOpenDialog) return;

        const result = await fs.showOpenDialog({
            title: `Select ${title}`,
            filters: [{ name: title, extensions }],
        });

        if (result && result.length > 0) {
            const input = this.overlay_.querySelector(`#${inputId}`) as HTMLInputElement;
            if (input) {
                input.value = result[0];
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    private handleInputChange(target: HTMLInputElement | HTMLSelectElement): void {
        const config = this.getActiveConfig();
        if (!config) return;

        const id = target.id;

        if (config.playableSettings) {
            if (id === 'playable-startup-scene') {
                config.playableSettings.startupScene = target.value;
            } else if (id === 'playable-dev') {
                config.playableSettings.isDevelopment = (target as HTMLInputElement).checked;
            } else if (id === 'playable-minify') {
                config.playableSettings.minifyCode = (target as HTMLInputElement).checked;
            } else if (id === 'playable-fonts') {
                config.playableSettings.embedFonts = (target as HTMLInputElement).checked;
            } else if (id === 'playable-output') {
                config.playableSettings.outputPath = target.value;
            }
        }

        if (config.wechatSettings) {
            if (id === 'wechat-appid') {
                config.wechatSettings.appId = target.value;
            } else if (id === 'wechat-version') {
                config.wechatSettings.version = target.value;
            } else if (id === 'wechat-orientation') {
                config.wechatSettings.orientation = target.value as 'portrait' | 'landscape';
            } else if (id === 'wechat-bundle') {
                config.wechatSettings.bundleMode = target.value as 'subpackage' | 'single' | 'singleFile';
            } else if (id === 'wechat-output') {
                config.wechatSettings.outputDir = target.value;
            }
        }

        this.saveSettings();
    }

    private showAddConfigDialog(): void {
        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';
        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 320px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Add Build Config</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Config Name</label>
                        <input type="text" class="es-dialog-input" id="config-name" placeholder="My Config">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Target Platform</label>
                        <select class="es-dialog-input" id="config-platform">
                            ${PLATFORMS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="confirm">Create</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);

        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
            const nameInput = dialog.querySelector('#config-name') as HTMLInputElement;
            const platformSelect = dialog.querySelector('#config-platform') as HTMLSelectElement;
            const name = nameInput.value.trim() || 'New Config';
            const platform = platformSelect.value as BuildPlatform;

            const newConfig = createDefaultBuildConfig(platform, name);
            this.settings_.configs.push(newConfig);
            this.settings_.activeConfigId = newConfig.id;
            await this.saveSettings();

            close();
            this.render();
        });
    }

    private showTemplatesDialog(): void {
        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';

        const templatesHtml = BUILD_TEMPLATES.map(t => `
            <div class="es-build-template-item" data-template="${t.id}">
                <div class="es-build-template-header">
                    <span class="es-build-template-name">${t.name}</span>
                    <span class="es-build-template-platform">${t.platform}</span>
                </div>
                <div class="es-build-template-desc">${t.description}</div>
            </div>
        `).join('');

        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 400px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Build Templates</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-build-templates-list">
                        ${templatesHtml}
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);

        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);

        dialog.querySelectorAll('.es-build-template-item').forEach(item => {
            item.addEventListener('click', async () => {
                const templateId = (item as HTMLElement).dataset.template;
                const template = BUILD_TEMPLATES.find(t => t.id === templateId);
                if (template) {
                    const newConfig = createConfigFromTemplate(template);
                    this.settings_.configs.push(newConfig);
                    this.settings_.activeConfigId = newConfig.id;
                    await this.saveSettings();
                    close();
                    this.render();
                }
            });
        });
    }

    private async handleImportConfigs(): Promise<void> {
        const result = await uploadConfigsFromFile();

        if (result.success && result.configs.length > 0) {
            for (const config of result.configs) {
                this.settings_.configs.push(config);
            }
            await this.saveSettings();
            this.render();

            showToast({
                type: 'success',
                title: 'Import Successful',
                message: `Imported ${result.configs.length} config(s)`,
                duration: 3000,
            });
        } else if (result.errors.length > 0) {
            showToast({
                type: 'error',
                title: 'Import Failed',
                message: result.errors[0],
                duration: 5000,
            });
        }
    }

    private duplicateConfig(config: BuildConfig): void {
        const newConfig: BuildConfig = {
            ...JSON.parse(JSON.stringify(config)),
            id: `${config.platform}-${Date.now()}`,
            name: `${config.name} (Copy)`,
        };

        this.settings_.configs.push(newConfig);
        this.settings_.activeConfigId = newConfig.id;
        this.saveSettings();
        this.render();
    }

    private deleteConfig(configId: string): void {
        const idx = this.settings_.configs.findIndex(c => c.id === configId);
        if (idx >= 0) {
            this.settings_.configs.splice(idx, 1);
            if (this.settings_.activeConfigId === configId) {
                this.settings_.activeConfigId = this.settings_.configs[0]?.id ?? '';
            }
            this.saveSettings();
            this.render();
        }
    }

    private async handleBuild(config: BuildConfig): Promise<void> {
        const buildBtn = this.overlay_.querySelector('[data-action="build"]') as HTMLButtonElement;
        const buildAllBtn = this.overlay_.querySelector('[data-action="build-all"]') as HTMLButtonElement;

        if (buildBtn) {
            buildBtn.disabled = true;
            buildBtn.innerHTML = `${icons.refresh(14)} Building...`;
        }
        if (buildAllBtn) {
            buildAllBtn.disabled = true;
        }

        const platformName = this.getPlatformName(config.platform);
        const toastId = showProgressToast(
            `Building ${config.name}`,
            `Target: ${platformName}`
        );

        try {
            const result = await this.options_.onBuild(config);

            dismissToast(toastId);

            if (result.success && result.outputPath) {
                this.history_.addEntry({
                    configId: config.id,
                    configName: config.name,
                    platform: config.platform,
                    timestamp: Date.now(),
                    duration: result.duration || 0,
                    status: 'success',
                    outputPath: result.outputPath,
                    outputSize: result.outputSize,
                });
                await this.history_.save();

                showToast({
                    type: 'success',
                    title: 'Build Completed',
                    message: `Output: ${this.getFileName(result.outputPath)}`,
                    duration: 0,
                    actions: [
                        {
                            label: 'Open Folder',
                            primary: true,
                            onClick: () => this.openOutputFolder(result.outputPath!),
                        },
                        {
                            label: 'Close',
                            onClick: () => {},
                        },
                    ],
                });
            } else if (!result.success) {
                this.history_.addEntry({
                    configId: config.id,
                    configName: config.name,
                    platform: config.platform,
                    timestamp: Date.now(),
                    duration: result.duration || 0,
                    status: 'failed',
                    error: result.error,
                });
                await this.history_.save();

                showToast({
                    type: 'error',
                    title: 'Build Failed',
                    message: result.error || 'Unknown error',
                    duration: 5000,
                });
            }

            this.render();
        } catch (err) {
            dismissToast(toastId);
            showToast({
                type: 'error',
                title: 'Build Failed',
                message: String(err),
                duration: 5000,
            });
        } finally {
            if (buildBtn) {
                buildBtn.disabled = false;
                buildBtn.innerHTML = `${icons.play(14)} Build`;
            }
            if (buildAllBtn) {
                buildAllBtn.disabled = false;
            }
        }
    }

    private async handleBuildAll(): Promise<void> {
        const buildBtn = this.overlay_.querySelector('[data-action="build"]') as HTMLButtonElement;
        const buildAllBtn = this.overlay_.querySelector('[data-action="build-all"]') as HTMLButtonElement;

        if (buildBtn) buildBtn.disabled = true;
        if (buildAllBtn) {
            buildAllBtn.disabled = true;
            buildAllBtn.textContent = 'Building...';
        }

        const toastId = showProgressToast(
            'Building All Configs',
            `0 / ${this.settings_.configs.length} completed`
        );

        try {
            const result = await this.batchBuilder_.buildAll(this.settings_.configs);

            dismissToast(toastId);

            if (result.success) {
                showToast({
                    type: 'success',
                    title: 'Build All Completed',
                    message: `${result.successCount} succeeded, ${result.failureCount} failed`,
                    duration: 5000,
                });
            } else {
                showToast({
                    type: 'error',
                    title: 'Build All Completed with Errors',
                    message: `${result.successCount} succeeded, ${result.failureCount} failed`,
                    duration: 5000,
                });
            }

            this.render();
        } catch (err) {
            dismissToast(toastId);
            showToast({
                type: 'error',
                title: 'Build All Failed',
                message: String(err),
                duration: 5000,
            });
        } finally {
            if (buildBtn) buildBtn.disabled = false;
            if (buildAllBtn) {
                buildAllBtn.disabled = false;
                buildAllBtn.textContent = 'Build All';
            }
        }
    }

    private getFileName(path: string): string {
        const parts = path.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || path;
    }

    private toRelativePath(absolutePath: string): string {
        const normalized = absolutePath.replace(/\\/g, '/');
        const projectDir = this.getProjectDir();
        if (normalized.startsWith(projectDir)) {
            return normalized.substring(projectDir.length + 1);
        }
        return normalized;
    }

    private getProjectDir(): string {
        const normalized = this.options_.projectPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
    }

    private async openOutputFolder(outputPath: string): Promise<void> {
        try {
            const dirPath = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
            const fs = (window as any).__esengine_fs;
            if (fs?.openFolder) {
                await fs.openFolder(dirPath);
            }
        } catch (err) {
            console.error('Failed to open folder:', err);
        }
    }

    private async previewOutput(outputPath: string): Promise<void> {
        try {
            const fs = (window as any).__esengine_fs;
            if (fs?.openFile) {
                await fs.openFile(outputPath);
            }
        } catch (err) {
            console.error('Failed to preview output:', err);
        }
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private overlay_!: HTMLElement;
    private options_!: BuildSettingsDialogOptions;
    private settings_!: BuildSettings;
    private configService_!: BuildConfigService;
    private history_!: BuildHistory;
    private batchBuilder_!: BatchBuilder;
    private expandedSections_: Set<string> = new Set(['scenes', 'defines', 'platform']);
    private keyHandler_: ((e: KeyboardEvent) => void) | null = null;
}

// =============================================================================
// Helper Function
// =============================================================================

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
