/**
 * @file    BuildSettingsDialog.ts
 * @brief   Build settings dialog UI component with three-column layout
 */

import { icons } from '../utils/icons';
import {
    type BuildPlatform,
    type BuildConfig,
    type BuildSettings,
    type EngineModules,
    PLATFORMS,
    ENGINE_MODULE_INFO,
    createDefaultBuildConfig,
    createDefaultBuildSettings,
    createDefaultEngineModules,
} from '../types/BuildTypes';
import { getEditorContext } from '../context/EditorContext';
import { getEditorStore } from '../store';
import { type BuildResult, type BuildOptions } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { showProgressToast, dismissToast, showToast, showSuccessToast, showErrorToast, updateToast } from '../ui/Toast';
import { BuildHistory, formatBuildTime, formatBuildDuration, getBuildStatusIcon, type BuildHistoryEntry } from './BuildHistory';
import { BuildConfigService, initBuildConfigService } from './BuildConfigService';
import { downloadConfigsAsFile, uploadConfigsFromFile } from './BuildConfigIO';
import { BUILD_TEMPLATES, createConfigFromTemplate, getAllTemplates, configToTemplate, saveUserTemplate, type BuildTemplate, type UserTemplate } from './BuildTemplates';
import { BatchBuilder } from './BatchBuilder';
import { formatSize } from './BuildProgress';
import { discoverProjectScenes } from './SceneDiscovery';
import { createDefaultHook } from './BuildHooks';
import type { BuildHook, BuildHookPhase, BuildHookType, CopyFilesConfig, RunCommandConfig } from '../types/BuildTypes';
import { getDefaultTemplate, getTemplateRelPath, getTemplatePlaceholderDocs } from './templates';
import { joinPath, getParentDir } from '../utils/path';

// =============================================================================
// Types
// =============================================================================

export interface BuildSettingsDialogOptions {
    projectPath: string;
    onBuild: (config: BuildConfig, options?: BuildOptions) => Promise<BuildResult>;
    onClose: () => void;
}

// =============================================================================
// BuildSettingsDialog
// =============================================================================

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
        this.setupEvents();
        this.checkToolchainStatus();
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

        this.setupSceneDragAndDrop();
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
                    <button class="es-btn es-btn-icon" data-action="save-as-preset" title="Save as Preset">
                        ${icons.download(14)}
                    </button>
                </div>
            </div>
            <div class="es-build-detail-content">
                <div class="es-build-data-section">
                    ${this.renderScenesSection(config)}
                    ${this.renderDefinesSection(config)}
                    ${this.renderEngineModulesSection(config)}
                </div>
                <div class="es-build-settings-section">
                    ${this.renderToolchainSection()}
                    ${this.renderPlatformSettings(config)}
                    ${this.renderHooksSection(config)}
                </div>
            </div>
        `;
    }

    private renderHooksSection(config: BuildConfig): string {
        const isExpanded = this.expandedSections_.has('hooks');
        const hooks = config.hooks ?? [];

        const hooksHtml = hooks.length > 0
            ? hooks.map((h, i) => {
                const phaseLabel = h.phase === 'pre' ? 'Pre-Build' : 'Post-Build';
                const typeLabel = h.type === 'copy-files' ? 'Copy Files' : 'Run Command';
                let detail = '';
                if (h.type === 'copy-files') {
                    const c = h.config as CopyFilesConfig;
                    detail = `${c.from} → ${c.to}`;
                } else {
                    const c = h.config as RunCommandConfig;
                    detail = `${c.command} ${(c.args ?? []).join(' ')}`.trim();
                }
                return `
                    <div class="es-build-hook-item">
                        <span class="es-build-badge es-build-badge-small">${phaseLabel}</span>
                        <span class="es-build-hook-type">${typeLabel}</span>
                        <span class="es-build-hook-detail" title="${detail}">${detail || '(not configured)'}</span>
                        <button class="es-btn-icon" data-action="edit-hook" data-index="${i}" title="Edit">
                            ${icons.pencil(10)}
                        </button>
                        <button class="es-btn-icon" data-action="remove-hook" data-index="${i}" title="Remove">
                            ${icons.x(10)}
                        </button>
                    </div>
                `;
            }).join('')
            : '<div class="es-build-empty-list">No hooks configured</div>';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="hooks">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Build Hooks</span>
                    <span class="es-build-collapse-count">${hooks.length}</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-hooks-list">
                        ${hooksHtml}
                    </div>
                    <div class="es-build-hook-actions">
                        <button class="es-btn es-btn-link" data-action="add-hook" data-hook-type="copy-files" data-hook-phase="post">
                            ${icons.plus(12)} Add Copy Files Hook
                        </button>
                        <button class="es-btn es-btn-link" data-action="add-hook" data-hook-type="run-command" data-hook-phase="post">
                            ${icons.plus(12)} Add Run Command Hook
                        </button>
                    </div>
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
            ${this.renderOutputFiles(config.id)}
            ${historySection}
        `;
    }

    private renderOutputFiles(configId: string): string {
        const files = this.lastBuildOutputFiles_.get(configId);
        if (!files || files.length === 0) return '';

        const isExpanded = this.expandedSections_.has('output-files');
        const sorted = [...files].sort((a, b) => b.size - a.size);
        const totalSize = sorted.reduce((sum, f) => sum + f.size, 0);

        const fileItems = sorted.slice(0, 20).map(f => {
            const name = f.path.split('/').pop() ?? f.path;
            const dir = f.path.substring(0, f.path.length - name.length);
            return `
                <div class="es-build-file-item">
                    <span class="es-build-file-icon">${icons.file(10)}</span>
                    <span class="es-build-file-path" title="${f.path}">${dir ? `<span class="es-build-file-dir">${dir}</span>` : ''}${name}</span>
                    <span class="es-build-file-size">${formatSize(f.size)}</span>
                </div>
            `;
        }).join('');

        const moreCount = sorted.length - 20;

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="output-files">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Output Files</span>
                    <span class="es-build-collapse-count">${files.length} files (${formatSize(totalSize)})</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-file-list">
                        ${fileItems}
                        ${moreCount > 0 ? `<div class="es-build-file-more">and ${moreCount} more files...</div>` : ''}
                    </div>
                </div>
            </div>
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
        const firstScene = config.scenes[0];
        const scenesHtml = config.scenes.length > 0
            ? config.scenes.map((s, i) => `
                <div class="es-build-scene-item" draggable="true" data-scene-drag="${i}">
                    <span class="es-build-scene-drag-handle">${icons.grip(10)}</span>
                    ${i === 0 ? '<span class="es-build-badge es-build-badge-small">Startup</span>' : ''}
                    <span class="es-build-scene-path">${s}</span>
                    <button class="es-btn-icon" data-action="remove-scene" data-index="${i}">
                        ${icons.x(10)}
                    </button>
                </div>
            `).join('')
            : '<div class="es-build-empty-list">No scenes added. Use buttons below to add scenes.</div>';

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="scenes">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Scenes</span>
                    <span class="es-build-collapse-count">${config.scenes.length}</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-scene-list" data-scene-drop-zone>
                        ${scenesHtml}
                    </div>
                    <div class="es-build-scene-actions">
                        <button class="es-btn es-btn-link" data-action="add-current-scene">
                            ${icons.plus(12)} Add Current Scene
                        </button>
                        <button class="es-btn es-btn-link" data-action="add-all-scenes">
                            ${icons.plus(12)} Add All Scenes
                        </button>
                        <button class="es-btn es-btn-link" data-action="show-scene-picker">
                            ${icons.list(12)} Scene Picker
                        </button>
                        ${config.scenes.length > 0 ? `
                        <button class="es-btn es-btn-link es-btn-danger" data-action="remove-all-scenes">
                            ${icons.trash(12)} Remove All
                        </button>
                        ` : ''}
                    </div>
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
                <div class="es-build-field">
                    <label>
                        <input type="checkbox" id="playable-cta" ${s.enableBuiltinCTA ? 'checked' : ''}>
                        Enable Built-in CTA
                    </label>
                </div>
                ${s.enableBuiltinCTA ? `
                <div class="es-build-field">
                    <label class="es-build-label">CTA URL</label>
                    <input type="text" class="es-input" id="playable-cta-url"
                           value="${s.ctaUrl || ''}" placeholder="https://play.google.com/store/apps/...">
                </div>
                ` : ''}
                ${this.renderTemplateSection('playable', s.templatePath)}
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
                ${this.renderTemplateSection('wechat', s.templatePath)}
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

    private renderTemplateSection(platform: BuildPlatform, templatePath?: string): string {
        const defaultRelPath = getTemplateRelPath(platform);
        const placeholders = getTemplatePlaceholderDocs(platform);
        const sectionKey = `template-ref-${platform}`;
        const isRefExpanded = this.expandedSections_.has(sectionKey);
        const placeholderRows = placeholders.map(p =>
            `<tr><td style="font-family:monospace;white-space:nowrap;padding:2px 8px 2px 0">{{${p.key}}}</td><td style="padding:2px 0">${p.description}</td></tr>`
        ).join('');

        return `
            <div class="es-build-field" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
                <label class="es-build-label">Custom Template</label>
                <div class="es-build-path-row">
                    <input type="text" class="es-input" id="${platform}-template-path"
                           value="${templatePath || ''}" placeholder="${defaultRelPath}">
                </div>
                <div style="display:flex;gap:4px;margin-top:4px">
                    <button class="es-btn es-btn-small" data-action="export-template" data-platform="${platform}">Export Default</button>
                    <button class="es-btn es-btn-small" data-action="open-template" data-platform="${platform}">Open</button>
                    <button class="es-btn es-btn-small" data-action="reset-template" data-platform="${platform}">Reset</button>
                </div>
            </div>
            <div class="es-build-collapse ${isRefExpanded ? 'es-expanded' : ''}" data-section="${sectionKey}" style="margin-top:4px">
                <div class="es-build-collapse-header">
                    ${isRefExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Placeholders Reference</span>
                </div>
                <div style="display:${isRefExpanded ? 'block' : 'none'};padding:8px;font-size:11px" data-template-ref-content="${platform}">
                    <table style="width:100%">${placeholderRows}</table>
                </div>
            </div>
        `;
    }

    private renderEngineModulesSection(config: BuildConfig): string {
        const isExpanded = this.expandedSections_.has('engine-modules');
        const modules = config.engineModules ?? createDefaultEngineModules();
        const enabledCount = Object.values(modules).filter(Boolean).length;
        const totalCount = Object.keys(ENGINE_MODULE_INFO).length;

        const modulesHtml = (Object.entries(ENGINE_MODULE_INFO) as [keyof EngineModules, { name: string; description: string }][])
            .map(([key, info]) => `
                <div class="es-build-module-item">
                    <label>
                        <input type="checkbox" data-module="${key}" ${modules[key] ? 'checked' : ''}>
                        <span class="es-build-module-name">${info.name}</span>
                    </label>
                    <span class="es-build-module-desc">${info.description}</span>
                </div>
            `).join('');

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="engine-modules">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Engine Modules</span>
                    <span class="es-build-collapse-count">${enabledCount}/${totalCount}</span>
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-module-list">
                        <div class="es-build-module-item es-build-module-core">
                            <label>
                                <input type="checkbox" checked disabled>
                                <span class="es-build-module-name">Core</span>
                            </label>
                            <span class="es-build-module-desc">ECS, Renderer, Sprite, Text</span>
                        </div>
                        ${modulesHtml}
                    </div>
                </div>
            </div>
        `;
    }

    private renderToolchainSection(): string {
        const isExpanded = this.expandedSections_.has('toolchain');
        const s = this.toolchainStatus_;

        let statusBadge: string;
        let infoHtml: string;

        if (this.toolchainError_) {
            statusBadge = '';
            infoHtml = '<span class="es-build-module-desc">Not available in browser mode</span>';
        } else if (!s) {
            statusBadge = '';
            infoHtml = '<span class="es-build-module-desc">Detecting...</span>';
        } else if (s.installed) {
            statusBadge = '<span class="es-build-toolchain-badge es-ready">Ready</span>';
            infoHtml = this.renderToolchainRows(s);
        } else {
            statusBadge = '<span class="es-build-toolchain-badge es-not-ready">Not ready</span>';
            infoHtml = this.renderToolchainRows(s);
        }

        return `
            <div class="es-build-collapse ${isExpanded ? 'es-expanded' : ''}" data-section="toolchain">
                <div class="es-build-collapse-header">
                    ${isExpanded ? icons.chevronDown(12) : icons.chevronRight(12)}
                    <span>Toolchain (emsdk)</span>
                    ${statusBadge}
                </div>
                <div class="es-build-collapse-content">
                    <div class="es-build-toolchain-info">
                        ${infoHtml}
                    </div>
                    <div class="es-build-toolchain-actions">
                        <button class="es-btn" data-action="browse-emsdk">
                            ${icons.folder(12)} Select emsdk
                        </button>
                        <button class="es-btn" data-action="install-emsdk">
                            ${icons.download(12)} Auto Install
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    private renderToolchainRows(s: NonNullable<typeof this.toolchainStatus_>): string {
        const row = (label: string, value: string | null, ok: boolean, minVersion?: string, note?: string) => {
            const cls = ok ? '' : ' es-warning';
            let display = value ?? 'not found';
            if (value && !ok && minVersion) {
                display += ` (requires >= ${minVersion})`;
            }
            if (note) {
                display += ` <span class="es-build-module-desc">(${note})</span>`;
            }
            return `<div class="es-build-toolchain-row${cls}">${label}: ${display}</div>`;
        };
        const rows = [
            row('Emscripten', s.emscripten_version ?? (s.emsdk_path ? 'unknown' : null), s.emscripten_ok, '5.0.0'),
            row('CMake', s.cmake_version, s.cmake_ok, '3.16', s.cmake_ok ? 'bundled' : undefined),
            row('Python', s.python_version, s.python_ok, '3.0', s.python_ok ? 'from emsdk' : undefined),
        ];
        if (s.corrupted && s.missing_tools?.length) {
            rows.push(`<div class="es-build-toolchain-row es-build-row-error" style="color:var(--error-color,#e54);display:flex;align-items:center;gap:8px">
                <span>Missing ${s.missing_tools.join(', ')}</span>
                <button class="es-btn es-btn-xs" data-action="repair-toolchain" style="flex-shrink:0">${icons.download(12)} Repair</button>
            </div>`);
        }
        if (s.emsdk_path) {
            rows.push(`<div class="es-build-toolchain-row" style="opacity:0.6;font-size:0.85em;display:flex;align-items:center;gap:4px">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.emsdk_path}">Path: ${s.emsdk_path}</span>
                <button class="es-btn es-btn-xs" data-action="copy-emsdk-path" title="Copy path" style="flex-shrink:0;padding:1px 4px">${icons.copy(12)}</button>
                <button class="es-btn es-btn-xs" data-action="open-emsdk-folder" title="Open folder" style="flex-shrink:0;padding:1px 4px">${icons.folderOpen(12)}</button>
            </div>`);
        }
        return rows.join('');
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
                        collapse.classList.remove('es-expanded');
                    } else {
                        this.expandedSections_.add(section);
                        collapse.classList.add('es-expanded');
                    }
                    const expanded = this.expandedSections_.has(section);
                    const chevron = collapseHeader.querySelector('svg');
                    if (chevron) {
                        chevron.outerHTML = expanded ? icons.chevronDown(12) : icons.chevronRight(12);
                    }
                    const inlineContent = collapse.querySelector('[data-template-ref-content]') as HTMLElement;
                    if (inlineContent) {
                        inlineContent.style.display = expanded ? 'block' : 'none';
                    }
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

            case 'save-as-preset':
                if (config) {
                    this.showSavePresetDialog(config);
                }
                break;

            case 'add-current-scene':
                if (config) {
                    const scenePath = getEditorStore().filePath;
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

            case 'add-all-scenes':
                if (config) {
                    await this.addAllScenes(config);
                }
                break;

            case 'remove-all-scenes':
                if (config) {
                    config.scenes = [];
                    await this.saveSettings();
                    this.render();
                }
                break;

            case 'show-scene-picker':
                if (config) {
                    await this.showScenePicker(config);
                }
                break;

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

            case 'add-hook': {
                if (config) {
                    const hookType = element.dataset.hookType as BuildHookType;
                    const hookPhase = element.dataset.hookPhase as BuildHookPhase;
                    if (!config.hooks) config.hooks = [];
                    config.hooks.push(createDefaultHook(hookType, hookPhase));
                    await this.saveSettings();
                    this.render();
                }
                break;
            }

            case 'remove-hook': {
                const hookIdx = parseInt(element.dataset.index ?? '-1', 10);
                if (config && config.hooks && hookIdx >= 0) {
                    config.hooks.splice(hookIdx, 1);
                    await this.saveSettings();
                    this.render();
                }
                break;
            }

            case 'edit-hook': {
                const editIdx = parseInt(element.dataset.index ?? '-1', 10);
                if (config && config.hooks && editIdx >= 0) {
                    this.showEditHookDialog(config, editIdx);
                }
                break;
            }

            case 'build':
                if (config) {
                    const cleanCheckbox = this.overlay_.querySelector('[data-action="clean-build"]') as HTMLInputElement | null;
                    this.handleBuild(config, cleanCheckbox?.checked);
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

            case 'browse-emsdk':
                this.handleBrowseEmsdk();
                break;

            case 'install-emsdk':
                this.handleInstallEmsdk();
                break;

            case 'repair-toolchain':
                this.handleRepairToolchain();
                break;

            case 'copy-emsdk-path':
                if (this.toolchainStatus_?.emsdk_path) {
                    navigator.clipboard.writeText(this.toolchainStatus_.emsdk_path);
                    showSuccessToast('Path copied');
                }
                break;

            case 'open-emsdk-folder':
                if (this.toolchainStatus_?.emsdk_path) {
                    const fs = getEditorContext().fs;
                    fs?.openFolder(this.toolchainStatus_.emsdk_path);
                }
                break;

            case 'export-template': {
                const platform = element.dataset.platform as BuildPlatform;
                if (platform) {
                    await this.handleExportTemplate(platform);
                }
                break;
            }

            case 'open-template': {
                const platform = element.dataset.platform as BuildPlatform;
                if (platform && config) {
                    await this.handleOpenTemplate(platform, config);
                }
                break;
            }

            case 'reset-template': {
                const platform = element.dataset.platform as BuildPlatform;
                if (platform && config) {
                    await this.handleResetTemplate(platform, config);
                }
                break;
            }
        }
    }

    private async browseFile(inputId: string, title: string, extensions: string[]): Promise<void> {
        const fs = getEditorContext().fs;
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
            } else if (id === 'playable-cta') {
                config.playableSettings.enableBuiltinCTA = (target as HTMLInputElement).checked;
                this.render();
            } else if (id === 'playable-cta-url') {
                config.playableSettings.ctaUrl = target.value;
            } else if (id === 'playable-template-path') {
                config.playableSettings.templatePath = target.value || undefined;
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
            } else if (id === 'wechat-template-path') {
                config.wechatSettings.templatePath = target.value || undefined;
            }
        }

        // Engine module checkboxes
        const moduleKey = (target as HTMLElement).dataset?.module as keyof EngineModules | undefined;
        if (moduleKey && moduleKey in ENGINE_MODULE_INFO) {
            if (!config.engineModules) {
                config.engineModules = createDefaultEngineModules();
            }
            config.engineModules[moduleKey] = (target as HTMLInputElement).checked;
        }

        this.saveSettings();
    }

    private async checkToolchainStatus(): Promise<void> {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            this.toolchainStatus_ = await invoke('get_toolchain_status');
            this.toolchainError_ = false;
        } catch {
            this.toolchainStatus_ = null;
            this.toolchainError_ = true;
        }
        this.updateToolchainUI();
    }

    private updateToolchainUI(): void {
        const section = this.overlay_?.querySelector('[data-section="toolchain"]');
        if (!section) return;

        const s = this.toolchainStatus_;
        const header = section.querySelector('.es-build-collapse-header');
        const badgeEl = section.querySelector('.es-build-toolchain-badge');
        const infoEl = section.querySelector('.es-build-toolchain-info');

        if (this.toolchainError_) {
            if (badgeEl) badgeEl.remove();
            if (infoEl) infoEl.innerHTML = '<span class="es-build-module-desc">Not available in browser mode</span>';
            return;
        }

        if (!s) {
            if (infoEl) infoEl.innerHTML = '<span class="es-build-module-desc">Detecting...</span>';
            return;
        }

        const badgeClass = s.installed ? 'es-ready' : 'es-not-ready';
        const badgeText = s.installed ? 'Ready' : 'Not ready';

        if (badgeEl) {
            badgeEl.className = `es-build-toolchain-badge ${badgeClass}`;
            badgeEl.textContent = badgeText;
        } else if (header) {
            header.insertAdjacentHTML('beforeend', `<span class="es-build-toolchain-badge ${badgeClass}">${badgeText}</span>`);
        }

        if (infoEl) {
            infoEl.innerHTML = this.renderToolchainRows(s);
        }

        this.updateBuildButtonState();
    }

    private updateBuildButtonState(): void {
        const ready = !!this.toolchainStatus_?.installed;
        const buildBtn = this.overlay_?.querySelector('[data-action="build"]') as HTMLButtonElement | null;
        const buildAllBtn = this.overlay_?.querySelector('[data-action="build-all"]') as HTMLButtonElement | null;
        if (buildBtn) {
            buildBtn.disabled = !ready;
            buildBtn.title = ready ? '' : 'Toolchain not ready';
        }
        if (buildAllBtn) {
            buildAllBtn.disabled = !ready;
            buildAllBtn.title = ready ? 'Build All Configs' : 'Toolchain not ready';
        }
    }

    private async handleBrowseEmsdk(): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const selected = await fs.selectDirectory();
        if (!selected) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('set_emsdk_path', { path: selected });
            showSuccessToast('emsdk path set');
            await this.checkToolchainStatus();
        } catch (err: any) {
            showErrorToast(err.toString());
        }
    }

    private async handleInstallEmsdk(): Promise<void> {
        const toastId = showProgressToast('Downloading toolchain...');
        let unlisten: (() => void) | undefined;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            unlisten = await listen<{ stage: string; message: string; progress: number }>('compile-progress', (event) => {
                updateToast(toastId, {
                    message: event.payload.message,
                    progress: event.payload.progress,
                });
            });
            await invoke('install_emsdk');
            dismissToast(toastId);
            showSuccessToast('Toolchain installed');
            await this.checkToolchainStatus();
        } catch (err: any) {
            dismissToast(toastId);
            showErrorToast(`Install failed: ${err}`);
        } finally {
            unlisten?.();
        }
    }

    private async handleRepairToolchain(): Promise<void> {
        const toastId = showProgressToast('Repairing toolchain...');
        let unlisten: (() => void) | undefined;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            unlisten = await listen<{ stage: string; message: string; progress: number }>('compile-progress', (event) => {
                updateToast(toastId, {
                    message: event.payload.message,
                    progress: event.payload.progress,
                });
            });
            await invoke('repair_toolchain');
            dismissToast(toastId);
            showSuccessToast('Toolchain repaired');
            await this.checkToolchainStatus();
        } catch (err: any) {
            dismissToast(toastId);
            showErrorToast(`Repair failed: ${err}`);
        } finally {
            unlisten?.();
        }
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

    private async showTemplatesDialog(): Promise<void> {
        const fs = getEditorContext().fs;
        const projectDir = this.getProjectDir();
        const allTemplates = fs
            ? await getAllTemplates(fs, projectDir)
            : BUILD_TEMPLATES;

        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';

        const builtinHtml = allTemplates
            .filter(t => !(t as UserTemplate).isUserDefined)
            .map(t => `
                <div class="es-build-template-item" data-template="${t.id}">
                    <div class="es-build-template-header">
                        <span class="es-build-template-name">${t.name}</span>
                        <span class="es-build-template-platform">${t.platform}</span>
                    </div>
                    <div class="es-build-template-desc">${t.description}</div>
                </div>
            `).join('');

        const userTemplates = allTemplates.filter(t => (t as UserTemplate).isUserDefined);
        const userHtml = userTemplates.length > 0
            ? `<div class="es-build-section-title" style="margin-top: 12px;">Custom Presets</div>` +
              userTemplates.map(t => `
                <div class="es-build-template-item" data-template="${t.id}">
                    <div class="es-build-template-header">
                        <span class="es-build-template-name">${t.name}</span>
                        <span class="es-build-template-platform">${t.platform}</span>
                    </div>
                    <div class="es-build-template-desc">${t.description}</div>
                </div>
              `).join('')
            : '';

        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 400px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Build Templates</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body" style="max-height: 450px; overflow-y: auto;">
                    <div class="es-build-section-title">Built-in</div>
                    <div class="es-build-templates-list">
                        ${builtinHtml}
                        ${userHtml}
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
                const template = allTemplates.find(t => t.id === templateId);
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

    private showSavePresetDialog(config: BuildConfig): void {
        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';
        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 360px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Save as Preset</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Preset Name</label>
                        <input type="text" class="es-dialog-input" id="preset-name" value="${config.name}" placeholder="My Preset">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Description</label>
                        <input type="text" class="es-dialog-input" id="preset-desc" placeholder="Brief description...">
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="save">Save</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);
        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
            const name = (dialog.querySelector('#preset-name') as HTMLInputElement).value.trim() || config.name;
            const description = (dialog.querySelector('#preset-desc') as HTMLInputElement).value.trim() || '';
            const fs = getEditorContext().fs;
            if (fs) {
                const template = configToTemplate(config, name, description);
                await saveUserTemplate(fs, this.getProjectDir(), template);
                showToast({ type: 'success', title: 'Preset Saved', message: `Saved "${name}"`, duration: 3000 });
            }
            close();
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

    private async handleBuild(config: BuildConfig, cleanBuild?: boolean): Promise<void> {
        if (!this.toolchainStatus_?.installed) {
            showErrorToast('Toolchain not ready. Building requires emsdk, CMake and Python.');
            return;
        }

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

        const progress = new BuildProgressReporter();
        progress.onProgress((p) => {
            const task = p.currentTask || p.phase;
            updateToast(toastId, {
                message: task,
                progress: p.overallProgress,
            });
        });

        try {
            const result = await this.options_.onBuild(config, { progress, cleanBuild });

            dismissToast(toastId);

            if (result.success && result.outputPath) {
                if (result.outputFiles) {
                    this.lastBuildOutputFiles_.set(config.id, result.outputFiles);
                }
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
            const fs = getEditorContext().fs;
            if (fs) {
                await fs.openFolder(dirPath);
            }
        } catch (err) {
            console.error('Failed to open folder:', err);
        }
    }

    private async previewOutput(outputPath: string): Promise<void> {
        try {
            const fs = getEditorContext().fs;
            if (fs?.openFile) {
                await fs.openFile(outputPath);
            }
        } catch (err) {
            console.error('Failed to preview output:', err);
        }
    }

    // =========================================================================
    // Template Management
    // =========================================================================

    private async handleExportTemplate(platform: BuildPlatform): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.getProjectDir();
        const relPath = getTemplateRelPath(platform);
        const absPath = joinPath(projectDir, relPath);

        if (await fs.exists(absPath)) {
            showToast({ title: `Template already exists: ${relPath}`, type: 'info' });
            return;
        }

        await fs.createDirectory(getParentDir(absPath));
        const ok = await fs.writeFile(absPath, getDefaultTemplate(platform));
        if (ok) {
            showSuccessToast(`Exported to ${relPath}`);
        } else {
            showErrorToast('Failed to export template');
        }
    }

    private async handleOpenTemplate(platform: BuildPlatform, config: BuildConfig): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.getProjectDir();
        const customPath = platform === 'playable'
            ? config.playableSettings?.templatePath
            : config.wechatSettings?.templatePath;
        const relPath = customPath || getTemplateRelPath(platform);
        const absPath = joinPath(projectDir, relPath);

        if (!await fs.exists(absPath)) {
            showToast({ title: `Template not found: ${relPath}. Export it first.`, type: 'info' });
            return;
        }

        await fs.openFolder(getParentDir(absPath));
    }

    private async handleResetTemplate(platform: BuildPlatform, config: BuildConfig): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.getProjectDir();
        const absPath = joinPath(projectDir, getTemplateRelPath(platform));

        await fs.removeFile(absPath);

        if (platform === 'playable' && config.playableSettings) {
            config.playableSettings.templatePath = undefined;
        } else if (platform === 'wechat' && config.wechatSettings) {
            config.wechatSettings.templatePath = undefined;
        }

        await this.saveSettings();
        this.render();
        showSuccessToast('Template reset to default');
    }

    // =========================================================================
    // Scene Management
    // =========================================================================

    private async addAllScenes(config: BuildConfig): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.getProjectDir();
        const allScenes = await discoverProjectScenes(fs, projectDir);

        let added = 0;
        for (const scene of allScenes) {
            if (!config.scenes.includes(scene)) {
                config.scenes.push(scene);
                added++;
            }
        }

        if (added > 0) {
            await this.saveSettings();
            this.render();
            showToast({ type: 'info', title: 'Scenes Added', message: `Added ${added} scene(s)`, duration: 2000 });
        } else if (allScenes.length === 0) {
            showToast({ type: 'info', title: 'No Scenes Found', message: 'No .esscene files found in assets/', duration: 3000 });
        } else {
            showToast({ type: 'info', title: 'No New Scenes', message: 'All scenes already added', duration: 2000 });
        }
    }

    private async showScenePicker(config: BuildConfig): Promise<void> {
        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.getProjectDir();
        const allScenes = await discoverProjectScenes(fs, projectDir);

        if (allScenes.length === 0) {
            showToast({ type: 'info', title: 'No Scenes Found', message: 'No .esscene files found in assets/', duration: 3000 });
            return;
        }

        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';

        const scenesHtml = allScenes.map(s => {
            const isAdded = config.scenes.includes(s);
            return `
                <label class="es-build-scene-picker-item ${isAdded ? 'es-active' : ''}">
                    <input type="checkbox" data-scene-path="${s}" ${isAdded ? 'checked' : ''}>
                    <span>${s}</span>
                </label>
            `;
        }).join('');

        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 480px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Scene Picker</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body" style="max-height: 400px; overflow-y: auto;">
                    <div class="es-build-scene-picker-list">
                        ${scenesHtml}
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="apply">Apply</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);

        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.querySelector('[data-action="apply"]')?.addEventListener('click', async () => {
            const checkboxes = dialog.querySelectorAll('input[data-scene-path]') as NodeListOf<HTMLInputElement>;
            const selected: string[] = [];
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    selected.push(cb.dataset.scenePath!);
                }
            });

            const existingOrder = config.scenes.filter(s => selected.includes(s));
            const newScenes = selected.filter(s => !existingOrder.includes(s));
            config.scenes = [...existingOrder, ...newScenes];

            await this.saveSettings();
            close();
            this.render();
        });
    }

    private showEditHookDialog(config: BuildConfig, index: number): void {
        const hook = config.hooks![index];
        const dialog = document.createElement('div');
        dialog.className = 'es-build-add-dialog';

        const isCopy = hook.type === 'copy-files';
        const copyConfig = isCopy ? hook.config as CopyFilesConfig : null;
        const cmdConfig = !isCopy ? hook.config as RunCommandConfig : null;

        dialog.innerHTML = `
            <div class="es-dialog" style="max-width: 420px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Edit ${isCopy ? 'Copy Files' : 'Run Command'} Hook</span>
                    <button class="es-dialog-close" data-action="cancel">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Phase</label>
                        <select class="es-dialog-input" id="hook-phase">
                            <option value="pre" ${hook.phase === 'pre' ? 'selected' : ''}>Pre-Build</option>
                            <option value="post" ${hook.phase === 'post' ? 'selected' : ''}>Post-Build</option>
                        </select>
                    </div>
                    ${isCopy ? `
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">From Path</label>
                        <input type="text" class="es-dialog-input" id="hook-from" value="${copyConfig?.from ?? ''}" placeholder="\${outputDir}">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">To Path</label>
                        <input type="text" class="es-dialog-input" id="hook-to" value="${copyConfig?.to ?? ''}" placeholder="/path/to/dest">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Pattern (optional)</label>
                        <input type="text" class="es-dialog-input" id="hook-pattern" value="${copyConfig?.pattern ?? ''}" placeholder="*.png">
                    </div>
                    ` : `
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Command</label>
                        <input type="text" class="es-dialog-input" id="hook-command" value="${cmdConfig?.command ?? ''}" placeholder="echo">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Arguments (space-separated)</label>
                        <input type="text" class="es-dialog-input" id="hook-args" value="${(cmdConfig?.args ?? []).join(' ')}" placeholder="arg1 arg2">
                    </div>
                    `}
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="save">Save</button>
                </div>
            </div>
        `;

        this.overlay_.appendChild(dialog);
        const close = () => dialog.remove();

        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
        dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
            const phase = (dialog.querySelector('#hook-phase') as HTMLSelectElement).value as BuildHookPhase;
            hook.phase = phase;

            if (isCopy) {
                const from = (dialog.querySelector('#hook-from') as HTMLInputElement).value;
                const to = (dialog.querySelector('#hook-to') as HTMLInputElement).value;
                const pattern = (dialog.querySelector('#hook-pattern') as HTMLInputElement).value;
                hook.config = { from, to, ...(pattern ? { pattern } : {}) } as CopyFilesConfig;
            } else {
                const command = (dialog.querySelector('#hook-command') as HTMLInputElement).value;
                const argsStr = (dialog.querySelector('#hook-args') as HTMLInputElement).value.trim();
                const args = argsStr ? argsStr.split(/\s+/) : [];
                hook.config = { command, args } as RunCommandConfig;
            }

            await this.saveSettings();
            close();
            this.render();
        });
    }

    private setupSceneDragAndDrop(): void {
        const dropZone = this.overlay_?.querySelector('[data-scene-drop-zone]');
        if (!dropZone) return;

        const items = dropZone.querySelectorAll('[data-scene-drag]');
        items.forEach(item => {
            const el = item as HTMLElement;
            el.addEventListener('dragstart', (e: DragEvent) => {
                this.dragSourceIndex_ = parseInt(el.dataset.sceneDrag ?? '-1', 10);
                el.classList.add('es-dragging');
                e.dataTransfer!.effectAllowed = 'move';
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('es-dragging');
                this.dragSourceIndex_ = -1;
            });
            el.addEventListener('dragover', (e: DragEvent) => {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'move';
                el.classList.add('es-drag-over');
            });
            el.addEventListener('dragleave', () => {
                el.classList.remove('es-drag-over');
            });
            el.addEventListener('drop', async (e: DragEvent) => {
                e.preventDefault();
                el.classList.remove('es-drag-over');
                const targetIndex = parseInt(el.dataset.sceneDrag ?? '-1', 10);
                if (this.dragSourceIndex_ >= 0 && targetIndex >= 0 && this.dragSourceIndex_ !== targetIndex) {
                    const config = this.getActiveConfig();
                    if (config) {
                        const [moved] = config.scenes.splice(this.dragSourceIndex_, 1);
                        config.scenes.splice(targetIndex, 0, moved);
                        await this.saveSettings();
                        this.render();
                    }
                }
            });
        });
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
    private expandedSections_: Set<string> = new Set(['scenes', 'defines', 'platform', 'engine-modules']);
    private keyHandler_: ((e: KeyboardEvent) => void) | null = null;
    private dragSourceIndex_ = -1;
    private lastBuildOutputFiles_: Map<string, Array<{ path: string; size: number }>> = new Map();
    private toolchainStatus_: {
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
    } | null = null;
    private toolchainError_ = false;
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
