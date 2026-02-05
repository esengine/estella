/**
 * @file    BuildSettingsDialog.ts
 * @brief   Build settings dialog UI component
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
import { showProgressToast, updateToast, dismissToast, showToast } from '../ui/Toast';

// =============================================================================
// Types
// =============================================================================

export interface BuildSettingsDialogOptions {
    projectPath: string;
    onBuild: (config: BuildConfig) => Promise<BuildResult>;
    onClose: () => void;
}

// =============================================================================
// Storage
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
        saveBuildSettings(this.settings_);
        this.overlay_.remove();
    }

    private getActiveConfig(): BuildConfig | null {
        return this.settings_.configs.find(c => c.id === this.settings_.activeConfigId) ?? null;
    }

    private render(): void {
        const config = this.getActiveConfig();

        this.overlay_.innerHTML = `
            <div class="es-build-dialog">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">${icons.cog(16)} 构建设置</span>
                    <button class="es-dialog-close" data-action="close">&times;</button>
                </div>
                <div class="es-build-toolbar">
                    <button class="es-btn es-btn-icon" data-action="add-config" title="添加构建配置">
                        ${icons.plus(14)} 添加构建配置
                    </button>
                </div>
                <div class="es-build-body">
                    <div class="es-build-sidebar">
                        ${this.renderSidebar()}
                    </div>
                    <div class="es-build-detail">
                        ${config ? this.renderDetail(config) : this.renderNoConfig()}
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
                        ${isActive ? '<span class="es-build-badge">激活</span>' : ''}
                    </div>
                </div>
                ${configs.map(c => this.renderConfigItem(c)).join('')}
            `;
        }).join('');

        return `
            <div class="es-build-section-title">平台</div>
            ${platformsHtml}
        `;
    }

    private renderConfigItem(config: BuildConfig): string {
        const isActive = this.settings_.activeConfigId === config.id;
        return `
            <div class="es-build-config-item ${isActive ? 'es-active' : ''}" data-config="${config.id}">
                <span class="es-build-config-name">${config.name}</span>
                <button class="es-btn-icon es-build-config-delete" data-action="delete-config" data-config="${config.id}" title="删除">
                    ${icons.x(10)}
                </button>
            </div>
        `;
    }

    private renderNoConfig(): string {
        return `
            <div class="es-build-empty">
                <p>没有选中的构建配置</p>
                <p>请从左侧选择一个配置或创建新配置</p>
            </div>
        `;
    }

    private renderDetail(config: BuildConfig): string {
        return `
            <div class="es-build-detail-header">
                <div class="es-build-detail-title">
                    <h3>${config.name}</h3>
                    <span class="es-build-detail-platform">${this.getPlatformName(config.platform)}</span>
                </div>
                <div class="es-build-detail-actions">
                    <button class="es-btn" data-action="switch-config">切换配置</button>
                    <button class="es-btn es-btn-primary" data-action="build">
                        ${icons.play(14)} 构建
                    </button>
                </div>
            </div>
            <div class="es-build-detail-content">
                <div class="es-build-data-section">
                    <h4>构建数据</h4>
                    ${this.renderScenesSection(config)}
                    ${this.renderDefinesSection(config)}
                </div>
                <div class="es-build-settings-section">
                    <h4>平台设置</h4>
                    ${this.renderPlatformSettings(config)}
                </div>
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
            : '<div class="es-build-empty-list">没有场景</div>';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="scenes">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>场景列表</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-scene-list">
                        ${scenesHtml}
                    </div>
                    <button class="es-btn es-btn-link" data-action="add-current-scene">
                        添加已打开的场景
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
                    <span>脚本定义</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-define-list">
                        ${definesHtml}
                    </div>
                    <div class="es-build-define-add">
                        <input type="text" class="es-input" id="new-define" placeholder="新定义...">
                        <button class="es-btn-icon" data-action="add-define" title="添加">
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
                    <label class="es-build-label">启动场景</label>
                    <div class="es-build-path-row">
                        <input type="text" class="es-input" id="playable-startup-scene"
                               value="${s.startupScene || ''}" placeholder="assets/scenes/main.scene">
                        <button class="es-btn" data-action="browse-startup-scene">...</button>
                    </div>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-dev" ${s.isDevelopment ? 'checked' : ''}>
                        开发版本
                    </label>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-minify" ${s.minifyCode ? 'checked' : ''}>
                        压缩代码
                    </label>
                </div>
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-fonts" ${s.embedFonts ? 'checked' : ''}>
                        内嵌字体
                    </label>
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">输出路径</label>
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
                    <label class="es-build-label">版本号</label>
                    <input type="text" class="es-input" id="wechat-version" value="${s.version}">
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">构建模式</label>
                    <select class="es-select" id="wechat-bundle">
                        <option value="subpackage" ${s.bundleMode === 'subpackage' ? 'selected' : ''}>分包模式（推荐）</option>
                        <option value="single" ${s.bundleMode === 'single' ? 'selected' : ''}>单包模式</option>
                        <option value="singleFile" ${s.bundleMode === 'singleFile' ? 'selected' : ''}>单文件模式（可玩广告）</option>
                    </select>
                </div>
                <div class="es-build-field">
                    <label class="es-build-label">输出目录</label>
                    <div class="es-build-path-row">
                        <input type="text" class="es-input" id="wechat-output" value="${s.outputDir}">
                        <button class="es-btn" data-action="browse-output">...</button>
                    </div>
                </div>
            `;
        }

        const platformName = config.platform === 'playable' ? '试玩平台' : '微信小游戏';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="platform">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>${platformName}设置</span>
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
        this.overlay_.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.close();
        });

        this.overlay_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Platform selection
            const platformEl = target.closest('.es-build-platform') as HTMLElement;
            if (platformEl) {
                const platform = platformEl.dataset.platform as BuildPlatform;
                this.settings_.activePlatform = platform;
                const firstConfig = this.settings_.configs.find(c => c.platform === platform);
                if (firstConfig) {
                    this.settings_.activeConfigId = firstConfig.id;
                }
                this.render();
                this.setupEvents();
                return;
            }

            // Config selection
            const configEl = target.closest('.es-build-config-item') as HTMLElement;
            if (configEl && !target.closest('[data-action="delete-config"]')) {
                const configId = configEl.dataset.config;
                if (configId) {
                    this.settings_.activeConfigId = configId;
                    this.render();
                    this.setupEvents();
                }
                return;
            }

            // Collapse toggle
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
                    this.setupEvents();
                }
                return;
            }

            // Action buttons
            const actionEl = target.closest('[data-action]') as HTMLElement;
            if (actionEl) {
                const action = actionEl.dataset.action;
                this.handleAction(action, actionEl);
            }
        });

        // Input change events
        this.overlay_.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement | HTMLSelectElement;
            this.handleInputChange(target);
        });

        // Escape key
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
                document.removeEventListener('keydown', keyHandler);
            }
        };
        document.addEventListener('keydown', keyHandler);
    }

    private handleAction(action: string | undefined, element: HTMLElement): void {
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

            case 'add-current-scene':
                if (config) {
                    const editor = (window as any).__esengine_editor;
                    const scenePath = editor?.currentScenePath;
                    if (scenePath && !config.scenes.includes(scenePath)) {
                        config.scenes.push(scenePath);
                        saveBuildSettings(this.settings_);
                        this.render();
                        this.setupEvents();
                    }
                }
                break;

            case 'remove-scene': {
                const index = parseInt(element.dataset.index ?? '-1', 10);
                if (config && index >= 0) {
                    config.scenes.splice(index, 1);
                    saveBuildSettings(this.settings_);
                    this.render();
                    this.setupEvents();
                }
                break;
            }

            case 'add-define': {
                const input = this.overlay_.querySelector('#new-define') as HTMLInputElement;
                const value = input?.value.trim();
                if (config && value && !config.defines.includes(value)) {
                    config.defines.push(value);
                    saveBuildSettings(this.settings_);
                    this.render();
                    this.setupEvents();
                }
                break;
            }

            case 'remove-define': {
                const index = parseInt(element.dataset.index ?? '-1', 10);
                if (config && index >= 0) {
                    config.defines.splice(index, 1);
                    saveBuildSettings(this.settings_);
                    this.render();
                    this.setupEvents();
                }
                break;
            }

            case 'build':
                if (config) {
                    this.handleBuild(config);
                }
                break;

            case 'switch-config':
                // Cycle to next config of same platform
                if (config) {
                    const platformConfigs = this.settings_.configs.filter(
                        c => c.platform === config.platform
                    );
                    const idx = platformConfigs.findIndex(c => c.id === config.id);
                    const nextIdx = (idx + 1) % platformConfigs.length;
                    this.settings_.activeConfigId = platformConfigs[nextIdx].id;
                    saveBuildSettings(this.settings_);
                    this.render();
                    this.setupEvents();
                }
                break;

            case 'browse-startup-scene':
                this.browseFile('playable-startup-scene', '场景文件', ['scene']);
                break;

            case 'browse-output':
                this.browseFile('playable-output', 'HTML文件', ['html']);
                break;
        }
    }

    private async browseFile(inputId: string, title: string, extensions: string[]): Promise<void> {
        const fs = (window as any).__esengine_fs;
        if (!fs?.showOpenDialog) return;

        const result = await fs.showOpenDialog({
            title: `选择${title}`,
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

        // Playable settings
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

        // WeChat settings
        if (config.wechatSettings) {
            if (id === 'wechat-appid') {
                config.wechatSettings.appId = target.value;
            } else if (id === 'wechat-version') {
                config.wechatSettings.version = target.value;
            } else if (id === 'wechat-bundle') {
                config.wechatSettings.bundleMode = target.value as 'subpackage' | 'single' | 'singleFile';
            } else if (id === 'wechat-output') {
                config.wechatSettings.outputDir = target.value;
            }
        }

        saveBuildSettings(this.settings_);
    }

    private showAddConfigDialog(): void {
        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';
        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 320px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">添加构建配置</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">配置名称</label>
                        <input type="text" class="es-dialog-input" id="config-name" placeholder="My Config">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">目标平台</label>
                        <select class="es-dialog-input" id="config-platform">
                            ${PLATFORMS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">取消</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="confirm">创建</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);

        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
            const nameInput = dialog.querySelector('#config-name') as HTMLInputElement;
            const platformSelect = dialog.querySelector('#config-platform') as HTMLSelectElement;
            const name = nameInput.value.trim() || 'New Config';
            const platform = platformSelect.value as BuildPlatform;

            const newConfig = createDefaultBuildConfig(platform, name);
            this.settings_.configs.push(newConfig);
            this.settings_.activeConfigId = newConfig.id;
            saveBuildSettings(this.settings_);

            close();
            this.render();
            this.setupEvents();
        });
    }

    private deleteConfig(configId: string): void {
        const idx = this.settings_.configs.findIndex(c => c.id === configId);
        if (idx >= 0) {
            this.settings_.configs.splice(idx, 1);
            if (this.settings_.activeConfigId === configId) {
                this.settings_.activeConfigId = this.settings_.configs[0]?.id ?? '';
            }
            saveBuildSettings(this.settings_);
            this.render();
            this.setupEvents();
        }
    }

    private async handleBuild(config: BuildConfig): Promise<void> {
        const buildBtn = this.overlay_.querySelector('[data-action="build"]') as HTMLButtonElement;
        const switchBtn = this.overlay_.querySelector('[data-action="switch-config"]') as HTMLButtonElement;

        // Disable buttons
        if (buildBtn) {
            buildBtn.disabled = true;
            buildBtn.innerHTML = `${icons.refresh(14)} 构建中...`;
        }
        if (switchBtn) {
            switchBtn.disabled = true;
        }

        // Show progress toast
        const platformName = this.getPlatformName(config.platform);
        const toastId = showProgressToast(
            `正在构建 ${config.name}`,
            `目标平台: ${platformName}`
        );

        try {
            const result = await this.options_.onBuild(config);

            dismissToast(toastId);

            if (result.success && result.outputPath) {
                // Show success toast with action to open folder
                showToast({
                    type: 'success',
                    title: '构建完成',
                    message: `输出: ${this.getFileName(result.outputPath)}`,
                    duration: 0,
                    actions: [
                        {
                            label: '打开文件夹',
                            primary: true,
                            onClick: () => this.openOutputFolder(result.outputPath!),
                        },
                        {
                            label: '关闭',
                            onClick: () => {},
                        },
                    ],
                });
            } else if (!result.success) {
                showToast({
                    type: 'error',
                    title: '构建失败',
                    message: result.error || '未知错误',
                    duration: 5000,
                });
            }
        } catch (err) {
            dismissToast(toastId);
            showToast({
                type: 'error',
                title: '构建失败',
                message: String(err),
                duration: 5000,
            });
        } finally {
            // Re-enable buttons
            if (buildBtn) {
                buildBtn.disabled = false;
                buildBtn.innerHTML = `${icons.play(14)} 构建`;
            }
            if (switchBtn) {
                switchBtn.disabled = false;
            }
        }
    }

    private getFileName(path: string): string {
        const parts = path.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || path;
    }

    private async openOutputFolder(outputPath: string): Promise<void> {
        try {
            // Get directory from output path
            const dirPath = outputPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

            // Use Tauri shell plugin to open folder
            const shell = (window as any).__TAURI__?.shell;
            if (shell?.open) {
                await shell.open(dirPath);
            } else {
                // Fallback: try using the fs adapter
                const fs = (window as any).__esengine_fs;
                if (fs?.openFolder) {
                    await fs.openFolder(dirPath);
                }
            }
        } catch (err) {
            console.error('Failed to open folder:', err);
        }
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private overlay_!: HTMLElement;
    private options_!: BuildSettingsDialogOptions;
    private settings_!: BuildSettings;
    private expandedSections_: Set<string> = new Set(['scenes', 'defines', 'platform']);
}

// =============================================================================
// Helper Function
// =============================================================================

export function showBuildSettingsDialog(options: BuildSettingsDialogOptions): BuildSettingsDialog {
    return new BuildSettingsDialog(options);
}
