import { icons } from '../utils/icons';
import {
    type BuildPlatform,
    type BuildConfig,
    type EngineModules,
    PLATFORMS,
    ENGINE_MODULE_INFO,
    createDefaultBuildConfig,
    createDefaultEngineModules,
} from '../types/BuildTypes';
import type { BuildHookPhase, BuildHookType, CopyFilesConfig, RunCommandConfig } from '../types/BuildTypes';
import { getEditorContext } from '../context/EditorContext';
import { getEditorStore } from '../store';
import type { BuildOptions } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { showProgressToast, dismissToast, showToast, showSuccessToast, showErrorToast, updateToast } from '../ui/Toast';
import { downloadConfigsAsFile, uploadConfigsFromFile } from './BuildConfigIO';
import { BUILD_TEMPLATES, createConfigFromTemplate, getAllTemplates, configToTemplate, saveUserTemplate, type UserTemplate } from './BuildTemplates';
import { createDefaultHook } from './BuildHooks';
import { discoverProjectScenes } from './SceneDiscovery';
import { getDefaultTemplate, getTemplateRelPath } from './templates';
import { joinPath, getParentDir } from '../utils/path';
import type { BuildSettingsActionContext } from './BuildSettingsDialog';

export function setupEvents(ctx: BuildSettingsActionContext): void {
    if (!ctx.overlay) return;

    ctx.overlay.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        if (target.closest('[data-action="close"]')) {
            ctx.close();
            return;
        }

        const platformEl = target.closest('.es-build-platform') as HTMLElement;
        if (platformEl) {
            const platform = platformEl.dataset.platform as BuildPlatform;
            ctx.settings.activePlatform = platform;
            const firstConfig = ctx.settings.configs.find(c => c.platform === platform);
            if (firstConfig) {
                ctx.settings.activeConfigId = firstConfig.id;
            }
            ctx.render();
            return;
        }

        const configEl = target.closest('.es-build-config-item') as HTMLElement;
        if (configEl && !target.closest('[data-action="delete-config"]')) {
            const configId = configEl.dataset.config;
            if (configId) {
                ctx.settings.activeConfigId = configId;
                ctx.render();
            }
            return;
        }

        const collapseHeader = target.closest('.es-build-collapse-header') as HTMLElement;
        if (collapseHeader) {
            const collapse = collapseHeader.closest('.es-build-collapse') as HTMLElement;
            const section = collapse?.dataset.section;
            if (section) {
                if (ctx.expandedSections.has(section)) {
                    ctx.expandedSections.delete(section);
                    collapse.classList.remove('es-expanded');
                } else {
                    ctx.expandedSections.add(section);
                    collapse.classList.add('es-expanded');
                }
                const expanded = ctx.expandedSections.has(section);
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
            handleAction(ctx, action, actionEl);
        }
    });

    ctx.overlay.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        handleInputChange(ctx, target);
    });

    ctx.overlay.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.id === 'config-name-input') {
            const config = ctx.getActiveConfig();
            if (config) {
                config.name = target.value;
                ctx.saveSettings();
            }
        }
    });

    ctx.keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            ctx.close();
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
            e.preventDefault();
            const config = ctx.getActiveConfig();
            if (config) {
                handleBuild(ctx, config);
            }
        }

        if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
            e.preventDefault();
            const config = ctx.getActiveConfig();
            if (config) {
                duplicateConfig(ctx, config);
            }
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
                const config = ctx.getActiveConfig();
                if (config) {
                    deleteConfig(ctx, config.id);
                }
            }
        }
    };
    document.addEventListener('keydown', ctx.keyHandler);
}

export async function handleAction(ctx: BuildSettingsActionContext, action: string | undefined, element: HTMLElement): Promise<void> {
    const config = ctx.getActiveConfig();

    switch (action) {
        case 'add-config':
            showAddConfigDialog(ctx);
            break;

        case 'delete-config': {
            const configId = element.dataset.config;
            if (configId) {
                deleteConfig(ctx, configId);
            }
            break;
        }

        case 'duplicate-config':
            if (config) {
                duplicateConfig(ctx, config);
            }
            break;

        case 'save-as-preset':
            if (config) {
                showSavePresetDialog(ctx, config);
            }
            break;

        case 'add-current-scene':
            if (config) {
                const scenePath = getEditorStore().filePath;
                if (scenePath) {
                    const relativePath = toRelativePath(ctx, scenePath);
                    if (!config.scenes.includes(relativePath)) {
                        config.scenes.push(relativePath);
                        await ctx.saveSettings();
                        ctx.render();
                    }
                }
            }
            break;

        case 'remove-scene': {
            const index = parseInt(element.dataset.index ?? '-1', 10);
            if (config && index >= 0) {
                config.scenes.splice(index, 1);
                await ctx.saveSettings();
                ctx.render();
            }
            break;
        }

        case 'add-all-scenes':
            if (config) {
                await addAllScenes(ctx, config);
            }
            break;

        case 'remove-all-scenes':
            if (config) {
                config.scenes = [];
                await ctx.saveSettings();
                ctx.render();
            }
            break;

        case 'show-scene-picker':
            if (config) {
                await showScenePicker(ctx, config);
            }
            break;

        case 'add-define': {
            const input = ctx.overlay.querySelector('#new-define') as HTMLInputElement;
            const value = input?.value.trim();
            if (config && value && !config.defines.includes(value)) {
                config.defines.push(value);
                await ctx.saveSettings();
                ctx.render();
            }
            break;
        }

        case 'remove-define': {
            const index = parseInt(element.dataset.index ?? '-1', 10);
            if (config && index >= 0) {
                config.defines.splice(index, 1);
                await ctx.saveSettings();
                ctx.render();
            }
            break;
        }

        case 'add-hook': {
            if (config) {
                const hookType = element.dataset.hookType as BuildHookType;
                const hookPhase = element.dataset.hookPhase as BuildHookPhase;
                if (!config.hooks) config.hooks = [];
                config.hooks.push(createDefaultHook(hookType, hookPhase));
                await ctx.saveSettings();
                ctx.render();
            }
            break;
        }

        case 'remove-hook': {
            const hookIdx = parseInt(element.dataset.index ?? '-1', 10);
            if (config && config.hooks && hookIdx >= 0) {
                config.hooks.splice(hookIdx, 1);
                await ctx.saveSettings();
                ctx.render();
            }
            break;
        }

        case 'edit-hook': {
            const editIdx = parseInt(element.dataset.index ?? '-1', 10);
            if (config && config.hooks && editIdx >= 0) {
                showEditHookDialog(ctx, config, editIdx);
            }
            break;
        }

        case 'build':
            if (config) {
                const cleanCheckbox = ctx.overlay.querySelector('[data-action="clean-build"]') as HTMLInputElement | null;
                handleBuild(ctx, config, cleanCheckbox?.checked);
            }
            break;

        case 'build-all':
            handleBuildAll(ctx);
            break;

        case 'import-configs':
            handleImportConfigs(ctx);
            break;

        case 'export-configs':
            downloadConfigsAsFile(ctx.settings.configs);
            break;

        case 'show-templates':
            showTemplatesDialog(ctx);
            break;

        case 'open-output': {
            const path = element.dataset.path;
            if (path) {
                openOutputFolder(path);
            }
            break;
        }

        case 'preview-output': {
            const path = element.dataset.path;
            if (path) {
                previewOutput(path);
            }
            break;
        }

        case 'clear-history':
            if (config) {
                ctx.history.clearHistory(config.id);
                await ctx.history.save();
                ctx.render();
            }
            break;

        case 'browse-startup-scene':
            browseFile(ctx, 'playable-startup-scene', 'Scene File', ['scene']);
            break;

        case 'browse-output':
            browseFile(ctx, 'playable-output', 'HTML File', ['html']);
            break;

        case 'browse-emsdk':
            ctx.handleBrowseEmsdk();
            break;

        case 'install-emsdk':
            ctx.handleInstallEmsdk();
            break;

        case 'repair-toolchain':
            ctx.handleRepairToolchain();
            break;

        case 'copy-emsdk-path':
            if (ctx.toolchainStatus?.emsdk_path) {
                navigator.clipboard.writeText(ctx.toolchainStatus.emsdk_path);
                showSuccessToast('Path copied');
            }
            break;

        case 'open-emsdk-folder':
            if (ctx.toolchainStatus?.emsdk_path) {
                const fs = getEditorContext().fs;
                fs?.openFolder(ctx.toolchainStatus.emsdk_path);
            }
            break;

        case 'export-template': {
            const platform = element.dataset.platform as BuildPlatform;
            if (platform) {
                await handleExportTemplate(ctx, platform);
            }
            break;
        }

        case 'open-template': {
            const platform = element.dataset.platform as BuildPlatform;
            if (platform && config) {
                await handleOpenTemplate(ctx, platform, config);
            }
            break;
        }

        case 'reset-template': {
            const platform = element.dataset.platform as BuildPlatform;
            if (platform && config) {
                await handleResetTemplate(ctx, platform, config);
            }
            break;
        }
    }
}

export function handleInputChange(ctx: BuildSettingsActionContext, target: HTMLInputElement | HTMLSelectElement): void {
    const config = ctx.getActiveConfig();
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
            ctx.render();
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

    const moduleKey = (target as HTMLElement).dataset?.module as keyof EngineModules | undefined;
    if (moduleKey && moduleKey in ENGINE_MODULE_INFO) {
        if (!config.engineModules) {
            config.engineModules = createDefaultEngineModules();
        }
        config.engineModules[moduleKey] = (target as HTMLInputElement).checked;
    }

    ctx.saveSettings();
}

async function browseFile(ctx: BuildSettingsActionContext, inputId: string, title: string, extensions: string[]): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs?.showOpenDialog) return;

    const result = await fs.showOpenDialog({
        title: `Select ${title}`,
        filters: [{ name: title, extensions }],
    });

    if (result && result.length > 0) {
        const input = ctx.overlay.querySelector(`#${inputId}`) as HTMLInputElement;
        if (input) {
            input.value = result[0];
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
}

export async function handleBuild(ctx: BuildSettingsActionContext, config: BuildConfig, cleanBuild?: boolean): Promise<void> {
    if (!ctx.toolchainStatus?.installed) {
        showErrorToast('Toolchain not ready. Building requires emsdk, CMake and Python.');
        return;
    }

    const buildBtn = ctx.overlay.querySelector('[data-action="build"]') as HTMLButtonElement;
    const buildAllBtn = ctx.overlay.querySelector('[data-action="build-all"]') as HTMLButtonElement;

    if (buildBtn) {
        buildBtn.disabled = true;
        buildBtn.innerHTML = `${icons.refresh(14)} Building...`;
    }
    if (buildAllBtn) {
        buildAllBtn.disabled = true;
    }

    const platformName = getPlatformName(config.platform);
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
        const result = await ctx.onBuild(config, { progress, cleanBuild });

        dismissToast(toastId);

        if (result.success && result.outputPath) {
            if (result.outputFiles) {
                ctx.lastBuildOutputFiles.set(config.id, result.outputFiles);
            }
            ctx.history.addEntry({
                configId: config.id,
                configName: config.name,
                platform: config.platform,
                timestamp: Date.now(),
                duration: result.duration || 0,
                status: 'success',
                outputPath: result.outputPath,
                outputSize: result.outputSize,
            });
            await ctx.history.save();

            showToast({
                type: 'success',
                title: 'Build Completed',
                message: `Output: ${getFileName(result.outputPath)}`,
                duration: 0,
                actions: [
                    {
                        label: 'Open Folder',
                        primary: true,
                        onClick: () => openOutputFolder(result.outputPath!),
                    },
                    {
                        label: 'Close',
                        onClick: () => {},
                    },
                ],
            });
        } else if (!result.success) {
            ctx.history.addEntry({
                configId: config.id,
                configName: config.name,
                platform: config.platform,
                timestamp: Date.now(),
                duration: result.duration || 0,
                status: 'failed',
                error: result.error,
            });
            await ctx.history.save();

            showToast({
                type: 'error',
                title: 'Build Failed',
                message: result.error || 'Unknown error',
                duration: 5000,
            });
        }

        ctx.render();
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

export async function handleBuildAll(ctx: BuildSettingsActionContext): Promise<void> {
    const buildBtn = ctx.overlay.querySelector('[data-action="build"]') as HTMLButtonElement;
    const buildAllBtn = ctx.overlay.querySelector('[data-action="build-all"]') as HTMLButtonElement;

    if (buildBtn) buildBtn.disabled = true;
    if (buildAllBtn) {
        buildAllBtn.disabled = true;
        buildAllBtn.textContent = 'Building...';
    }

    const toastId = showProgressToast(
        'Building All Configs',
        `0 / ${ctx.settings.configs.length} completed`
    );

    try {
        const result = await ctx.batchBuilder.buildAll(ctx.settings.configs);

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

        ctx.render();
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

function showAddConfigDialog(ctx: BuildSettingsActionContext): void {
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

    ctx.overlay.appendChild(dialog);

    const close = () => dialog.remove();

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
        const nameInput = dialog.querySelector('#config-name') as HTMLInputElement;
        const platformSelect = dialog.querySelector('#config-platform') as HTMLSelectElement;
        const name = nameInput.value.trim() || 'New Config';
        const platform = platformSelect.value as BuildPlatform;

        const newConfig = createDefaultBuildConfig(platform, name);
        ctx.settings.configs.push(newConfig);
        ctx.settings.activeConfigId = newConfig.id;
        await ctx.saveSettings();

        close();
        ctx.render();
    });
}

async function showTemplatesDialog(ctx: BuildSettingsActionContext): Promise<void> {
    const fs = getEditorContext().fs;
    const projectDir = ctx.getProjectDir();
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

    ctx.overlay.appendChild(dialog);

    const close = () => dialog.remove();

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);

    dialog.querySelectorAll('.es-build-template-item').forEach(item => {
        item.addEventListener('click', async () => {
            const templateId = (item as HTMLElement).dataset.template;
            const template = allTemplates.find(t => t.id === templateId);
            if (template) {
                const newConfig = createConfigFromTemplate(template);
                ctx.settings.configs.push(newConfig);
                ctx.settings.activeConfigId = newConfig.id;
                await ctx.saveSettings();
                close();
                ctx.render();
            }
        });
    });
}

function showSavePresetDialog(ctx: BuildSettingsActionContext, config: BuildConfig): void {
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

    ctx.overlay.appendChild(dialog);
    const close = () => dialog.remove();

    dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    dialog.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
        const name = (dialog.querySelector('#preset-name') as HTMLInputElement).value.trim() || config.name;
        const description = (dialog.querySelector('#preset-desc') as HTMLInputElement).value.trim() || '';
        const fs = getEditorContext().fs;
        if (fs) {
            const template = configToTemplate(config, name, description);
            await saveUserTemplate(fs, ctx.getProjectDir(), template);
            showToast({ type: 'success', title: 'Preset Saved', message: `Saved "${name}"`, duration: 3000 });
        }
        close();
    });
}

async function handleImportConfigs(ctx: BuildSettingsActionContext): Promise<void> {
    const result = await uploadConfigsFromFile();

    if (result.success && result.configs.length > 0) {
        for (const config of result.configs) {
            ctx.settings.configs.push(config);
        }
        await ctx.saveSettings();
        ctx.render();

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

function duplicateConfig(ctx: BuildSettingsActionContext, config: BuildConfig): void {
    const newConfig: BuildConfig = {
        ...JSON.parse(JSON.stringify(config)),
        id: `${config.platform}-${Date.now()}`,
        name: `${config.name} (Copy)`,
    };

    ctx.settings.configs.push(newConfig);
    ctx.settings.activeConfigId = newConfig.id;
    ctx.saveSettings();
    ctx.render();
}

function deleteConfig(ctx: BuildSettingsActionContext, configId: string): void {
    const idx = ctx.settings.configs.findIndex(c => c.id === configId);
    if (idx >= 0) {
        ctx.settings.configs.splice(idx, 1);
        if (ctx.settings.activeConfigId === configId) {
            ctx.settings.activeConfigId = ctx.settings.configs[0]?.id ?? '';
        }
        ctx.saveSettings();
        ctx.render();
    }
}

async function addAllScenes(ctx: BuildSettingsActionContext, config: BuildConfig): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const projectDir = ctx.getProjectDir();
    const allScenes = await discoverProjectScenes(fs, projectDir);

    let added = 0;
    for (const scene of allScenes) {
        if (!config.scenes.includes(scene)) {
            config.scenes.push(scene);
            added++;
        }
    }

    if (added > 0) {
        await ctx.saveSettings();
        ctx.render();
        showToast({ type: 'info', title: 'Scenes Added', message: `Added ${added} scene(s)`, duration: 2000 });
    } else if (allScenes.length === 0) {
        showToast({ type: 'info', title: 'No Scenes Found', message: 'No .esscene files found in assets/', duration: 3000 });
    } else {
        showToast({ type: 'info', title: 'No New Scenes', message: 'All scenes already added', duration: 2000 });
    }
}

async function showScenePicker(ctx: BuildSettingsActionContext, config: BuildConfig): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const projectDir = ctx.getProjectDir();
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

    ctx.overlay.appendChild(dialog);

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

        await ctx.saveSettings();
        close();
        ctx.render();
    });
}

export function showEditHookDialog(ctx: BuildSettingsActionContext, config: BuildConfig, index: number): void {
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

    ctx.overlay.appendChild(dialog);
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

        await ctx.saveSettings();
        close();
        ctx.render();
    });
}

export function setupSceneDragAndDrop(ctx: BuildSettingsActionContext): void {
    const dropZone = ctx.overlay?.querySelector('[data-scene-drop-zone]');
    if (!dropZone) return;

    const items = dropZone.querySelectorAll('[data-scene-drag]');
    items.forEach(item => {
        const el = item as HTMLElement;
        el.addEventListener('dragstart', (e: DragEvent) => {
            ctx.dragSourceIndex = parseInt(el.dataset.sceneDrag ?? '-1', 10);
            el.classList.add('es-dragging');
            e.dataTransfer!.effectAllowed = 'move';
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('es-dragging');
            ctx.dragSourceIndex = -1;
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
            if (ctx.dragSourceIndex >= 0 && targetIndex >= 0 && ctx.dragSourceIndex !== targetIndex) {
                const config = ctx.getActiveConfig();
                if (config) {
                    const [moved] = config.scenes.splice(ctx.dragSourceIndex, 1);
                    config.scenes.splice(targetIndex, 0, moved);
                    await ctx.saveSettings();
                    ctx.render();
                }
            }
        });
    });
}

async function handleExportTemplate(ctx: BuildSettingsActionContext, platform: BuildPlatform): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const projectDir = ctx.getProjectDir();
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

async function handleOpenTemplate(ctx: BuildSettingsActionContext, platform: BuildPlatform, config: BuildConfig): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const projectDir = ctx.getProjectDir();
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

async function handleResetTemplate(ctx: BuildSettingsActionContext, platform: BuildPlatform, config: BuildConfig): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const projectDir = ctx.getProjectDir();
    const absPath = joinPath(projectDir, getTemplateRelPath(platform));

    await fs.removeFile(absPath);

    if (platform === 'playable' && config.playableSettings) {
        config.playableSettings.templatePath = undefined;
    } else if (platform === 'wechat' && config.wechatSettings) {
        config.wechatSettings.templatePath = undefined;
    }

    await ctx.saveSettings();
    ctx.render();
    showSuccessToast('Template reset to default');
}

function toRelativePath(ctx: BuildSettingsActionContext, absolutePath: string): string {
    const normalized = absolutePath.replace(/\\/g, '/');
    const projectDir = ctx.getProjectDir();
    if (normalized.startsWith(projectDir)) {
        return normalized.substring(projectDir.length + 1);
    }
    return normalized;
}

function getFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || path;
}

async function openOutputFolder(outputPath: string): Promise<void> {
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

async function previewOutput(outputPath: string): Promise<void> {
    try {
        const fs = getEditorContext().fs;
        if (fs?.openFile) {
            await fs.openFile(outputPath);
        }
    } catch (err) {
        console.error('Failed to preview output:', err);
    }
}

function getPlatformName(platform: BuildPlatform): string {
    return PLATFORMS.find(p => p.id === platform)?.name ?? platform;
}
