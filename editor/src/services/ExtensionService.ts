import * as esengine from 'esengine';
import {
    Draw, Geometry, Material, BlendMode, DataType, ShaderSources,
    PostProcess, Renderer, RenderStage,
    registerDrawCallback, unregisterDrawCallback, clearDrawCallbacks,
} from 'esengine';
import { ExtensionLoader } from '../extension';
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
import { getAllPanels } from '../panels/PanelRegistry';
import type { PanelManager } from '../PanelManager';
import type { MenuManager } from '../MenuManager';
import type { DockLayoutManager } from '../DockLayoutManager';

export class ExtensionService {
    private baseAPI_: Record<string, unknown> | null = null;
    private extensionLoader_: ExtensionLoader | null = null;
    private projectPath_: string | null;
    private panelManager_: PanelManager;
    private menuManager_: MenuManager;
    private container_: HTMLElement;
    private dockLayout_: DockLayoutManager | null = null;

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

    async reload(): Promise<boolean> {
        if (!this.extensionLoader_) {
            if (this.projectPath_) {
                await this.initialize();
                return true;
            }
            return false;
        }

        return this.extensionLoader_.reload();
    }

    clearAPI(): void {
        clearEditorAPI();
    }

    dispose(): void {
        this.extensionLoader_?.dispose();
        clearEditorAPI();
    }
}
