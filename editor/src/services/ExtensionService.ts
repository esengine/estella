import * as esengine from 'esengine';
import {
    Draw, Geometry, Material, BlendMode, DataType, ShaderSources,
    PostProcess, Renderer, RenderStage,
    registerDrawCallback, unregisterDrawCallback, clearDrawCallbacks,
} from 'esengine';
import { ExtensionLoader, type ExtensionPluginInfo } from '../extension';
import { setEditorAPI, clearEditorAPI } from '../extension/editorAPI';
import { showToast, showSuccessToast, showErrorToast } from '../ui/Toast';
import { showContextMenu } from '../ui/ContextMenu';
import { showConfirmDialog, showInputDialog } from '../ui/dialog';
import { getEditorInstance } from '../context/EditorContext';
import { getEditorStore } from '../store';
import { getSettingsValue, setSettingsValue } from '../settings';
import { icons } from '../utils/icons';
import {
    getEditorContainer,
    PANEL,
} from '../container';
import * as containerTokens from '../container/tokens';
import { EditorExtensionAPI } from '../extension/EditorExtensionAPI';
import { getAllPanels } from '../panels/PanelRegistry';
import type { PanelManager } from '../PanelManager';
import type { MenuManager } from '../MenuManager';
import type { DockLayoutManager } from '../DockLayoutManager';
import {
    CHANNEL_EXTENSIONS_DATA,
    CHANNEL_EXTENSIONS_TOGGLE,
    CHANNEL_EXTENSIONS_RELOAD,
    CHANNEL_EXTENSIONS_REQUEST,
    type ExtensionToggleMessage,
} from '../multiwindow/protocol';

export class ExtensionService {
    private baseAPI_: Record<string, unknown> | null = null;
    private extensionLoader_: ExtensionLoader | null = null;
    private projectPath_: string | null;
    private panelManager_: PanelManager;
    private menuManager_: MenuManager;
    private container_: HTMLElement;
    private dockLayout_: DockLayoutManager | null = null;
    private unlistenToggle_: (() => void) | null = null;
    private unlistenReload_: (() => void) | null = null;
    private unlistenRequest_: (() => void) | null = null;
    private reloading_ = false;

    constructor(
        projectPath: string | null,
        panelManager: PanelManager,
        menuManager: MenuManager,
        container: HTMLElement,
    ) {
        this.projectPath_ = projectPath;
        this.panelManager_ = panelManager;
        this.menuManager_ = menuManager;
        this.container_ = container;
    }

    setDockLayout(dockLayout: DockLayoutManager | null): void {
        this.dockLayout_ = dockLayout;
    }

    get isReloading(): boolean {
        return this.reloading_;
    }

    async startListening(): Promise<void> {
        if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
        const { listen } = await import('@tauri-apps/api/event');

        this.unlistenToggle_ = (await listen<ExtensionToggleMessage>(
            CHANNEL_EXTENSIONS_TOGGLE,
            (event) => this.handleRemoteToggle_(event.payload.pluginId),
        )) as unknown as () => void;

        this.unlistenReload_ = (await listen(
            CHANNEL_EXTENSIONS_RELOAD,
            () => this.reload(),
        )) as unknown as () => void;

        this.unlistenRequest_ = (await listen(
            CHANNEL_EXTENSIONS_REQUEST,
            () => this.broadcastPluginList(),
        )) as unknown as () => void;
    }

    broadcastPluginList(): void {
        if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
        import('@tauri-apps/api/event').then(({ emit }) => {
            emit(CHANNEL_EXTENSIONS_DATA, {
                plugins: this.getDiscoveredPlugins(),
                reloading: this.reloading_,
            });
        });
    }

    private handleRemoteToggle_(pluginId: string): void {
        const disabled = getSettingsValue<string[]>('extensions.disabled') ?? [];
        const set = new Set(disabled);
        if (set.has(pluginId)) {
            set.delete(pluginId);
        } else {
            set.add(pluginId);
        }
        setSettingsValue('extensions.disabled', Array.from(set));
        this.reload();
    }

    setupEditorGlobals(): void {
        const container = getEditorContainer();
        const registrar = container as import('../container').PluginRegistrar;

        this.baseAPI_ = {
            ...esengine,
            registrar,
            tokens: containerTokens,
            icons,
            showToast,
            showSuccessToast,
            showErrorToast,
            showContextMenu,
            showConfirmDialog,
            showInputDialog,
            getEditorInstance,
            getEditorStore,
            getSettingsValue,
            setSettingsValue,
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
            editor: new EditorExtensionAPI(container),
        };
        setEditorAPI(this.baseAPI_);
    }

    async initialize(): Promise<void> {
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
            onCleanup: () => this.cleanupExtensionUI_(),
            onAfterReload: () => this.applyExtensionUI_(),
        });

        try {
            await this.extensionLoader_.initialize();
            await this.extensionLoader_.reload();
            await this.extensionLoader_.watch();
        } catch (err) {
            console.error('Failed to initialize extensions:', err);
        }
    }

    private cleanupExtensionUI_(): void {
        const c = getEditorContainer();
        if (this.dockLayout_) {
            for (const [id] of this.panelManager_.panelInstances) {
                if (!c.isBuiltin(PANEL, id)) {
                    this.dockLayout_.removePanel(id);
                }
            }
        }
        this.panelManager_.cleanupExtensionPanels();

        this.container_.querySelectorAll('[data-statusbar-id^="toggle-"]').forEach(el => {
            const panelId = el.getAttribute('data-statusbar-id')?.replace('toggle-', '');
            if (panelId && !c.isBuiltin(PANEL, panelId)) el.remove();
        });

        c.clearExtensions();
    }

    private applyExtensionUI_(): void {
        const c = getEditorContainer();
        if (this.dockLayout_) {
            for (const desc of getAllPanels()) {
                if (c.isBuiltin(PANEL, desc.id)) continue;
                this.dockLayout_.addPanel(desc);
            }
        }
        this.menuManager_.rebuildMenuBar(this.container_);
    }

    getDiscoveredPlugins(): ExtensionPluginInfo[] {
        return this.extensionLoader_?.getDiscoveredPlugins() ?? [];
    }

    async reload(): Promise<boolean> {
        if (!this.extensionLoader_) {
            if (this.projectPath_) {
                await this.initialize();
                this.broadcastPluginList();
                return true;
            }
            return false;
        }

        this.reloading_ = true;
        this.broadcastPluginList();
        try {
            const result = await this.extensionLoader_.reload();
            return result;
        } finally {
            this.reloading_ = false;
            this.broadcastPluginList();
        }
    }

    clearAPI(): void {
        clearEditorAPI();
    }

    dispose(): void {
        this.unlistenToggle_?.();
        this.unlistenReload_?.();
        this.unlistenRequest_?.();
        this.extensionLoader_?.dispose();
        clearEditorAPI();
    }
}
