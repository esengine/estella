import type { App, Entity } from 'esengine';
import type { EntityData } from './types/SceneTypes';
import * as esengine from 'esengine';
import {
    Draw, Geometry, Material, BlendMode, DataType, ShaderSources,
    PostProcess, Renderer, RenderStage,
    registerDrawCallback, unregisterDrawCallback, clearDrawCallbacks,
    DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT,
} from 'esengine';
import { EditorStore } from './store/EditorStore';
import { EditorBridge } from './bridge/EditorBridge';
import { PanelManager } from './PanelManager';
import { MenuManager } from './MenuManager';
import { PreviewManager } from './PreviewManager';
import {
    registerPanel,
    getAllPanels,
    isBuiltinPanel,
} from './panels/PanelRegistry';
import { registerBuiltinPanels } from './panels/builtinPanels';
import { registerBuiltinEditors } from './property/editors';
import { registerMaterialEditors } from './property/materialEditors';
import { lockBuiltinPropertyEditors, clearExtensionPropertyEditors } from './property/PropertyEditor';
import { registerBuiltinSchemas, lockBuiltinComponentSchemas, clearExtensionComponentSchemas } from './schemas/ComponentSchemas';
import { initBoundsProviders, registerBoundsProvider, lockBuiltinBoundsProviders, clearExtensionBoundsProviders } from './bounds';
import { saveSceneToFile, saveSceneToPath, loadSceneFromFile, loadSceneFromPath, hasFileHandle, clearFileHandle } from './io/SceneSerializer';
import { icons } from './utils/icons';
import { ScriptLoader } from './scripting';
import { showBuildSettingsDialog, BuildService } from './builder';
import { AddressablePanel } from './panels/AddressablePanel';
import { getGlobalPathResolver } from './asset';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { getAssetLibrary } from './asset/AssetLibrary';
import { setEditorInstance, getEditorContext, getEditorInstance } from './context/EditorContext';
import { registerBuiltinMenus } from './menus';
import { registerBuiltinGizmos, registerGizmo, lockBuiltinGizmos, clearExtensionGizmos } from './gizmos';
import { registerBuiltinStatusbarItems } from './menus/builtinStatusbar';
import { ExtensionLoader } from './extension';
import { setEditorAPI, clearEditorAPI } from './extension/editorAPI';
import {
    registerMenu, registerMenuItem, registerStatusbarItem,
    lockBuiltinMenus, clearExtensionMenus,
} from './menus/MenuRegistry';
import { registerPropertyEditor } from './property';
import { registerComponentSchema } from './schemas';
import { showToast, showSuccessToast, showErrorToast } from './ui/Toast';
import { showContextMenu } from './ui/ContextMenu';
import { registerContextMenuItem, lockBuiltinContextMenuItems, clearExtensionContextMenuItems } from './ui/ContextMenuRegistry';
import { installGlobalErrorHandler } from './error/GlobalErrorHandler';
import { EditorLogger, createConsoleHandler, createToastHandler } from './logging';
import {
    registerInspectorSection,
    registerComponentInspector,
    lockBuiltinInspectorExtensions,
    clearExtensionInspectorExtensions,
} from './panels/inspector/InspectorRegistry';
import { showConfirmDialog, showInputDialog, showDialog } from './ui/dialog';
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
import { loadProjectConfig, loadEditorLocalSettings, saveEditorLocalSetting } from './launcher/ProjectService';
import type { SpineVersion } from './types/ProjectTypes';
import { DockLayoutManager } from './DockLayoutManager';
import { ContentDrawer } from './ui/ContentDrawer';
import {
    lockBuiltinPanels, clearExtensionPanels,
} from './panels/PanelRegistry';

export interface EditorOptions {
    projectPath?: string;
}

export class Editor {
    private container_: HTMLElement;
    private app_: App | null = null;
    private spineModule_: unknown = null;
    private spineVersion_: string = 'none';
    private spineVersionChangeHandler_: ((version: string) => void) | null = null;
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;
    private projectPath_: string | null = null;

    private panelManager_: PanelManager;
    private menuManager_: MenuManager;
    private previewManager_: PreviewManager;

    private baseAPI_: Record<string, unknown> | null = null;
    private scriptLoader_: ScriptLoader | null = null;
    private extensionLoader_: ExtensionLoader | null = null;
    private dockLayout_: DockLayoutManager | null = null;
    private contentDrawer_: ContentDrawer | null = null;
    private assetLibraryReady_: Promise<void> = Promise.resolve();
    private clipboard_: EntityData[] | null = null;
    private addressableWindow_: { element: HTMLElement; panel: AddressablePanel; keyHandler: (e: KeyboardEvent) => void } | null = null;
    private previewUrl_: string | null = null;
    private escapeHandler_: ((e: KeyboardEvent) => void) | null = null;
    private settingsDebounceTimer_: ReturnType<typeof setTimeout> | null = null;

    constructor(container: HTMLElement, options?: EditorOptions) {
        this.container_ = container;
        this.store_ = new EditorStore();
        this.projectPath_ = options?.projectPath ?? null;

        this.panelManager_ = new PanelManager();
        this.menuManager_ = new MenuManager();
        this.menuManager_.setStore(this.store_);
        this.previewManager_ = new PreviewManager(this.projectPath_);

        installGlobalErrorHandler();

        EditorLogger.addHandler(createConsoleHandler());
        EditorLogger.addHandler(createToastHandler((message, type) => {
            if (type === 'error') showErrorToast(message);
            else if (type === 'warning') showToast({ type: 'info', title: message });
        }));
        EditorLogger.setMinLevel('info');

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
        lockBuiltinContextMenuItems();
        lockBuiltinInspectorExtensions();

        this.setupLayout();

        registerBuiltinStatusbarItems(this);
        this.menuManager_.instantiateStatusbar(this.container_);
        this.menuManager_.setupMenuShortcuts();
        this.menuManager_.attach();

        if (this.projectPath_) {
            this.setupEditorGlobals();
            this.assetLibraryReady_ = this.initializeAssetLibrary();
            this.initializeAllScripts();
            this.syncProjectSettings();
            this.restoreLastScene();
        }
    }

    get projectPath(): string | null {
        return this.projectPath_;
    }

    get currentScenePath(): string | null {
        return this.store_.filePath;
    }

    setApp(app: App): void {
        this.app_ = app;
        this.bridge_ = new EditorBridge(app, this.store_);
        this.panelManager_.setApp(app, this.bridge_);
    }

    setSpineModule(module: unknown, version: string): void {
        this.spineModule_ = module;
        this.spineVersion_ = version;
        this.panelManager_.setSpineModule(module);
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
        return this.panelManager_.assetServer;
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        return this.panelManager_.getSpineSkeletonInfo(entityId);
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        return this.panelManager_.onSpineInstanceReady(listener);
    }

    // =========================================================================
    // Panel Operations
    // =========================================================================

    showPanel(id: string): void {
        if (id === 'content-browser') {
            this.contentDrawer_?.toggle();
            return;
        }
        this.dockLayout_?.showPanel(id);
        this.panelManager_.showPanel(id);
    }

    hidePanel(id: string): void {
        this.panelManager_.hidePanel(id);
    }

    togglePanel(id: string): void {
        if (id === 'content-browser') {
            this.contentDrawer_?.toggle();
            return;
        }
        const panel = this.dockLayout_?.api?.getPanel(id);
        if (panel) {
            this.dockLayout_!.removePanel(id);
            this.panelManager_.removePanelInstance(id);
        } else {
            this.showPanel(id);
        }
    }

    resetLayout(): void {
        this.contentDrawer_?.onResetLayout();
        this.dockLayout_?.resetLayout();
    }

    // =========================================================================
    // Scene Operations
    // =========================================================================

    async newScene(): Promise<void> {
        if (this.store_.isDirty) {
            const result = await this.showUnsavedChangesPrompt();
            if (result === 'cancel') return;
            if (result === 'save') await this.saveScene();
        }
        const w = getSettingsValue<number>('project.designWidth');
        const h = getSettingsValue<number>('project.designHeight');
        this.store_.newScene('Untitled', { width: w, height: h });
        clearFileHandle();
    }

    async saveScene(): Promise<void> {
        if (this.store_.isEditingPrefab) {
            await this.store_.savePrefabEditing();
            return;
        }

        const filePath = this.store_.filePath;

        if (filePath && hasFileHandle()) {
            const success = await saveSceneToPath(this.store_.scene, filePath);
            if (success) {
                this.store_.markSaved();
                this.previewManager_.refreshFiles(this.store_.scene, this.scriptLoader_, this.spineVersion_);
                return;
            }
        }

        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
            this.previewManager_.refreshFiles(this.store_.scene, this.scriptLoader_, this.spineVersion_);
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
        if (this.store_.isDirty) {
            const result = await this.showUnsavedChangesPrompt();
            if (result === 'cancel') return;
            if (result === 'save') await this.saveScene();
        }
        await this.assetLibraryReady_;
        const scene = await loadSceneFromFile();
        if (scene) {
            await getAssetLibrary().migrateScene(scene);
            this.store_.loadScene(scene);
        }
    }

    async openSceneFromPath(scenePath: string): Promise<void> {
        if (this.store_.isEditingPrefab) {
            await this.store_.exitPrefabEditMode();
        }

        await this.assetLibraryReady_;
        const scene = await loadSceneFromPath(scenePath);
        if (scene) {
            const migrated = await getAssetLibrary().migrateScene(scene);
            if (migrated) {
                await saveSceneToPath(scene, scenePath);
            }
            this.store_.loadScene(scene, scenePath);
            this.saveLastOpenedScene(scenePath);
            console.log('Scene loaded:', scenePath);
        }
    }

    duplicateSelected(): void {
        const selected = Array.from(this.store_.selectedEntities);
        if (selected.length === 0) return;

        for (const id of selected) {
            const entityData = this.store_.getEntityData(id);
            if (!entityData) continue;

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
                this.store_.addComponent(newEntity, comp.type, JSON.parse(JSON.stringify(comp.data)));
            }
        }
    }

    copySelected(): void {
        const selected = Array.from(this.store_.selectedEntities);
        if (selected.length === 0) return;

        const allTrees: EntityData[] = [];
        for (const id of selected) {
            const tree = this.collectEntityTree_(id);
            allTrees.push(...tree);
        }
        if (allTrees.length === 0) return;

        this.clipboard_ = JSON.parse(JSON.stringify(allTrees));
        for (const e of this.clipboard_!) {
            delete e.prefab;
        }
    }

    pasteEntity(): void {
        if (!this.clipboard_ || this.clipboard_.length === 0) return;

        const cloned: EntityData[] = JSON.parse(JSON.stringify(this.clipboard_));
        const parent = this.store_.selectedEntity;
        const clipboardIds = new Set(cloned.map(e => e.id));
        const oldIdToNewId = new Map<number, Entity>();

        const scene = this.store_.scene;
        const siblings = scene.entities
            .filter(e => e.parent === (parent as number | null))
            .map(e => e.name);
        const siblingNames = new Set(siblings);

        let lastRoot: Entity | null = null;

        for (const entityData of cloned) {
            const isRoot = entityData.parent === null || !clipboardIds.has(entityData.parent);
            const newParent = isRoot ? parent : (oldIdToNewId.get(entityData.parent!) ?? null);
            if (!isRoot && newParent === null) continue;

            const name = isRoot
                ? generateUniqueName(entityData.name, siblingNames)
                : entityData.name;

            const newEntity = this.store_.createEntity(name, newParent);
            oldIdToNewId.set(entityData.id, newEntity);

            if (isRoot) {
                siblingNames.add(name);
                lastRoot = newEntity;
            }

            for (const comp of entityData.components) {
                this.store_.addComponent(newEntity, comp.type, { ...comp.data });
            }
        }

        if (lastRoot !== null) {
            this.store_.selectEntity(lastRoot);
        }
    }

    hasClipboard(): boolean {
        return this.clipboard_ !== null && this.clipboard_.length > 0;
    }

    private collectEntityTree_(entityId: number): EntityData[] {
        const entity = this.store_.getEntityData(entityId);
        if (!entity) return [];
        const result: EntityData[] = [entity];
        for (const childId of entity.children) {
            result.push(...this.collectEntityTree_(childId));
        }
        return result;
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

    showAddressableWindow(): void {
        if (this.addressableWindow_) {
            this.addressableWindow_.element.style.zIndex = '1001';
            return;
        }

        const win = document.createElement('div');
        win.className = 'es-floating-window es-addressable-window';
        win.innerHTML = `
            <div class="es-floating-header">
                <span class="es-floating-title">Addressable Groups</span>
                <button class="es-dialog-close">&times;</button>
            </div>
            <div class="es-floating-body"></div>
        `;

        const body = win.querySelector('.es-floating-body') as HTMLElement;
        const panel = new AddressablePanel(body, this.store_);

        const close = () => {
            panel.dispose();
            win.remove();
            document.removeEventListener('keydown', keyHandler);
            this.addressableWindow_ = null;
        };

        win.querySelector('.es-dialog-close')!.addEventListener('click', close);

        const header = win.querySelector('.es-floating-header') as HTMLElement;
        header.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('.es-dialog-close')) return;
            const rect = win.getBoundingClientRect();
            win.style.left = `${rect.left}px`;
            win.style.top = `${rect.top}px`;
            win.style.transform = 'none';
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            const onMove = (e: MouseEvent) => {
                const w = win.offsetWidth;
                const h = win.offsetHeight;
                const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - w));
                const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - h));
                win.style.left = `${x}px`;
                win.style.top = `${y}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', keyHandler);

        document.body.appendChild(win);
        this.addressableWindow_ = { element: win, panel, keyHandler };
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
            const resolution = config.designResolution ?? { width: DEFAULT_DESIGN_WIDTH, height: DEFAULT_DESIGN_HEIGHT };
            setSettingsValue('project.designWidth', resolution.width);
            setSettingsValue('project.designHeight', resolution.height);
            setSettingsValue('build.atlasMaxSize', String(config.atlasMaxSize ?? 2048));
            setSettingsValue('build.atlasPadding', config.atlasPadding ?? 2);
            setSettingsValue('runtime.sceneTransitionDuration', config.sceneTransitionDuration ?? 0.3);
            setSettingsValue('runtime.sceneTransitionColor', config.sceneTransitionColor ?? '#000000');
            setSettingsValue('runtime.defaultFontFamily', config.defaultFontFamily ?? 'Arial');
            setSettingsValue('runtime.canvasScaleMode', config.canvasScaleMode ?? 'FixedHeight');
            setSettingsValue('runtime.canvasMatchWidthOrHeight', config.canvasMatchWidthOrHeight ?? 0.5);
            setSettingsValue('runtime.maxDeltaTime', config.maxDeltaTime ?? 0.25);
            setSettingsValue('runtime.maxFixedSteps', config.maxFixedSteps ?? 8);
            setSettingsValue('runtime.textCanvasSize', String(config.textCanvasSize ?? 512));
        }

        const projectPath = this.projectPath_;
        onSettingsChange((id, value) => {
            if (id.startsWith('project.') || id.startsWith('physics.') || id.startsWith('build.') || id.startsWith('runtime.')) {
                if (this.settingsDebounceTimer_) clearTimeout(this.settingsDebounceTimer_);
                this.settingsDebounceTimer_ = setTimeout(() => this.saveProjectField(projectPath), 500);
                if (id === 'project.spineVersion') {
                    this.spineVersionChangeHandler_?.(value as string);
                }
            }
        });
    }

    private async restoreLastScene(): Promise<void> {
        if (!this.projectPath_) return;
        const settings = await loadEditorLocalSettings(this.projectPath_);
        const lastScene = settings?.lastOpenedScene as string | undefined;
        if (lastScene) {
            await this.openSceneFromPath(lastScene);
        }
    }

    private saveLastOpenedScene(scenePath: string): void {
        if (!this.projectPath_) return;
        saveEditorLocalSetting(this.projectPath_, 'lastOpenedScene', scenePath);
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
            width: getSettingsValue<number>('project.designWidth') || DEFAULT_DESIGN_WIDTH,
            height: getSettingsValue<number>('project.designHeight') || DEFAULT_DESIGN_HEIGHT,
        };
        config.atlasMaxSize = parseInt(getSettingsValue<string>('build.atlasMaxSize') ?? '2048', 10);
        config.atlasPadding = getSettingsValue<number>('build.atlasPadding') ?? 2;
        config.sceneTransitionDuration = getSettingsValue<number>('runtime.sceneTransitionDuration') ?? 0.3;
        config.sceneTransitionColor = getSettingsValue<string>('runtime.sceneTransitionColor') ?? '#000000';
        config.defaultFontFamily = getSettingsValue<string>('runtime.defaultFontFamily') ?? 'Arial';
        config.canvasScaleMode = getSettingsValue<string>('runtime.canvasScaleMode') ?? 'FixedHeight';
        config.canvasMatchWidthOrHeight = getSettingsValue<number>('runtime.canvasMatchWidthOrHeight') ?? 0.5;
        config.maxDeltaTime = getSettingsValue<number>('runtime.maxDeltaTime') ?? 0.25;
        config.maxFixedSteps = getSettingsValue<number>('runtime.maxFixedSteps') ?? 8;
        config.textCanvasSize = parseInt(getSettingsValue<string>('runtime.textCanvasSize') ?? '512', 10);
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
                    this.panelManager_.appendOutput(`${e.file}:${e.line}:${e.column} - ${e.message}`, 'error');
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
            registerContextMenuItem,
            registerInspectorSection,
            registerComponentInspector,
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
        if (this.dockLayout_) {
            for (const [id] of this.panelManager_.panelInstances) {
                if (!isBuiltinPanel(id)) {
                    this.dockLayout_.removePanel(id);
                }
            }
        }
        this.panelManager_.cleanupExtensionPanels();

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
        clearExtensionContextMenuItems();
        clearExtensionInspectorExtensions();
    }

    private applyExtensionUI(): void {
        if (this.dockLayout_) {
            for (const desc of getAllPanels()) {
                if (isBuiltinPanel(desc.id)) continue;
                this.dockLayout_.addPanel(desc);
            }
        }
        this.menuManager_.rebuildMenuBar(this.container_);
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
        if (this.store_.isDirty && this.store_.filePath && hasFileHandle()) {
            await this.saveScene();
            showToast({ type: 'info', title: 'Scene saved before preview' });
        }
        const port = await this.previewManager_.startPreview(
            this.store_.scene, this.scriptLoader_, this.spineVersion_,
        );
        if (port !== null) {
            this.previewUrl_ = `http://localhost:${port}`;
            this.updatePreviewUrl();
        }
    }

    async startPreviewServer(): Promise<string | null> {
        if (this.store_.isDirty && this.store_.filePath && hasFileHandle()) {
            await this.saveScene();
        }
        const port = await this.previewManager_.startServer(
            this.store_.scene, this.scriptLoader_, this.spineVersion_,
        );
        if (port === null) return null;
        this.previewUrl_ = `http://localhost:${port}`;
        this.updatePreviewUrl();
        return this.previewUrl_;
    }

    async stopPreviewServer(): Promise<void> {
        await this.previewManager_.stopPreview();
        this.previewUrl_ = null;
        this.updatePreviewUrl();
    }

    private updatePreviewUrl(): void {
        const urlEl = this.container_.querySelector('.es-preview-url') as HTMLElement;
        if (!urlEl) return;
        if (this.previewUrl_) {
            urlEl.textContent = this.previewUrl_;
            urlEl.dataset.url = this.previewUrl_;
            urlEl.style.display = '';
        } else {
            urlEl.style.display = 'none';
        }
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        await this.panelManager_.navigateToAsset(assetPath);
    }

    // =========================================================================
    // Shell Commands
    // =========================================================================

    executeCommand(fullCommand: string): void {
        this.executeShellCommand(fullCommand);
    }

    private async executeShellCommand(fullCommand: string): Promise<void> {
        if (!this.projectPath_) {
            this.panelManager_.appendOutput('Error: No project loaded\n', 'error');
            return;
        }

        const shell = getEditorContext().shell;
        if (!shell) {
            this.panelManager_.appendOutput('Error: Shell not available\n', 'error');
            return;
        }

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');

        this.showPanel('output');

        const parts = fullCommand.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        this.panelManager_.appendOutput(`> ${fullCommand}\n`, 'command');

        try {
            const result = await shell.execute(cmd, args, projectDir, (stream: string, data: string) => {
                this.panelManager_.appendOutput(data + '\n', stream === 'stderr' ? 'stderr' : 'stdout');
            });

            if (result.code !== 0) {
                this.panelManager_.appendOutput(`Process exited with code ${result.code}\n`, 'error');
            } else {
                this.panelManager_.appendOutput(`Done.\n`, 'success');
            }
        } catch (err) {
            this.panelManager_.appendOutput(`Error: ${err}\n`, 'error');
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
            this.panelManager_.appendOutput(text + '\n', type);
        };

        console.log = (...args) => { original.log(...args); forward('stdout', args); };
        console.info = (...args) => { original.info(...args); forward('stdout', args); };
        console.warn = (...args) => { original.warn(...args); forward('stderr', args, cleanStack(new Error().stack)); };
        console.error = (...args) => { original.error(...args); forward('error', args, cleanStack(new Error().stack)); };
    }

    // =========================================================================
    // Layout
    // =========================================================================

    private setupLayout(): void {
        this.container_.className = 'es-editor';
        this.container_.innerHTML = `
            <div class="es-editor-menubar">
                <div class="es-menubar-logo">${icons.logo(24)}</div>
                ${this.menuManager_.buildMenuBarHTML()}
                <div class="es-menubar-spacer">
                    <span class="es-menubar-scene-name"></span>
                </div>
                <span class="es-preview-url" style="display:none" title="Click to copy"></span>
                <button class="es-btn es-btn-preview" data-action="preview">${icons.play(14)} Preview</button>
            </div>
            <div class="es-editor-dock"></div>
            ${this.menuManager_.buildStatusBarHTML()}
        `;

        const dockContainer = this.container_.querySelector('.es-editor-dock') as HTMLElement;
        this.dockLayout_ = new DockLayoutManager(this.panelManager_, this.store_);
        this.dockLayout_.initialize(dockContainer);

        this.contentDrawer_ = new ContentDrawer(
            this.container_, this.dockLayout_, this.store_,
            {
                projectPath: this.projectPath_ ?? undefined,
                onOpenScene: (scenePath) => this.openSceneFromPath(scenePath),
            },
        );

        setEditorInstance(this);

        if (this.projectPath_) {
            const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');
            getGlobalPathResolver().setProjectDir(projectDir);
        }

        this.container_.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        const previewUrlEl = this.container_.querySelector('.es-preview-url');
        previewUrlEl?.addEventListener('click', () => {
            const url = (previewUrlEl as HTMLElement).dataset.url;
            if (url) {
                navigator.clipboard.writeText(url);
                const original = previewUrlEl.textContent;
                previewUrlEl.textContent = 'Copied!';
                setTimeout(() => { previewUrlEl.textContent = original; }, 1000);
            }
        });

        this.menuManager_.setupToolbarEvents(this.container_, () => this.startPreview());
        this.setupEscapeHandler();
        this.store_.subscribe(() => this.menuManager_.updateToolbarState(this.container_));
        this.store_.subscribe(() => {
            this.menuManager_.updateStatusbar();
            this.updateSceneNameDisplay();
        });
        this.installConsoleCapture();
    }

    private updateSceneNameDisplay(): void {
        const el = this.container_.querySelector('.es-menubar-scene-name');
        if (!el) return;
        const filePath = this.store_.filePath;
        const dirty = this.store_.isDirty ? ' *' : '';
        if (filePath) {
            const fileName = filePath.replace(/^.*[/\\]/, '');
            el.textContent = fileName + dirty;
        } else {
            el.textContent = this.store_.scene.name + dirty;
        }
    }

    private async showUnsavedChangesPrompt(): Promise<'save' | 'discard' | 'cancel'> {
        return new Promise((resolve) => {
            let resolved = false;
            showDialog({
                title: 'Unsaved Changes',
                content: 'You have unsaved changes. Save before continuing?',
                buttons: [
                    { label: 'Cancel', role: 'cancel' },
                    {
                        label: "Don't Save", role: 'custom',
                        onClick: () => { resolved = true; resolve('discard'); },
                    },
                    {
                        label: 'Save', role: 'confirm', primary: true,
                        onClick: () => { resolved = true; resolve('save'); },
                    },
                ],
                closeOnEscape: true,
            }).then((result) => {
                if (!resolved) {
                    resolve(result.action === 'confirm' ? 'save' : 'cancel');
                }
            });
        });
    }

    private setupEscapeHandler(): void {
        this.escapeHandler_ = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (document.querySelector('.es-dialog-overlay')) return;
            if (document.querySelector('.es-context-menu')) return;

            const openMenu = this.container_.querySelector('.es-menu.es-open');
            if (openMenu) {
                openMenu.classList.remove('es-open');
                return;
            }

            if (this.contentDrawer_?.state === 'open') {
                this.contentDrawer_.closeDrawer();
                return;
            }

            if (this.addressableWindow_) {
                this.addressableWindow_.panel.dispose();
                this.addressableWindow_.element.remove();
                document.removeEventListener('keydown', this.addressableWindow_.keyHandler);
                this.addressableWindow_ = null;
                return;
            }

            if (this.store_.selectedEntities.size > 0) {
                this.store_.selectEntity(null);
            }
        };
        document.addEventListener('keydown', this.escapeHandler_);
    }

    dispose(): void {
        if (this.addressableWindow_) {
            this.addressableWindow_.panel.dispose();
            this.addressableWindow_.element.remove();
            document.removeEventListener('keydown', this.addressableWindow_.keyHandler);
            this.addressableWindow_ = null;
        }
        if (this.escapeHandler_) {
            document.removeEventListener('keydown', this.escapeHandler_);
            this.escapeHandler_ = null;
        }
        this.contentDrawer_?.dispose();
        this.menuManager_.dispose();
        this.scriptLoader_?.dispose();
        this.extensionLoader_?.dispose();
        this.dockLayout_?.dispose();
        this.panelManager_.dispose();
        this.previewManager_.dispose();
        clearEditorAPI();
    }
}

export function createEditor(container: HTMLElement, options?: EditorOptions): Editor {
    return new Editor(container, options);
}
