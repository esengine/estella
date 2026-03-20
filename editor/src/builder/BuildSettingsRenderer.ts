import { icons } from '../utils/icons';
import {
    type BuildPlatform,
    type BuildConfig,
    type BuildSettings,
    type EngineModules,
    PLATFORMS,
    ENGINE_MODULE_INFO,
    createDefaultEngineModules,
} from '../types/BuildTypes';
import type { CopyFilesConfig, RunCommandConfig } from '../types/BuildTypes';
import { formatSize } from './BuildProgress';
import { formatBuildTime, formatBuildDuration, getBuildStatusIcon, type BuildHistoryEntry } from './BuildHistory';
import { getTemplateRelPath, getTemplatePlaceholderDocs } from './templates';
import type { BuildSettingsRenderContext } from './BuildSettingsDialog';

export function renderSidebar(ctx: BuildSettingsRenderContext): string {
    const platformsHtml = PLATFORMS.map(p => {
        const isActive = ctx.settings.activePlatform === p.id;
        const configs = ctx.settings.configs.filter(c => c.platform === p.id);

        return `
            <div class="es-build-platform ${isActive ? 'es-active' : ''}" data-platform="${p.id}">
                <div class="es-build-platform-header">
                    ${icons[p.icon as keyof typeof icons](14)}
                    <span>${p.name}</span>
                    ${isActive ? '<span class="es-build-badge">Active</span>' : ''}
                </div>
            </div>
            ${configs.map(c => renderConfigItem(ctx, c)).join('')}
        `;
    }).join('');

    return `
        <div class="es-build-section-title">Platforms</div>
        ${platformsHtml}
    `;
}

export function renderConfigItem(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isActive = ctx.settings.activeConfigId === config.id;
    const latestBuild = ctx.history.getLatest(config.id);
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

export function renderNoConfig(): string {
    return `
        <div class="es-build-empty">
            <p>No build config selected</p>
            <p>Select a config from the left or create a new one</p>
        </div>
    `;
}

export function renderDetail(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    return `
        <div class="es-build-detail-header">
            <div class="es-build-detail-title">
                <input type="text" class="es-build-name-input" id="config-name-input"
                       value="${config.name}" placeholder="Config Name">
                <span class="es-build-detail-platform">${getPlatformName(config.platform)}</span>
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
                ${renderScenesSection(ctx, config)}
                ${renderDefinesSection(ctx, config)}
                ${renderEngineModulesSection(ctx, config)}
            </div>
            <div class="es-build-settings-section">
                ${renderToolchainSection(ctx)}
                ${renderPlatformSettings(ctx, config)}
                ${renderHooksSection(ctx, config)}
            </div>
        </div>
    `;
}

export function renderScenesSection(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isExpanded = ctx.expandedSections.has('scenes');
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

export function renderDefinesSection(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isExpanded = ctx.expandedSections.has('defines');
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

export function renderEngineModulesSection(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isExpanded = ctx.expandedSections.has('engine-modules');
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

export function renderPlatformSettings(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isExpanded = ctx.expandedSections.has('platform');

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
            ${renderTemplateSection(ctx, 'playable', s.templatePath)}
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
            ${renderTemplateSection(ctx, 'wechat', s.templatePath)}
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

export function renderTemplateSection(ctx: BuildSettingsRenderContext, platform: BuildPlatform, templatePath?: string): string {
    const defaultRelPath = getTemplateRelPath(platform);
    const placeholders = getTemplatePlaceholderDocs(platform);
    const sectionKey = `template-ref-${platform}`;
    const isRefExpanded = ctx.expandedSections.has(sectionKey);
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

export function renderHooksSection(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const isExpanded = ctx.expandedSections.has('hooks');
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

export function renderOutputPanel(ctx: BuildSettingsRenderContext, config: BuildConfig): string {
    const latestBuild = ctx.history.getLatest(config.id);
    const recentBuilds = ctx.history.getEntries(config.id).slice(0, 5);

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
                ${recentBuilds.map(entry => renderHistoryEntry(entry)).join('')}
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
        ${renderOutputFiles(ctx, config.id)}
        ${historySection}
    `;
}

export function renderOutputFiles(ctx: BuildSettingsRenderContext, configId: string): string {
    const files = ctx.lastBuildOutputFiles.get(configId);
    if (!files || files.length === 0) return '';

    const isExpanded = ctx.expandedSections.has('output-files');
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

export function renderHistoryEntry(entry: BuildHistoryEntry): string {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    return `
        <div class="es-build-history-item es-build-status-${entry.status}">
            <span class="es-build-history-icon">${getBuildStatusIcon(entry.status)}</span>
            <span class="es-build-history-time">${time}</span>
            <span class="es-build-history-duration">${formatBuildDuration(entry.duration)}</span>
        </div>
    `;
}

export function renderToolchainSection(ctx: BuildSettingsRenderContext): string {
    const isExpanded = ctx.expandedSections.has('toolchain');
    const s = ctx.toolchainStatus;

    let statusBadge: string;
    let infoHtml: string;

    if (ctx.toolchainError) {
        statusBadge = '';
        infoHtml = '<span class="es-build-module-desc">Not available in browser mode</span>';
    } else if (!s) {
        statusBadge = '';
        infoHtml = '<span class="es-build-module-desc">Detecting...</span>';
    } else if (s.installed) {
        statusBadge = '<span class="es-build-toolchain-badge es-ready">Ready</span>';
        infoHtml = renderToolchainRows(s);
    } else {
        statusBadge = '<span class="es-build-toolchain-badge es-not-ready">Not ready</span>';
        infoHtml = renderToolchainRows(s);
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

export function renderToolchainRows(s: NonNullable<BuildSettingsRenderContext['toolchainStatus']>): string {
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

function getPlatformName(platform: BuildPlatform): string {
    return PLATFORMS.find(p => p.id === platform)?.name ?? platform;
}
