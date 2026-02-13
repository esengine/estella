/**
 * @file    Editor.ts
 * @brief   Main editor component
 */

import type { App, Entity } from 'esengine';
import * as esengine from 'esengine';
import {
    Draw, Geometry, Material, BlendMode, DataType, ShaderSources,
    PostProcess, Renderer, RenderStage,
    registerDrawCallback, unregisterDrawCallback, clearDrawCallbacks,
} from 'esengine';
import { EditorStore } from './store/EditorStore';
import { EditorBridge } from './bridge/EditorBridge';
import type { PanelInstance, PanelPosition } from './panels/PanelRegistry';
import {
    registerPanel,
    getAllPanels,
    getPanelsByPosition,
    isResizable,
    isBridgeAware,
    isAppAware,
    isAssetServerProvider,
    isAssetNavigable,
    isOutputAppendable,
    isSpineControllerAware,
    isSpineInfoProvider,
    lockBuiltinPanels,
    clearExtensionPanels,
    isBuiltinPanel,
} from './panels/PanelRegistry';
import { SpineModuleController, wrapSpineModule, type SpineWasmModule } from 'esengine/spine';
import { registerBuiltinPanels } from './panels/builtinPanels';
import { registerBuiltinEditors } from './property/editors';
import { registerMaterialEditors } from './property/materialEditors';
import { lockBuiltinPropertyEditors, clearExtensionPropertyEditors } from './property/PropertyEditor';
import { registerBuiltinSchemas, lockBuiltinComponentSchemas, clearExtensionComponentSchemas } from './schemas/ComponentSchemas';
import { initBoundsProviders, registerBoundsProvider, lockBuiltinBoundsProviders, clearExtensionBoundsProviders } from './bounds';
import { saveSceneToFile, saveSceneToPath, loadSceneFromFile, loadSceneFromPath, hasFileHandle, clearFileHandle } from './io/SceneSerializer';
import { icons } from './utils/icons';
import { ScriptLoader } from './scripting';
import { PreviewService } from './preview';
import { showBuildSettingsDialog, BuildService } from './builder';
import { getGlobalPathResolver } from './asset';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { getAssetLibrary } from './asset/AssetLibrary';
import { setEditorInstance, getEditorContext, getEditorInstance } from './context/EditorContext';
import { getAllMenus, getMenuItems, getAllStatusbarItems, registerBuiltinMenus } from './menus';
import { ShortcutManager } from './menus/ShortcutManager';
import { registerBuiltinGizmos, registerGizmo, lockBuiltinGizmos, clearExtensionGizmos } from './gizmos';
import { registerBuiltinStatusbarItems } from './menus/builtinStatusbar';
import { ExtensionLoader } from './extension';
import { setEditorAPI, clearEditorAPI } from './extension/editorAPI';
import { registerMenu, registerMenuItem, registerStatusbarItem, lockBuiltinMenus, clearExtensionMenus } from './menus/MenuRegistry';
import { registerPropertyEditor } from './property';
import { registerComponentSchema } from './schemas';
import { showToast, showSuccessToast, showErrorToast } from './ui/Toast';
import { showContextMenu } from './ui/ContextMenu';
import { showConfirmDialog, showInputDialog } from './ui/dialog';
import { getEditorStore } from './store';
import { generateUniqueName } from './utils/naming';
import {
    registerBuiltinSettings,
    lockBuiltinSettings,
    clearExtensionSettings,
    showSettingsDialog,
    registerSettingsSection,
    registerSettingsItem,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
} from './settings';
import { loadProjectConfig } from './launcher/ProjectService';
import type { SpineVersion } from './types/ProjectTypes';

// =============================================================================
// Types
// =============================================================================

export interface EditorOptions {
    projectPath?: string;
}

// =============================================================================
// Editor
// =============================================================================

export class Editor {
    private container_: HTMLElement;
    private app_: App | null = null;
    private spineModule_: unknown = null;
    private spineVersion_: string = 'none';
    private spineVersionChangeHandler_: ((version: string) => void) | null = null;
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;
    private projectPath_: string | null = null;

    private panelInstances_ = new Map<string, PanelInstance>();
    private statusbarInstances_: Array<{ dispose(): void; update?(): void }> = [];
    private baseAPI_: Record<string, unknown> | null = null;
    private scriptLoader_: ScriptLoader | null = null;
    private extensionLoader_: ExtensionLoader | null = null;
    private previewService_: PreviewService | null = null;
    private shortcutManager_: ShortcutManager;
    private activeBottomPanelId_: string | null = 'content-browser';

    constructor(container: HTMLElement, options?: EditorOptions) {
        this.container_ = container;
        this.store_ = new EditorStore();
        this.projectPath_ = options?.projectPath ?? null;
        this.shortcutManager_ = new ShortcutManager();

        registerBuiltinEditors();
        registerMaterialEditors();
        registerBuiltinSchemas();
        initBoundsProviders();
        registerBuiltinGizmos();
        registerBuiltinSettings();

        registerBuiltinPanels({
            projectPath: this.projectPath_ ?? undefined,
            onOpenScene: (scenePath) => this.openSceneFromPath(scenePath),
        });
        registerBuiltinMenus(this);
        lockBuiltinPanels();
        lockBuiltinMenus();
        lockBuiltinGizmos();
        lockBuiltinPropertyEditors();
        lockBuiltinComponentSchemas();
        lockBuiltinBoundsProviders();
        lockBuiltinSettings();

        this.setupLayout();

        registerBuiltinStatusbarItems(this);
        this.instantiateStatusbar();
        this.setupMenuShortcuts();
        this.shortcutManager_.attach();

        if (this.projectPath_) {
            this.setupEditorGlobals();
            this.initializeAssetLibrary();
            this.initializeAllScripts();
            this.syncProjectSettings();
            this.previewService_ = new PreviewService({ projectPath: this.projectPath_ });
        }
    }

    get projectPath(): string | null {
        return this.projectPath_;
    }

    get currentScenePath(): string | null {
        return this.store_.filePath;
    }

    get activeBottomPanelId(): string | null {
        return this.activeBottomPanelId_;
    }

    setApp(app: App): void {
        this.app_ = app;
        this.bridge_ = new EditorBridge(app, this.store_);

        for (const panel of this.panelInstances_.values()) {
            if (isBridgeAware(panel)) panel.setBridge(this.bridge_);
            if (isAppAware(panel)) panel.setApp(app);
        }
    }

    setSpineModule(module: unknown, version: string): void {
        this.spineModule_ = module;
        this.spineVersion_ = version;

        const raw = module as SpineWasmModule;
        const controller = module ? new SpineModuleController(raw, wrapSpineModule(raw)) : null;
        for (const panel of this.panelInstances_.values()) {
            if (isSpineControllerAware(panel)) {
                panel.setSpineController(controller);
            }
        }

        this.store_.notifyChange();
    }

    onSpineVersionChange(handler: (version: string) => void): void {
        this.spineVersionChangeHandler_ = handler;
    }

    get spineModule(): unknown {
        return this.spineModule_;
    }

    get spineVersion(): string {
        return this.spineVersion_;
    }

    get store(): EditorStore {
        return this.store_;
    }

    get assetServer(): EditorAssetServer | null {
        for (const panel of this.panelInstances_.values()) {
            if (isAssetServerProvider(panel)) return panel.assetServer as EditorAssetServer;
        }
        return null;
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        for (const panel of this.panelInstances_.values()) {
            if (isSpineInfoProvider(panel)) {
                return panel.getSpineSkeletonInfo(entityId);
            }
        }
        return null;
    }

    // =========================================================================
    // Panel Operations
    // =========================================================================

    showPanel(id: string): void {
        this.panelInstances_.get(id)?.onShow?.();
    }

    hidePanel(id: string): void {
        this.panelInstances_.get(id)?.onHide?.();
    }

    togglePanel(id: string): void {
        const panel = this.panelInstances_.get(id);
        if (!panel) return;
        panel.onShow?.();
    }

    toggleBottomPanel(id: string): void {
        const prev = this.activeBottomPanelId_;
        if (prev === id) {
            this.activeBottomPanelId_ = null;
        } else {
            this.activeBottomPanelId_ = id;
        }
        this.updateBottomPanelVisibility();
        if (prev && prev !== id) {
            this.panelInstances_.get(prev)?.onHide?.();
        }
        if (this.activeBottomPanelId_) {
            this.panelInstances_.get(this.activeBottomPanelId_)?.onShow?.();
        }
    }

    // =========================================================================
    // Scene Operations
    // =========================================================================

    newScene(): void {
        const w = getSettingsValue<number>('project.designWidth');
        const h = getSettingsValue<number>('project.designHeight');
        this.store_.newScene('Untitled', { width: w, height: h });
        clearFileHandle();
    }

    async saveScene(): Promise<void> {
        const filePath = this.store_.filePath;

        if (filePath && hasFileHandle()) {
            const success = await saveSceneToPath(this.store_.scene, filePath);
            if (success) {
                this.store_.markSaved();
                return;
            }
        }

        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
        }
    }

    async saveSceneAs(): Promise<void> {
        clearFileHandle();
        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
        }
    }

    async loadScene(): Promise<void> {
        const scene = await loadSceneFromFile();
        if (scene) {
            await getAssetLibrary().migrateScene(scene);
            this.store_.loadScene(scene);
        }
    }

    async openSceneFromPath(scenePath: string): Promise<void> {
        const scene = await loadSceneFromPath(scenePath);
        if (scene) {
            const migrated = await getAssetLibrary().migrateScene(scene);
            if (migrated) {
                await saveSceneToPath(scene, scenePath);
            }
            this.store_.loadScene(scene, scenePath);
            console.log('Scene loaded:', scenePath);
        }
    }

    duplicateSelected(): void {
        const entity = this.store_.selectedEntity;
        if (entity === null) return;

        const entityData = this.store_.getEntityData(entity as number);
        if (!entityData) return;

        const scene = this.store_.scene;
        const siblings = scene.entities
            .filter(e => e.parent === entityData.parent)
            .map(e => e.name);
        const siblingNames = new Set(siblings);
        const newName = generateUniqueName(entityData.name, siblingNames);

        const newEntity = this.store_.createEntity(
            newName,
            entityData.parent as Entity | null
        );

        for (const comp of entityData.components) {
            this.store_.addComponent(newEntity, comp.type, { ...comp.data });
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
            onBuild: async (config) => {
                return await buildService.build(config);
            },
            onClose: () => {},
        });
    }

    showAboutDialog(): void {
        const hasUpdater = !!getEditorContext().onCheckUpdate;
        const overlay = document.createElement('div');
        overlay.className = 'es-dialog-overlay';
        overlay.innerHTML = `
            <div class="es-dialog" style="max-width: 360px;">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">About ESEngine</span>
                    <button class="es-dialog-close">&times;</button>
                </div>
                <div class="es-dialog-body" style="text-align: center; padding: 24px;">
                    <div style="margin-bottom: 16px;">${icons.logo(64)}</div>
                    <h3 style="margin: 0 0 8px; color: var(--es-text-primary);">ESEngine Editor</h3>
                    <p style="margin: 0 0 16px; color: var(--es-text-secondary);">Version ${getEditorContext().version ?? '0.0.0'}</p>
                    <p style="margin: 0; font-size: 12px; color: var(--es-text-secondary);">
                        A lightweight 2D game engine<br>for web and mini-programs.
                    </p>
                </div>
                <div class="es-dialog-footer" style="justify-content: center; gap: 8px;">
                    ${hasUpdater ? '<button class="es-dialog-btn" id="about-check-update">Check for Updates</button>' : ''}
                    <button class="es-dialog-btn es-dialog-btn-primary">OK</button>
                </div>
            </div>
        `;

        const close = () => overlay.remove();
        overlay.querySelector('.es-dialog-close')?.addEventListener('click', close);
        overlay.querySelector('.es-dialog-btn-primary')?.addEventListener('click', close);
        overlay.querySelector('#about-check-update')?.addEventListener('click', () => {
            close();
            getEditorContext().onCheckUpdate?.();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        document.body.appendChild(overlay);
    }

    private async syncProjectSettings(): Promise<void> {
        if (!this.projectPath_) return;
        const config = await loadProjectConfig(this.projectPath_);
        if (config) {
            setSettingsValue('project.name', config.name);
            setSettingsValue('project.version', config.version);
            setSettingsValue('project.defaultScene', config.defaultScene);
            setSettingsValue('project.spineVersion', config.spineVersion ?? 'none');
            setSettingsValue('project.enablePhysics', config.enablePhysics ?? false);
            setSettingsValue('physics.gravityX', config.physicsGravityX ?? 0);
            setSettingsValue('physics.gravityY', config.physicsGravityY ?? -9.81);
            setSettingsValue('physics.fixedTimestep', config.physicsFixedTimestep ?? 1 / 60);
            setSettingsValue('physics.subStepCount', config.physicsSubStepCount ?? 4);
            const resolution = config.designResolution ?? { width: 1920, height: 1080 };
            setSettingsValue('project.designWidth', resolution.width);
            setSettingsValue('project.designHeight', resolution.height);
        }

        const projectPath = this.projectPath_;
        onSettingsChange((id, value) => {
            if (id.startsWith('project.') || id.startsWith('physics.')) {
                this.saveProjectField(projectPath);
                if (id === 'project.spineVersion') {
                    this.spineVersionChangeHandler_?.(value as string);
                }
            }
        });
    }

    private async saveProjectField(projectPath: string): Promise<void> {
        const config = await loadProjectConfig(projectPath);
        if (!config) return;
        config.name = getSettingsValue<string>('project.name') || config.name;
        config.version = getSettingsValue<string>('project.version') || config.version;
        config.defaultScene = getSettingsValue<string>('project.defaultScene') || config.defaultScene;
        config.spineVersion = getSettingsValue<string>('project.spineVersion') as SpineVersion;
        config.enablePhysics = getSettingsValue<boolean>('project.enablePhysics') ?? false;
        config.physicsGravityX = getSettingsValue<number>('physics.gravityX') ?? 0;
        config.physicsGravityY = getSettingsValue<number>('physics.gravityY') ?? -9.81;
        config.physicsFixedTimestep = getSettingsValue<number>('physics.fixedTimestep') ?? 1 / 60;
        config.physicsSubStepCount = getSettingsValue<number>('physics.subStepCount') ?? 4;
        config.designResolution = {
            width: getSettingsValue<number>('project.designWidth') || 1920,
            height: getSettingsValue<number>('project.designHeight') || 1080,
        };
        config.modified = new Date().toISOString();
        const fs = getEditorContext().fs;
        if (fs) {
            await fs.writeFile(projectPath, JSON.stringify(config, null, 2));
        }
    }

    showSettings(): void {
        showSettingsDialog();
    }

    // =========================================================================
    // Script Operations
    // =========================================================================

    private async initializeAssetLibrary(): Promise<void> {
        if (!this.projectPath_) return;

        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');
        try {
            await getAssetLibrary().initialize(projectDir, fs);
        } catch (err) {
            console.error('Failed to initialize AssetLibrary:', err);
        }
    }

    private async initializeAllScripts(): Promise<void> {
        await this.initializeExtensions();
        await this.initializeScripts();
    }

    private async initializeScripts(): Promise<void> {
        if (!this.projectPath_) return;

        this.scriptLoader_ = new ScriptLoader({
            projectPath: this.projectPath_,
            onCompileError: (errors) => {
                console.error('Script compilation errors:', errors);
                const msg = errors.map(e => `${e.file}:${e.line} - ${e.message}`).join('\n');
                showErrorToast('Script compile failed', msg);
                for (const e of errors) {
                    this.appendOutput(`${e.file}:${e.line}:${e.column} - ${e.message}`, 'error');
                }
            },
            onCompileSuccess: () => {
                this.store_.notifyChange();
            },
        });

        try {
            await this.scriptLoader_.initialize();
            await this.scriptLoader_.compile();
            await this.scriptLoader_.watch();
        } catch (err) {
            console.error('Failed to initialize scripts:', err);
        }
    }

    async reloadScripts(): Promise<boolean> {
        if (!this.scriptLoader_) {
            if (this.projectPath_) {
                await this.initializeScripts();
                return true;
            }
            return false;
        }
        return this.scriptLoader_.reload();
    }

    // =========================================================================
    // Extension Operations
    // =========================================================================

    private setupEditorGlobals(): void {
        this.baseAPI_ = {
            ...esengine,
            registerPanel,
            registerMenuItem,
            registerMenu,
            registerGizmo,
            registerStatusbarItem,
            registerPropertyEditor,
            registerComponentSchema,
            registerBoundsProvider,
            icons,
            showToast,
            showSuccessToast,
            showErrorToast,
            showContextMenu,
            showConfirmDialog,
            showInputDialog,
            getEditorInstance,
            getEditorStore,
            Draw,
            Geometry,
            Material,
            BlendMode,
            DataType,
            ShaderSources,
            PostProcess,
            Renderer,
            RenderStage,
            registerDrawCallback,
            unregisterDrawCallback,
            clearDrawCallbacks,
            registerSettingsSection,
            registerSettingsItem,
            getSettingsValue,
            setSettingsValue,
        };
        setEditorAPI(this.baseAPI_);
    }

    private async initializeExtensions(): Promise<void> {
        if (!this.projectPath_ || !this.baseAPI_) return;

        this.extensionLoader_ = new ExtensionLoader({
            projectPath: this.projectPath_,
            baseAPI: this.baseAPI_,
            onCompileError: (errors) => {
                console.error('Extension compilation errors:', errors);
                const msg = errors.map(e => `${e.file}:${e.line} - ${e.message}`).join('\n');
                showErrorToast(`Extension compile failed:\n${msg}`);
            },
            onCompileSuccess: () => {},
            onCleanup: () => this.cleanupExtensionUI(),
            onAfterReload: () => this.applyExtensionUI(),
        });

        try {
            await this.extensionLoader_.initialize();
            await this.extensionLoader_.reload();
            await this.extensionLoader_.watch();
        } catch (err) {
            console.error('Failed to initialize extensions:', err);
        }
    }

    private cleanupExtensionUI(): void {
        for (const [id, instance] of this.panelInstances_) {
            if (isBuiltinPanel(id)) continue;
            instance.dispose();
            this.panelInstances_.delete(id);
            this.container_.querySelector(`[data-panel-id="${id}"]`)?.remove();
        }

        this.container_.querySelectorAll('[data-statusbar-id^="toggle-"]').forEach(el => {
            const panelId = el.getAttribute('data-statusbar-id')?.replace('toggle-', '');
            if (panelId && !isBuiltinPanel(panelId)) el.remove();
        });

        clearExtensionPanels();
        clearExtensionMenus();
        clearExtensionGizmos();
        clearExtensionPropertyEditors();
        clearExtensionComponentSchemas();
        clearExtensionBoundsProviders();
        clearExtensionSettings();
    }

    private applyExtensionUI(): void {
        this.instantiateExtensionPanels();
        this.addExtensionBottomPanelToggles();
        this.rebuildMenuBar();
    }

    private addExtensionBottomPanelToggles(): void {
        const leftContainer = this.container_.querySelector('.es-statusbar-left');
        if (!leftContainer) return;

        for (const panel of getPanelsByPosition('bottom')) {
            if (leftContainer.querySelector(`[data-statusbar-id="toggle-${panel.id}"]`)) continue;

            const item = {
                id: `toggle-${panel.id}`,
                position: 'left' as const,
                render: (container: HTMLElement) => {
                    const btn = document.createElement('button');
                    btn.className = 'es-statusbar-btn';
                    btn.dataset.bottomPanel = panel.id;
                    btn.innerHTML = `${panel.icon ?? ''}<span>${panel.title}</span>`;
                    btn.addEventListener('click', () => this.toggleBottomPanel(panel.id));
                    container.appendChild(btn);
                    return {
                        dispose() { btn.remove(); },
                        update: () => {
                            btn.classList.toggle('es-active', this.activeBottomPanelId_ === panel.id);
                        },
                    };
                },
            };

            const span = document.createElement('span');
            span.dataset.statusbarId = item.id;

            const cmdInputItem = leftContainer.querySelector('[data-statusbar-id="cmd-input"]');
            if (cmdInputItem) {
                leftContainer.insertBefore(span, cmdInputItem);
            } else {
                leftContainer.appendChild(span);
            }

            const instance = item.render(span);
            this.statusbarInstances_.push(instance);
        }
    }

    private instantiateExtensionPanels(): void {
        for (const desc of getAllPanels()) {
            if (this.panelInstances_.has(desc.id)) continue;

            const position = desc.position ?? 'bottom';
            let parentEl: HTMLElement | null = null;

            if (position === 'bottom') {
                parentEl = this.container_.querySelector('.es-editor-bottom');
            } else {
                parentEl = this.container_.querySelector(`.es-editor-${position}`);
            }
            if (!parentEl) continue;

            const container = document.createElement('div');
            container.className = 'es-panel-container';
            container.dataset.panelId = desc.id;

            if (position === 'bottom') {
                container.style.display = 'none';
            }

            parentEl.appendChild(container);
            const instance = desc.factory(container, this.store_);
            this.panelInstances_.set(desc.id, instance);

            if (this.bridge_ && isBridgeAware(instance)) instance.setBridge(this.bridge_);
            if (this.app_ && isAppAware(instance)) instance.setApp(this.app_);
        }
    }

    private rebuildMenuBar(): void {
        const menubar = this.container_.querySelector('.es-editor-menubar');
        if (!menubar) return;

        menubar.querySelectorAll('.es-menu').forEach(el => el.remove());

        const spacer = menubar.querySelector('.es-menubar-spacer');
        if (!spacer) return;

        const fragment = document.createRange().createContextualFragment(this.buildMenuBarHTML());
        menubar.insertBefore(fragment, spacer);

        this.attachMenuTriggers();
    }

    private attachMenuTriggers(): void {
        const menubar = this.container_.querySelector('.es-editor-menubar');
        if (!menubar) return;

        menubar.querySelectorAll('.es-menu-trigger').forEach(trigger => {
            if ((trigger as any).__menuBound) return;
            (trigger as any).__menuBound = true;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = (trigger as HTMLElement).parentElement!;
                const isOpen = menu.classList.contains('es-open');
                menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
                if (!isOpen) {
                    menu.classList.add('es-open');
                }
            });

            trigger.addEventListener('mouseenter', () => {
                const hasOpen = menubar.querySelector('.es-menu.es-open');
                if (hasOpen && hasOpen !== trigger.parentElement) {
                    menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
                    const menu = (trigger as HTMLElement).parentElement!;
                    menu.classList.add('es-open');
                }
            });
        });
    }

    async reloadExtensions(): Promise<boolean> {
        if (!this.extensionLoader_) {
            if (this.projectPath_) {
                await this.initializeExtensions();
                return true;
            }
            return false;
        }

        return this.extensionLoader_.reload();
    }

    // =========================================================================
    // Preview Operations
    // =========================================================================

    async startPreview(): Promise<void> {
        if (!this.previewService_) {
            console.warn('Preview not available: no project loaded');
            return;
        }

        try {
            if (this.scriptLoader_) {
                await this.scriptLoader_.compile();
            }
            const compiledScript = this.scriptLoader_?.getCompiledCode() ?? undefined;
            const enablePhysics = getSettingsValue<boolean>('project.enablePhysics') ?? false;
            const physicsConfig = enablePhysics ? {
                gravityX: getSettingsValue<number>('physics.gravityX') ?? 0,
                gravityY: getSettingsValue<number>('physics.gravityY') ?? -9.81,
                fixedTimestep: getSettingsValue<number>('physics.fixedTimestep') ?? 1 / 60,
                subStepCount: getSettingsValue<number>('physics.subStepCount') ?? 4,
            } : undefined;
            const previewSpineVersion = this.spineVersion_ === 'none' ? undefined : this.spineVersion_;
            await this.previewService_.startPreview(this.store_.scene, compiledScript, previewSpineVersion, enablePhysics, physicsConfig);
        } catch (err) {
            console.error('Failed to start preview:', err);
        }
    }

    async stopPreview(): Promise<void> {
        await this.previewService_?.stopPreview();
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        for (const panel of this.panelInstances_.values()) {
            if (isAssetNavigable(panel)) {
                await panel.navigateToAsset(assetPath);
                return;
            }
        }
    }

    // =========================================================================
    // Shell Commands
    // =========================================================================

    executeCommand(fullCommand: string): void {
        this.executeShellCommand(fullCommand);
    }

    private async executeShellCommand(fullCommand: string): Promise<void> {
        if (!this.projectPath_) {
            this.appendOutput('Error: No project loaded\n', 'error');
            return;
        }

        const shell = getEditorContext().shell;
        if (!shell) {
            this.appendOutput('Error: Shell not available\n', 'error');
            return;
        }

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');

        this.activeBottomPanelId_ = 'output';
        this.updateBottomPanelVisibility();

        const parts = fullCommand.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        this.appendOutput(`> ${fullCommand}\n`, 'command');

        try {
            const result = await shell.execute(cmd, args, projectDir, (stream: string, data: string) => {
                this.appendOutput(data + '\n', stream === 'stderr' ? 'stderr' : 'stdout');
            });

            if (result.code !== 0) {
                this.appendOutput(`Process exited with code ${result.code}\n`, 'error');
            } else {
                this.appendOutput(`Done.\n`, 'success');
            }
        } catch (err) {
            this.appendOutput(`Error: ${err}\n`, 'error');
        }
    }

    private installConsoleCapture(): void {
        const original = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
        };

        const formatArg = (a: unknown): string => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            return JSON.stringify(a, null, 2) ?? String(a);
        };
        const formatArgs = (args: unknown[]) => args.map(formatArg).join(' ');

        const cleanStack = (raw: string | undefined): string => {
            if (!raw) return '';
            return raw.split('\n')
                .filter(line => {
                    const t = line.trim();
                    if (!t || t === 'Error') return false;
                    if (t.includes('/editor/dist/')) return false;
                    return true;
                })
                .map(line => line
                    .replace(/https?:\/\/[^/]+\/@fs/g, '')
                    .replace(/blob:https?:\/\/[^/]+\/[a-f0-9-]+/g, '<extension>')
                )
                .join('\n');
        };

        const INTERNAL_PREFIXES = [
            '[TAURI]', '[INFO]', 'File change:',
        ];

        const forward = (type: 'stdout' | 'stderr' | 'error', args: unknown[], stack?: string) => {
            const first = typeof args[0] === 'string' ? args[0] : '';
            if (INTERNAL_PREFIXES.some(p => first.startsWith(p))) return;

            let text = formatArgs(args);
            if (stack) {
                text += '\n' + stack;
            }
            this.appendOutput(text + '\n', type);
        };

        console.log = (...args) => { original.log(...args); forward('stdout', args); };
        console.info = (...args) => { original.info(...args); forward('stdout', args); };
        console.warn = (...args) => { original.warn(...args); forward('stderr', args, cleanStack(new Error().stack)); };
        console.error = (...args) => { original.error(...args); forward('error', args, cleanStack(new Error().stack)); };
    }

    private appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        const outputPanel = this.panelInstances_.get('output');
        if (outputPanel && isOutputAppendable(outputPanel)) {
            outputPanel.appendOutput(text, type);
        }
    }

    // =========================================================================
    // Layout
    // =========================================================================

    private setupLayout(): void {
        this.container_.className = 'es-editor';
        this.container_.innerHTML = `
            <div class="es-editor-menubar">
                <div class="es-menubar-logo">${icons.logo(24)}</div>
                ${this.buildMenuBarHTML()}
                <div class="es-menubar-spacer"></div>
                <button class="es-btn es-btn-preview" data-action="preview">${icons.play(14)} Preview</button>
            </div>
            <div class="es-editor-tabs">
                ${this.buildTabBarHTML()}
            </div>
            <div class="es-editor-body">
                ${this.buildMainPanelsHTML()}
                <div class="es-editor-bottom">
                    ${this.buildBottomPanelsHTML()}
                </div>
            </div>
            ${this.buildStatusBarHTML()}
        `;

        this.instantiatePanels();
        this.updateBottomPanelVisibility();

        setEditorInstance(this);

        if (this.projectPath_) {
            const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');
            getGlobalPathResolver().setProjectDir(projectDir);
        }

        this.setupToolbarEvents();
        this.store_.subscribe(() => this.updateToolbarState());
        this.store_.subscribe(() => this.updateStatusbar());
        this.installConsoleCapture();
    }

    private buildTabBarHTML(): string {
        const positions: PanelPosition[] = ['left', 'center', 'right'];
        return positions.flatMap(pos => getPanelsByPosition(pos))
            .filter(p => p.defaultVisible)
            .map(p => `
                <div class="es-tab es-tab-active" data-panel="${p.id}">
                    <span class="es-tab-label">${p.title}</span>
                    <button class="es-tab-close">${icons.x(10)}</button>
                </div>
            `).join('');
    }

    private buildMainPanelsHTML(): string {
        const sections = (['left', 'center', 'right'] as const).map(pos => {
            const panels = getPanelsByPosition(pos).filter(p => p.defaultVisible);
            const containers = panels.map(p =>
                `<div class="es-panel-container" data-panel-id="${p.id}"></div>`
            ).join('');
            return `<div class="es-editor-${pos}">${containers}</div>`;
        }).join('');
        return `<div class="es-editor-main">${sections}</div>`;
    }

    private buildBottomPanelsHTML(): string {
        const panels = getPanelsByPosition('bottom');
        return panels.map(p =>
            `<div class="es-panel-container" data-panel-id="${p.id}" style="display: none;"></div>`
        ).join('');
    }

    private buildStatusBarHTML(): string {
        return `
            <div class="es-editor-statusbar">
                <div class="es-statusbar-left"></div>
                <div class="es-statusbar-right"></div>
            </div>
        `;
    }

    private buildMenuBarHTML(): string {
        const menus = getAllMenus();
        return menus.map(menu => {
            const items = getMenuItems(menu.id);
            const itemsHTML = items.map(item => {
                const parts: string[] = [];
                if (item.separator) {
                    parts.push('<div class="es-menu-divider"></div>');
                }
                parts.push(`<div class="es-menu-item" data-action="${item.id}">`);
                parts.push(`<span class="es-menu-item-text">${item.label}</span>`);
                if (item.shortcut) {
                    parts.push(`<span class="es-menu-item-shortcut">${item.shortcut}</span>`);
                }
                parts.push('</div>');
                return parts.join('');
            }).join('');

            return `
                <div class="es-menu" data-menu="${menu.id}">
                    <div class="es-menu-trigger">${menu.label}</div>
                    <div class="es-menu-dropdown">${itemsHTML}</div>
                </div>
            `;
        }).join('');
    }

    private instantiatePanels(): void {
        for (const desc of getAllPanels()) {
            if (!desc.defaultVisible && desc.position !== 'bottom') continue;
            const el = this.container_.querySelector(`[data-panel-id="${desc.id}"]`) as HTMLElement;
            if (!el) continue;
            const instance = desc.factory(el, this.store_);
            this.panelInstances_.set(desc.id, instance);
        }
    }

    private instantiateStatusbar(): void {
        const items = getAllStatusbarItems();
        const leftContainer = this.container_.querySelector('.es-statusbar-left');
        const rightContainer = this.container_.querySelector('.es-statusbar-right');

        for (const item of items) {
            const container = item.position === 'left' ? leftContainer : rightContainer;
            if (!container) continue;
            const span = document.createElement('span');
            span.dataset.statusbarId = item.id;
            container.appendChild(span);
            const instance = item.render(span);
            this.statusbarInstances_.push(instance);
        }
    }

    private setupMenuShortcuts(): void {
        const menus = getAllMenus();
        for (const menu of menus) {
            const items = getMenuItems(menu.id);
            for (const item of items) {
                if (item.shortcut) {
                    this.shortcutManager_.register(item.shortcut, item.action);
                }
            }
        }
    }

    private setupToolbarEvents(): void {
        const menubar = this.container_.querySelector('.es-editor-menubar');
        if (!menubar) return;

        let activeMenu: HTMLElement | null = null;

        const closeAllMenus = () => {
            menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
            activeMenu = null;
        };

        menubar.querySelectorAll('.es-menu-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = (trigger as HTMLElement).parentElement!;
                const isOpen = menu.classList.contains('es-open');
                closeAllMenus();
                if (!isOpen) {
                    menu.classList.add('es-open');
                    activeMenu = menu;
                }
            });

            trigger.addEventListener('mouseenter', () => {
                if (activeMenu && activeMenu !== trigger.parentElement) {
                    closeAllMenus();
                    const menu = (trigger as HTMLElement).parentElement!;
                    menu.classList.add('es-open');
                    activeMenu = menu;
                }
            });
        });

        menubar.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const menuItem = target.closest('.es-menu-item') as HTMLElement;
            if (!menuItem) return;

            if (menuItem.classList.contains('es-disabled')) return;

            const actionId = menuItem.dataset.action;
            if (!actionId) return;

            closeAllMenus();

            const allMenus = getAllMenus();
            for (const menu of allMenus) {
                const items = getMenuItems(menu.id);
                const found = items.find(i => i.id === actionId);
                if (found) {
                    found.action();
                    return;
                }
            }
        });

        const previewBtn = menubar.querySelector('[data-action="preview"]');
        previewBtn?.addEventListener('click', () => this.startPreview());

        document.addEventListener('click', (e) => {
            if (!menubar.contains(e.target as Node)) {
                closeAllMenus();
            }
        });
    }

    private updateToolbarState(): void {
        const allMenus = getAllMenus();
        for (const menu of allMenus) {
            const items = getMenuItems(menu.id);
            for (const item of items) {
                if (item.enabled) {
                    const el = this.container_.querySelector(`[data-action="${item.id}"]`);
                    el?.classList.toggle('es-disabled', !item.enabled());
                }
            }
        }
    }

    private updateBottomPanelVisibility(): void {
        const bottomSection = this.container_.querySelector('.es-editor-bottom') as HTMLElement;
        const bottomPanels = getPanelsByPosition('bottom');

        for (const desc of bottomPanels) {
            const el = this.container_.querySelector(`[data-panel-id="${desc.id}"]`) as HTMLElement;
            if (el) {
                el.style.display = desc.id === this.activeBottomPanelId_ ? '' : 'none';
            }
        }

        if (bottomSection) {
            bottomSection.style.display = this.activeBottomPanelId_ ? '' : 'none';
        }

        for (const instance of this.statusbarInstances_) {
            instance.update?.();
        }

        for (const panel of this.panelInstances_.values()) {
            if (isResizable(panel)) {
                requestAnimationFrame(() => panel.resize());
                break;
            }
        }
    }

    private updateStatusbar(): void {
        for (const instance of this.statusbarInstances_) {
            instance.update?.();
        }
    }

    dispose(): void {
        this.shortcutManager_.detach();
        this.scriptLoader_?.dispose();
        this.extensionLoader_?.dispose();
        for (const instance of this.statusbarInstances_) {
            instance.dispose();
        }
        this.statusbarInstances_ = [];
        for (const panel of this.panelInstances_.values()) {
            panel.dispose();
        }
        this.panelInstances_.clear();
        clearEditorAPI();
    }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createEditor(container: HTMLElement, options?: EditorOptions): Editor {
    return new Editor(container, options);
}
