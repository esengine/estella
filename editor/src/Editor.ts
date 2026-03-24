import type { App } from 'esengine';
import { EditorStore } from './store/EditorStore';
import { PanelManager } from './PanelManager';
import { MenuManager } from './MenuManager';
import { exposeRegistrationAPI } from './schemas/ComponentSchemas';
import { EditorContainer, setEditorContainer, getEditorContainer } from './container';
import { icons } from './utils/icons';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { setEditorInstance } from './context/EditorContext';
import { showContextMenu } from './ui/ContextMenu';
import { showToast, showErrorToast } from './ui/Toast';
import { installGlobalErrorHandler } from './error/GlobalErrorHandler';
import { EditorLogger, createConsoleHandler, createToastHandler } from './logging';
import { builtinPlugins, coreStatusbarPlugin } from './plugins';
import { PluginManager as PluginManagerService } from './services/PluginManager';
import { getEditorStore } from './store';
import { DockLayoutManager } from './DockLayoutManager';
import { closeAddressableWindow, hasAddressableWindow } from './dialogs/AddressableWindow';

import { OutputService } from './services/OutputService';
import { ClipboardService } from './services/ClipboardService';
import { ShellService } from './services/ShellService';
import { ProfilerService } from './services/ProfilerService';
import { FrameDebuggerService } from './services/FrameDebuggerService';
import { NavigationService } from './services/NavigationService';
import { SpineService } from './services/SpineService';
import { RuntimeService } from './services/RuntimeService';
import { ScriptService } from './services/ScriptService';
import { ExtensionService } from './services/ExtensionService';
import { PreviewService } from './services/PreviewService';
import { SceneService } from './services/SceneService';
import { ProjectService } from './services/ProjectService';
import { MultiWindowService } from './services/MultiWindowService';
import { McpBridge } from './bridge/McpBridge';
import {
    OUTPUT_SERVICE,
    CLIPBOARD_SERVICE,
    SHELL_SERVICE,
    PROFILER_SERVICE,
    FRAME_DEBUGGER_SERVICE,
    NAVIGATION_SERVICE,
    SPINE_SERVICE,
    RUNTIME_SERVICE,
    SCRIPT_SERVICE,
    EXTENSION_SERVICE,
    PREVIEW_SERVICE,
    SCENE_SERVICE,
    PROJECT_SERVICE,
    MULTI_WINDOW_SERVICE,
    LAYOUT_SERVICE,
    PLUGIN_MANAGER,
} from './container/tokens';

export interface EditorOptions {
    projectPath?: string;
}

export class Editor {
    private container_: HTMLElement;
    private store_: EditorStore;
    private projectPath_: string | null = null;

    private panelManager_: PanelManager;
    private menuManager_: MenuManager;

    private dockLayout_: DockLayoutManager | null = null;
    private escapeHandler_: ((e: KeyboardEvent) => void) | null = null;
    private contextMenuHandler_: ((e: Event) => void) | null = null;
    private pluginManager_!: PluginManagerService;

    private outputService_!: OutputService;
    private clipboardService_!: ClipboardService;
    private shellService_!: ShellService;
    private profilerService_!: ProfilerService;
    private frameDebuggerService_!: FrameDebuggerService;
    private navigationService_!: NavigationService;
    private spineService_!: SpineService;
    private runtimeService_!: RuntimeService;
    private scriptService_!: ScriptService;
    private extensionService_!: ExtensionService;
    private previewService_!: PreviewService;
    private sceneService_!: SceneService;
    private projectService_!: ProjectService;
    private multiWindowService_!: MultiWindowService;
    private mcpBridge_: McpBridge | null = null;

    get mcpBridge(): McpBridge | null {
        return this.mcpBridge_;
    }

    private assetLibraryReady_: Promise<void> = Promise.resolve();
    private scriptsReady_: Promise<void> = Promise.resolve();
    private sceneRestoreReady_: Promise<void> = Promise.resolve();

    constructor(container: HTMLElement, options?: EditorOptions) {
        this.container_ = container;
        this.projectPath_ = options?.projectPath ?? null;

        const iocContainer = new EditorContainer();
        setEditorContainer(iocContainer);

        this.pluginManager_ = new PluginManagerService({
            registrar: iocContainer,
            projectPath: this.projectPath_,
        });

        installGlobalErrorHandler();

        EditorLogger.addHandler(createConsoleHandler());
        EditorLogger.addHandler(createToastHandler((message, type) => {
            if (type === 'error') showErrorToast(message);
            else if (type === 'warning') showToast({ type: 'info', title: message });
        }));
        EditorLogger.setMinLevel('info');

        for (const plugin of builtinPlugins) {
            this.pluginManager_.addPlugin(plugin);
        }

        this.store_ = getEditorStore();
        this.panelManager_ = new PanelManager();
        this.menuManager_ = new MenuManager();
        this.menuManager_.setStore(this.store_);

        this.createServices_(iocContainer);

        exposeRegistrationAPI();
        iocContainer.lockBuiltins();

        this.setupLayout_();

        this.pluginManager_.addPlugin(coreStatusbarPlugin);
        this.menuManager_.instantiateStatusbar(this.container_);
        this.menuManager_.setupMenuShortcuts();
        this.menuManager_.attach();

        this.initMultiWindow_();

        if (this.projectPath_) {
            this.extensionService_.setupEditorGlobals();
            const assetReady = this.projectService_.initializeAssetLibrary();
            this.assetLibraryReady_ = assetReady;
            this.sceneService_.setAssetLibraryReady(assetReady);
            const scriptsReady = this.initializeAllScripts_();
            this.scriptsReady_ = scriptsReady;
            this.sceneService_.setScriptsReady(scriptsReady);
            this.projectService_.initProjectSettingsSync();
            this.sceneRestoreReady_ = this.sceneService_.restoreLastScene();
        }
    }

    // =========================================================================
    // Public API (used by desktop/main.ts)
    // =========================================================================

    get projectPath(): string | null {
        return this.projectPath_;
    }

    get store(): EditorStore {
        return this.store_;
    }

    get assetServer(): EditorAssetServer | null {
        return this.navigationService_.getAssetServer();
    }

    setApp(app: App): void {
        this.runtimeService_.setApp(app);
    }

    setPhysicsFactory(factory: unknown): void {
        this.runtimeService_.setPhysicsFactory(factory);
    }

    setSpineModule(module: unknown, version: string): void {
        this.spineService_.setSpineModule(module, version);
    }

    onSpineVersionChange(handler: (version: string) => void): void {
        this.spineService_.onSpineVersionChange(handler);
    }

    waitForAssetLibrary(): Promise<void> {
        return this.assetLibraryReady_;
    }

    waitForScripts(): Promise<void> {
        return this.scriptsReady_;
    }

    waitForSceneRestore(): Promise<void> {
        return this.sceneRestoreReady_;
    }

    // =========================================================================
    // Plugin system
    // =========================================================================

    get pluginManager(): PluginManagerService {
        return this.pluginManager_;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    dispose(): void {
        this.mcpBridge_?.dispose();
        this.mcpBridge_ = null;
        if (this.contextMenuHandler_) {
            this.container_.removeEventListener('contextmenu', this.contextMenuHandler_);
            this.contextMenuHandler_ = null;
        }
        closeAddressableWindow();
        this.profilerService_.stopProfilerStats();
        if (this.escapeHandler_) {
            document.removeEventListener('keydown', this.escapeHandler_);
            this.escapeHandler_ = null;
        }
        this.multiWindowService_.dispose();
        this.menuManager_.dispose();
        this.scriptService_.dispose();
        this.extensionService_.dispose();
        this.dockLayout_?.dispose();
        this.panelManager_.dispose();
        this.previewService_.dispose();
    }

    // =========================================================================
    // Private
    // =========================================================================

    private createServices_(iocContainer: EditorContainer): void {
        this.outputService_ = new OutputService();
        this.clipboardService_ = new ClipboardService(this.store_);
        this.navigationService_ = new NavigationService(this.panelManager_);
        this.profilerService_ = new ProfilerService();
        this.frameDebuggerService_ = new FrameDebuggerService();
        this.spineService_ = new SpineService(this.store_);
        this.runtimeService_ = new RuntimeService(this.store_);
        this.scriptService_ = new ScriptService(this.projectPath_, this.outputService_, this.store_);
        this.extensionService_ = new ExtensionService(
            this.projectPath_, this.panelManager_, this.menuManager_, this.container_,
        );
        this.sceneService_ = new SceneService(this.store_, this.projectPath_);
        this.projectService_ = new ProjectService(this.projectPath_, this.spineService_);
        this.multiWindowService_ = new MultiWindowService(this.store_, this.projectPath_);

        this.shellService_ = new ShellService(
            this.projectPath_, this.outputService_,
            (id: string) => this.navigationService_.showPanel(id),
        );

        const sk = 'default';
        iocContainer.provide(OUTPUT_SERVICE, sk, this.outputService_);
        iocContainer.provide(CLIPBOARD_SERVICE, sk, this.clipboardService_);
        iocContainer.provide(NAVIGATION_SERVICE, sk, this.navigationService_);
        iocContainer.provide(PROFILER_SERVICE, sk, this.profilerService_);
        iocContainer.provide(FRAME_DEBUGGER_SERVICE, sk, this.frameDebuggerService_);
        iocContainer.provide(SHELL_SERVICE, sk, this.shellService_);
        iocContainer.provide(SPINE_SERVICE, sk, this.spineService_);
        iocContainer.provide(RUNTIME_SERVICE, sk, this.runtimeService_);
        iocContainer.provide(SCRIPT_SERVICE, sk, this.scriptService_);
        iocContainer.provide(EXTENSION_SERVICE, sk, this.extensionService_);
        iocContainer.provide(SCENE_SERVICE, sk, this.sceneService_);
        iocContainer.provide(PROJECT_SERVICE, sk, this.projectService_);
        iocContainer.provide(MULTI_WINDOW_SERVICE, sk, this.multiWindowService_);
        iocContainer.provide(LAYOUT_SERVICE, sk, this.navigationService_);
        iocContainer.provide(PLUGIN_MANAGER, sk, this.pluginManager_);

        this.mcpBridge_ = new McpBridge(this.outputService_, this.scriptService_, null, this.projectPath_);
    }

    private async initializeAllScripts_(): Promise<void> {
        await this.extensionService_.startListening();
        await this.extensionService_.initialize();
        await this.scriptService_.initialize();
    }

    private setupLayout_(): void {
        this.container_.className = 'es-editor';
        this.container_.innerHTML = `
            <div class="es-editor-menubar">
                <div class="es-menubar-logo">${icons.logo(24)}</div>
                ${this.menuManager_.buildMenuBarHTML()}
                <div class="es-menubar-spacer">
                    <span class="es-menubar-scene-name"></span>
                </div>
                <span class="es-preview-url" style="display:none" title="Click to copy"></span>
                <label class="es-preview-stats-toggle" title="Show stats overlay in preview">
                    <input type="checkbox" class="es-preview-stats-cb" />
                    <span>Stats</span>
                </label>
                <button class="es-btn es-btn-preview" data-action="preview">${icons.play(14)} Preview</button>
            </div>
            <div class="es-editor-dock"></div>
            ${this.menuManager_.buildStatusBarHTML()}
        `;

        const dockContainer = this.container_.querySelector('.es-editor-dock') as HTMLElement;
        this.dockLayout_ = new DockLayoutManager(this.panelManager_, this.store_);
        this.dockLayout_.initialize(dockContainer);

        this.navigationService_.setDockLayout(this.dockLayout_);
        this.navigationService_.initContextPanels(this.store_);

        this.extensionService_.setDockLayout(this.dockLayout_);

        this.previewService_ = new PreviewService(
            this.projectPath_, this.store_, this.scriptService_, this.spineService_,
            this.container_, () => this.sceneService_.saveScene(),
        );
        this.sceneService_.setPreviewService(this.previewService_);
        getEditorContainer().provide(PREVIEW_SERVICE, 'default', this.previewService_);

        this.projectService_.initializeProjectDir();

        setEditorInstance(this);

        this.contextMenuHandler_ = (e) => {
            const target = e.target as HTMLElement;
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
                e.preventDefault();
                this.showTextEditContextMenu_(target, e as MouseEvent);
                return;
            }
            const selection = window.getSelection()?.toString();
            if (selection) {
                e.preventDefault();
                this.showSelectionContextMenu_(selection, e as MouseEvent);
                return;
            }
            e.preventDefault();
        };
        this.container_.addEventListener('contextmenu', this.contextMenuHandler_);

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

        const statsCb = this.container_.querySelector('.es-preview-stats-cb') as HTMLInputElement;
        statsCb?.addEventListener('change', () => {
            this.previewService_.togglePreviewStats(statsCb.checked);
        });

        this.menuManager_.setupToolbarEvents(this.container_, () => this.previewService_.startPreview());
        this.setupEscapeHandler_();
        this.store_.subscribe(() => this.menuManager_.updateToolbarState(this.container_));
        this.store_.subscribe(() => {
            this.menuManager_.updateStatusbar();
            this.updateSceneNameDisplay_();
        });
        this.outputService_.installConsoleCapture();
    }

    private showTextEditContextMenu_(target: HTMLElement, e: MouseEvent): void {
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        const inputEl = isInput ? target as HTMLInputElement | HTMLTextAreaElement : null;

        const hasSelection = inputEl
            ? (inputEl.selectionStart !== inputEl.selectionEnd)
            : !!window.getSelection()?.toString();

        const focusTarget = () => {
            if (inputEl) inputEl.focus();
        };

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Cut',
                    shortcut: 'Ctrl+X',
                    disabled: !hasSelection || (inputEl?.readOnly ?? false),
                    onClick: async () => {
                        if (inputEl && inputEl.selectionStart !== inputEl.selectionEnd) {
                            const text = inputEl.value.substring(inputEl.selectionStart!, inputEl.selectionEnd!);
                            await writeClipboard_(text);
                            focusTarget();
                            const s = inputEl.selectionStart!;
                            inputEl.setRangeText('', inputEl.selectionStart!, inputEl.selectionEnd!, 'end');
                            inputEl.selectionStart = inputEl.selectionEnd = s;
                            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    },
                },
                {
                    label: 'Copy',
                    shortcut: 'Ctrl+C',
                    disabled: !hasSelection,
                    onClick: async () => {
                        if (inputEl && inputEl.selectionStart !== inputEl.selectionEnd) {
                            const text = inputEl.value.substring(inputEl.selectionStart!, inputEl.selectionEnd!);
                            await writeClipboard_(text);
                        } else {
                            const sel = window.getSelection()?.toString();
                            if (sel) await writeClipboard_(sel);
                        }
                    },
                },
                {
                    label: 'Paste',
                    shortcut: 'Ctrl+V',
                    disabled: inputEl?.readOnly ?? false,
                    onClick: async () => {
                        if (!inputEl || inputEl.readOnly) return;
                        const text = await readClipboard_();
                        if (!text) return;
                        focusTarget();
                        const start = inputEl.selectionStart ?? 0;
                        const end = inputEl.selectionEnd ?? 0;
                        inputEl.setRangeText(text, start, end, 'end');
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                    },
                },
                { label: '', separator: true },
                {
                    label: 'Select All',
                    shortcut: 'Ctrl+A',
                    onClick: () => {
                        if (inputEl) {
                            inputEl.focus();
                            inputEl.select();
                        }
                    },
                },
            ],
        });
    }

    private showSelectionContextMenu_(selection: string, e: MouseEvent): void {
        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Copy',
                    shortcut: 'Ctrl+C',
                    onClick: async () => {
                        await writeClipboard_(selection);
                    },
                },
            ],
        });
    }

    private updateSceneNameDisplay_(): void {
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

    private setupEscapeHandler_(): void {
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

            if (hasAddressableWindow()) {
                closeAddressableWindow();
                return;
            }

            if (this.store_.selectedEntities.size > 0) {
                this.store_.selectEntity(null);
            }
        };
        document.addEventListener('keydown', this.escapeHandler_);
    }

    private initMultiWindow_(): void {
        this.multiWindowService_.initialize(
            this.dockLayout_,
            this.outputService_,
            this.profilerService_,
            this.frameDebuggerService_,
            () => this.previewService_.startPreviewServer(),
            async () => {
                const result = await this.sceneService_.showUnsavedChangesPrompt_();
                if (result === 'cancel') return;
                if (result === 'save') await this.sceneService_.saveScene();
            },
        );
    }
}

export function createEditor(container: HTMLElement, options?: EditorOptions): Editor {
    return new Editor(container, options);
}

async function readClipboard_(): Promise<string> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<string>('plugin:clipboard-manager|read_text');
        return result ?? '';
    } catch {
        try { return await navigator.clipboard.readText(); } catch { return ''; }
    }
}

async function writeClipboard_(text: string): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin:clipboard-manager|write_text', { text });
    } catch {
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }
}
