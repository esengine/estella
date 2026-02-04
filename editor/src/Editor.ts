/**
 * @file    Editor.ts
 * @brief   Main editor component
 */

import type { App } from 'esengine';
import { EditorStore } from './store/EditorStore';
import { EditorBridge } from './bridge/EditorBridge';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { SceneViewPanel } from './panels/SceneViewPanel';
import { ContentBrowserPanel, type ContentBrowserOptions } from './panels/ContentBrowserPanel';
import { registerBuiltinEditors } from './property/editors';
import { registerBuiltinSchemas } from './schemas/ComponentSchemas';
import { saveSceneToFile, loadSceneFromFile, loadSceneFromPath } from './io/SceneSerializer';
import { icons } from './utils/icons';
import { ScriptLoader } from './scripting';
import { PreviewService } from './preview';

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
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;
    private projectPath_: string | null = null;

    private hierarchyPanel_: HierarchyPanel | null = null;
    private inspectorPanel_: InspectorPanel | null = null;
    private sceneViewPanel_: SceneViewPanel | null = null;
    private contentBrowserPanel_: ContentBrowserPanel | null = null;
    private scriptLoader_: ScriptLoader | null = null;
    private previewService_: PreviewService | null = null;
    private assetsPanelVisible_: boolean = true;
    private outputPanelVisible_: boolean = false;

    constructor(container: HTMLElement, options?: EditorOptions) {
        this.container_ = container;
        this.store_ = new EditorStore();
        this.projectPath_ = options?.projectPath ?? null;

        registerBuiltinEditors();
        registerBuiltinSchemas();

        this.setupLayout();
        this.setupKeyboardShortcuts();

        if (this.projectPath_) {
            this.initializeScripts();
            this.previewService_ = new PreviewService({ projectPath: this.projectPath_ });
        }
    }

    get projectPath(): string | null {
        return this.projectPath_;
    }

    setApp(app: App): void {
        this.app_ = app;
        this.bridge_ = new EditorBridge(app, this.store_);

        if (this.sceneViewPanel_) {
            this.sceneViewPanel_.setBridge(this.bridge_);
            this.sceneViewPanel_.setApp(app);
        }
    }

    get store(): EditorStore {
        return this.store_;
    }

    // =========================================================================
    // Scene Operations
    // =========================================================================

    newScene(): void {
        this.store_.newScene();
    }

    async saveScene(): Promise<void> {
        await saveSceneToFile(this.store_.scene);
        this.store_.markSaved();
    }

    async loadScene(): Promise<void> {
        const scene = await loadSceneFromFile();
        if (scene) {
            this.store_.loadScene(scene);
        }
    }

    async openSceneFromPath(scenePath: string): Promise<void> {
        const scene = await loadSceneFromPath(scenePath);
        if (scene) {
            this.store_.loadScene(scene);
            console.log('Scene loaded:', scenePath);
        }
    }

    // =========================================================================
    // Script Operations
    // =========================================================================

    private async initializeScripts(): Promise<void> {
        if (!this.projectPath_) return;

        this.scriptLoader_ = new ScriptLoader({
            projectPath: this.projectPath_,
            onCompileError: (errors) => {
                console.error('Script compilation errors:', errors);
            },
            onCompileSuccess: () => {
                console.log('Scripts compiled successfully');
            },
        });

        try {
            await this.scriptLoader_.initialize();
            await this.scriptLoader_.compileAndExecute();
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
    // Preview Operations
    // =========================================================================

    async startPreview(): Promise<void> {
        if (!this.previewService_) {
            console.warn('Preview not available: no project loaded');
            return;
        }

        try {
            const compiledScript = this.scriptLoader_?.getCompiledCode() ?? undefined;
            await this.previewService_.startPreview(this.store_.scene, compiledScript);
        } catch (err) {
            console.error('Failed to start preview:', err);
        }
    }

    async stopPreview(): Promise<void> {
        await this.previewService_?.stopPreview();
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        if (this.contentBrowserPanel_) {
            await this.contentBrowserPanel_.navigateToAsset(assetPath);
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private setupLayout(): void {
        this.container_.className = 'es-editor';
        this.container_.innerHTML = `
            <div class="es-editor-toolbar">
                <div class="es-toolbar-logo">${icons.logo(24)}</div>
                <div class="es-toolbar-divider"></div>
                <button class="es-btn" data-action="new">New</button>
                <button class="es-btn" data-action="open">Open</button>
                <button class="es-btn" data-action="save">Save</button>
                <div class="es-toolbar-spacer"></div>
                <button class="es-btn" data-action="undo" disabled>Undo</button>
                <button class="es-btn" data-action="redo" disabled>Redo</button>
                <div class="es-toolbar-spacer"></div>
                <button class="es-btn es-btn-preview" data-action="preview">${icons.play(14)} Preview</button>
            </div>
            <div class="es-editor-tabs">
                <div class="es-tab es-tab-active" data-panel="hierarchy">
                    <span class="es-tab-label">Hierarchy</span>
                    <button class="es-tab-close">${icons.x(10)}</button>
                </div>
                <div class="es-tab es-tab-active" data-panel="scene">
                    <span class="es-tab-label">Scene</span>
                    <button class="es-tab-close">${icons.x(10)}</button>
                </div>
                <div class="es-tab es-tab-active" data-panel="inspector">
                    <span class="es-tab-label">Inspector</span>
                    <button class="es-tab-close">${icons.x(10)}</button>
                </div>
            </div>
            <div class="es-editor-body">
                <div class="es-editor-main">
                    <div class="es-editor-left">
                        <div class="es-hierarchy-container"></div>
                    </div>
                    <div class="es-editor-center">
                        <div class="es-sceneview-container"></div>
                    </div>
                    <div class="es-editor-right">
                        <div class="es-inspector-container"></div>
                    </div>
                </div>
                <div class="es-editor-bottom">
                    <div class="es-content-browser-container"></div>
                    <div class="es-output-container" style="display: none;">
                        <div class="es-output-panel">
                            <div class="es-output-header">
                                <span class="es-output-title">${icons.list(14)} Output</span>
                                <div class="es-output-actions">
                                    <button class="es-btn es-btn-icon" title="Clear">${icons.trash(12)}</button>
                                </div>
                            </div>
                            <div class="es-output-content">
                                <div class="es-output-empty">No output messages</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="es-editor-statusbar">
                <div class="es-statusbar-left">
                    <button class="es-btn-dropdown es-active" data-action="toggle-assets">
                        ${icons.folder(12)}
                        <span>Assets</span>
                        ${icons.chevronDown(10)}
                    </button>
                    <button class="es-btn-tab" data-action="toggle-output">
                        ${icons.list(12)}
                        <span>Output</span>
                    </button>
                </div>
                <div class="es-statusbar-right">
                    <div class="es-statusbar-icons">
                        <button title="Grid">${icons.hash(12)}</button>
                    </div>
                    <span class="es-status-indicator es-status-saved">
                        ${icons.check(12)}
                        <span>Saved</span>
                    </span>
                </div>
            </div>
        `;

        const hierarchyContainer = this.container_.querySelector('.es-hierarchy-container') as HTMLElement;
        const inspectorContainer = this.container_.querySelector('.es-inspector-container') as HTMLElement;
        const sceneViewContainer = this.container_.querySelector('.es-sceneview-container') as HTMLElement;
        const contentBrowserContainer = this.container_.querySelector('.es-content-browser-container') as HTMLElement;

        this.hierarchyPanel_ = new HierarchyPanel(hierarchyContainer, this.store_);
        this.inspectorPanel_ = new InspectorPanel(inspectorContainer, this.store_);
        this.sceneViewPanel_ = new SceneViewPanel(sceneViewContainer, this.store_, {
            projectPath: this.projectPath_ ?? undefined,
        });
        this.contentBrowserPanel_ = new ContentBrowserPanel(contentBrowserContainer, this.store_, {
            projectPath: this.projectPath_ ?? undefined,
            onOpenScene: (scenePath) => this.openSceneFromPath(scenePath),
        });

        (window as any).__esengine_editor = this;

        this.setupToolbarEvents();
        this.setupStatusbarEvents();
        this.store_.subscribe(() => this.updateToolbarState());
        this.store_.subscribe(() => this.updateStatusbar());
    }

    private setupToolbarEvents(): void {
        const toolbar = this.container_.querySelector('.es-editor-toolbar');
        if (!toolbar) return;

        toolbar.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.action;

            switch (action) {
                case 'new':
                    this.newScene();
                    break;
                case 'open':
                    this.loadScene();
                    break;
                case 'save':
                    this.saveScene();
                    break;
                case 'undo':
                    this.store_.undo();
                    break;
                case 'redo':
                    this.store_.redo();
                    break;
                case 'preview':
                    this.startPreview();
                    break;
            }
        });
    }

    private updateToolbarState(): void {
        const undoBtn = this.container_.querySelector('[data-action="undo"]') as HTMLButtonElement;
        const redoBtn = this.container_.querySelector('[data-action="redo"]') as HTMLButtonElement;

        if (undoBtn) {
            undoBtn.disabled = !this.store_.canUndo;
        }
        if (redoBtn) {
            redoBtn.disabled = !this.store_.canRedo;
        }
    }

    private setupKeyboardShortcuts(): void {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) {
                            this.store_.redo();
                        } else {
                            this.store_.undo();
                        }
                        break;
                    case 'y':
                        e.preventDefault();
                        this.store_.redo();
                        break;
                    case 's':
                        e.preventDefault();
                        this.saveScene();
                        break;
                    case 'o':
                        e.preventDefault();
                        this.loadScene();
                        break;
                    case 'n':
                        e.preventDefault();
                        this.newScene();
                        break;
                }
            } else if (e.key === 'Delete') {
                const selected = this.store_.selectedEntity;
                if (selected !== null) {
                    this.store_.deleteEntity(selected);
                }
            }
        });
    }

    private setupStatusbarEvents(): void {
        const statusbar = this.container_.querySelector('.es-editor-statusbar');
        if (!statusbar) return;

        statusbar.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action]') as HTMLElement;
            if (!btn) return;

            const action = btn.dataset.action;
            if (action === 'toggle-assets') {
                this.toggleAssetsPanel();
            } else if (action === 'toggle-output') {
                this.toggleOutputPanel();
            }
        });
    }

    private toggleAssetsPanel(): void {
        const assetsBtn = this.container_.querySelector('[data-action="toggle-assets"]');
        const outputBtn = this.container_.querySelector('[data-action="toggle-output"]');
        const contentBrowser = this.container_.querySelector('.es-content-browser-container') as HTMLElement;
        const outputPanel = this.container_.querySelector('.es-output-container') as HTMLElement;
        const bottomPanel = this.container_.querySelector('.es-editor-bottom') as HTMLElement;

        if (this.assetsPanelVisible_) {
            this.assetsPanelVisible_ = false;
            assetsBtn?.classList.remove('es-active');
            if (contentBrowser) contentBrowser.style.display = 'none';
            if (bottomPanel) bottomPanel.style.display = this.outputPanelVisible_ ? '' : 'none';
        } else {
            this.assetsPanelVisible_ = true;
            this.outputPanelVisible_ = false;
            assetsBtn?.classList.add('es-active');
            outputBtn?.classList.remove('es-active');
            if (contentBrowser) contentBrowser.style.display = '';
            if (outputPanel) outputPanel.style.display = 'none';
            if (bottomPanel) bottomPanel.style.display = '';
        }

        requestAnimationFrame(() => this.sceneViewPanel_?.resize());
    }

    private toggleOutputPanel(): void {
        const assetsBtn = this.container_.querySelector('[data-action="toggle-assets"]');
        const outputBtn = this.container_.querySelector('[data-action="toggle-output"]');
        const contentBrowser = this.container_.querySelector('.es-content-browser-container') as HTMLElement;
        const outputPanel = this.container_.querySelector('.es-output-container') as HTMLElement;
        const bottomPanel = this.container_.querySelector('.es-editor-bottom') as HTMLElement;

        if (this.outputPanelVisible_) {
            this.outputPanelVisible_ = false;
            outputBtn?.classList.remove('es-active');
            if (outputPanel) outputPanel.style.display = 'none';
            if (bottomPanel) bottomPanel.style.display = this.assetsPanelVisible_ ? '' : 'none';
        } else {
            this.outputPanelVisible_ = true;
            this.assetsPanelVisible_ = false;
            outputBtn?.classList.add('es-active');
            assetsBtn?.classList.remove('es-active');
            if (outputPanel) outputPanel.style.display = '';
            if (contentBrowser) contentBrowser.style.display = 'none';
            if (bottomPanel) bottomPanel.style.display = '';
        }

        requestAnimationFrame(() => this.sceneViewPanel_?.resize());
    }

    private updateStatusbar(): void {
        const savedIndicator = this.container_.querySelector('.es-status-saved');
        const unsavedIndicator = this.container_.querySelector('.es-status-unsaved');

        if (this.store_.isDirty) {
            savedIndicator?.classList.add('es-hidden');
            if (unsavedIndicator) {
                unsavedIndicator.classList.remove('es-hidden');
            }
        } else {
            savedIndicator?.classList.remove('es-hidden');
            if (unsavedIndicator) {
                unsavedIndicator.classList.add('es-hidden');
            }
        }
    }

    dispose(): void {
        this.hierarchyPanel_?.dispose();
        this.inspectorPanel_?.dispose();
        this.sceneViewPanel_?.dispose();
        this.contentBrowserPanel_?.dispose();
    }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createEditor(container: HTMLElement, options?: EditorOptions): Editor {
    return new Editor(container, options);
}
