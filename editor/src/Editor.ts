/**
 * @file    Editor.ts
 * @brief   Main editor component
 */

import type { App, Entity } from 'esengine';
import { EditorStore } from './store/EditorStore';
import { EditorBridge } from './bridge/EditorBridge';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { InspectorPanel } from './panels/InspectorPanel';
import { SceneViewPanel } from './panels/SceneViewPanel';
import { ContentBrowserPanel, type ContentBrowserOptions } from './panels/ContentBrowserPanel';
import { registerBuiltinEditors } from './property/editors';
import { registerBuiltinSchemas } from './schemas/ComponentSchemas';
import { initBoundsProviders } from './bounds';
import { saveSceneToFile, saveSceneToPath, loadSceneFromFile, loadSceneFromPath, hasFileHandle, clearFileHandle } from './io/SceneSerializer';
import { icons } from './utils/icons';
import { ScriptLoader } from './scripting';
import { PreviewService } from './preview';
import { showBuildSettingsDialog, BuildService } from './builder';

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
        initBoundsProviders();

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

    get currentScenePath(): string | null {
        return this.store_.filePath;
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

    async loadScene(): Promise<void> {
        const scene = await loadSceneFromFile();
        if (scene) {
            this.store_.loadScene(scene);
        }
    }

    async openSceneFromPath(scenePath: string): Promise<void> {
        const scene = await loadSceneFromPath(scenePath);
        if (scene) {
            this.store_.loadScene(scene, scenePath);
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
            await this.scriptLoader_.compile();
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
            <div class="es-editor-menubar">
                <div class="es-menubar-logo">${icons.logo(24)}</div>
                <div class="es-menu" data-menu="file">
                    <div class="es-menu-trigger">File</div>
                    <div class="es-menu-dropdown">
                        <div class="es-menu-item" data-action="new">
                            <span class="es-menu-item-text">New Scene</span>
                            <span class="es-menu-item-shortcut">Ctrl+N</span>
                        </div>
                        <div class="es-menu-item" data-action="open">
                            <span class="es-menu-item-text">Open...</span>
                            <span class="es-menu-item-shortcut">Ctrl+O</span>
                        </div>
                        <div class="es-menu-divider"></div>
                        <div class="es-menu-item" data-action="save">
                            <span class="es-menu-item-text">Save</span>
                            <span class="es-menu-item-shortcut">Ctrl+S</span>
                        </div>
                        <div class="es-menu-item" data-action="save-as">
                            <span class="es-menu-item-text">Save As...</span>
                            <span class="es-menu-item-shortcut">Ctrl+Shift+S</span>
                        </div>
                        <div class="es-menu-divider"></div>
                        <div class="es-menu-item" data-action="build-settings">
                            <span class="es-menu-item-text">Build Settings...</span>
                            <span class="es-menu-item-shortcut">Ctrl+Shift+B</span>
                        </div>
                    </div>
                </div>
                <div class="es-menu" data-menu="edit">
                    <div class="es-menu-trigger">Edit</div>
                    <div class="es-menu-dropdown">
                        <div class="es-menu-item" data-action="undo">
                            <span class="es-menu-item-text">Undo</span>
                            <span class="es-menu-item-shortcut">Ctrl+Z</span>
                        </div>
                        <div class="es-menu-item" data-action="redo">
                            <span class="es-menu-item-text">Redo</span>
                            <span class="es-menu-item-shortcut">Ctrl+Y</span>
                        </div>
                        <div class="es-menu-divider"></div>
                        <div class="es-menu-item" data-action="delete">
                            <span class="es-menu-item-text">Delete</span>
                            <span class="es-menu-item-shortcut">Delete</span>
                        </div>
                        <div class="es-menu-item" data-action="duplicate">
                            <span class="es-menu-item-text">Duplicate</span>
                            <span class="es-menu-item-shortcut">Ctrl+D</span>
                        </div>
                    </div>
                </div>
                <div class="es-menu" data-menu="view">
                    <div class="es-menu-trigger">View</div>
                    <div class="es-menu-dropdown">
                        <div class="es-menu-item" data-action="toggle-hierarchy">
                            <span class="es-menu-item-text">Hierarchy</span>
                        </div>
                        <div class="es-menu-item" data-action="toggle-inspector">
                            <span class="es-menu-item-text">Inspector</span>
                        </div>
                        <div class="es-menu-item" data-action="toggle-assets">
                            <span class="es-menu-item-text">Content Browser</span>
                        </div>
                        <div class="es-menu-item" data-action="toggle-output">
                            <span class="es-menu-item-text">Output</span>
                        </div>
                    </div>
                </div>
                <div class="es-menu" data-menu="help">
                    <div class="es-menu-trigger">Help</div>
                    <div class="es-menu-dropdown">
                        <div class="es-menu-item" data-action="docs">
                            <span class="es-menu-item-text">Documentation</span>
                        </div>
                        <div class="es-menu-divider"></div>
                        <div class="es-menu-item" data-action="about">
                            <span class="es-menu-item-text">About ESEngine</span>
                        </div>
                    </div>
                </div>
                <div class="es-menubar-spacer"></div>
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
                    <button class="es-statusbar-btn es-statusbar-btn-primary es-active" data-action="toggle-assets">
                        ${icons.folder(12)}
                        <span>Content Browser</span>
                        ${icons.chevronDown(10)}
                    </button>
                    <button class="es-statusbar-btn" data-action="toggle-output">
                        ${icons.list(12)}
                        <span>Output</span>
                    </button>
                    <div class="es-statusbar-divider"></div>
                    <span class="es-cmd-prompt">&gt;</span>
                    <input type="text" class="es-cmd-input" placeholder="pnpm install, npm run build..." />
                </div>
                <div class="es-statusbar-right">
                    <button class="es-statusbar-btn" data-action="undo" title="Undo">
                        <span>Undo</span>
                    </button>
                    <div class="es-statusbar-icons">
                        <button title="Notifications">${icons.list(12)}</button>
                        <button title="Extensions">${icons.grid(12)}</button>
                        <button title="Settings">${icons.settings(12)}</button>
                    </div>
                    <span class="es-status-indicator es-status-saved">
                        ${icons.check(12)}
                        <span>All Saved</span>
                    </span>
                    <div class="es-statusbar-divider"></div>
                    <span class="es-status-indicator">
                        <span>Version Control</span>
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

            const action = menuItem.dataset.action;
            if (menuItem.classList.contains('es-disabled')) return;

            closeAllMenus();
            this.handleMenuAction(action);
        });

        const previewBtn = menubar.querySelector('[data-action="preview"]');
        previewBtn?.addEventListener('click', () => this.startPreview());

        document.addEventListener('click', (e) => {
            if (!menubar.contains(e.target as Node)) {
                closeAllMenus();
            }
        });
    }

    private handleMenuAction(action: string | undefined): void {
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
            case 'save-as':
                this.saveSceneAs();
                break;
            case 'undo':
                this.store_.undo();
                break;
            case 'redo':
                this.store_.redo();
                break;
            case 'delete':
                if (this.store_.selectedEntity !== null) {
                    this.store_.deleteEntity(this.store_.selectedEntity);
                }
                break;
            case 'duplicate':
                this.duplicateSelected();
                break;
            case 'toggle-hierarchy':
            case 'toggle-inspector':
            case 'toggle-assets':
                this.toggleAssetsPanel();
                break;
            case 'toggle-output':
                this.toggleOutputPanel();
                break;
            case 'docs':
                window.open('https://github.com/nicholaswan/ESEngine', '_blank');
                break;
            case 'about':
                this.showAboutDialog();
                break;
            case 'build-settings':
                this.showBuildSettings();
                break;
        }
    }

    private showBuildSettings(): void {
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

    private async saveSceneAs(): Promise<void> {
        clearFileHandle();
        const savedPath = await saveSceneToFile(this.store_.scene);
        if (savedPath) {
            this.store_.markSaved(savedPath);
        }
    }

    private duplicateSelected(): void {
        const entity = this.store_.selectedEntity;
        if (entity === null) return;

        const entityData = this.store_.scene.entities.find(e => e.id === entity);
        if (!entityData) return;

        const newEntity = this.store_.createEntity(
            `${entityData.name}_copy`,
            entityData.parent as Entity | null
        );

        for (const comp of entityData.components) {
            this.store_.addComponent(newEntity, comp.type, { ...comp.data });
        }
    }

    private showAboutDialog(): void {
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
                    <p style="margin: 0 0 16px; color: var(--es-text-secondary);">Version 0.1.0</p>
                    <p style="margin: 0; font-size: 12px; color: var(--es-text-secondary);">
                        A lightweight 2D game engine<br>for web and mini-programs.
                    </p>
                </div>
                <div class="es-dialog-footer" style="justify-content: center;">
                    <button class="es-dialog-btn es-dialog-btn-primary">OK</button>
                </div>
            </div>
        `;

        const close = () => overlay.remove();
        overlay.querySelector('.es-dialog-close')?.addEventListener('click', close);
        overlay.querySelector('.es-dialog-btn')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        document.body.appendChild(overlay);
    }

    private updateToolbarState(): void {
        const undoItem = this.container_.querySelector('[data-action="undo"]');
        const redoItem = this.container_.querySelector('[data-action="redo"]');
        const deleteItem = this.container_.querySelector('[data-action="delete"]');
        const duplicateItem = this.container_.querySelector('[data-action="duplicate"]');

        undoItem?.classList.toggle('es-disabled', !this.store_.canUndo);
        redoItem?.classList.toggle('es-disabled', !this.store_.canRedo);

        const hasSelection = this.store_.selectedEntity !== null;
        deleteItem?.classList.toggle('es-disabled', !hasSelection);
        duplicateItem?.classList.toggle('es-disabled', !hasSelection);
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
                        if (e.shiftKey) {
                            this.saveSceneAs();
                        } else {
                            this.saveScene();
                        }
                        break;
                    case 'o':
                        e.preventDefault();
                        this.loadScene();
                        break;
                    case 'n':
                        e.preventDefault();
                        this.newScene();
                        break;
                    case 'd':
                        e.preventDefault();
                        this.duplicateSelected();
                        break;
                    case 'b':
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.showBuildSettings();
                        }
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
            } else if (action === 'undo') {
                this.store_.undo();
            }
        });

        const cmdInput = statusbar.querySelector('.es-cmd-input') as HTMLInputElement;

        cmdInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const command = cmdInput.value.trim();
                if (command) {
                    this.executeShellCommand(command);
                    cmdInput.value = '';
                }
            }
        });
    }

    private async executeShellCommand(fullCommand: string): Promise<void> {
        if (!this.projectPath_) {
            this.appendOutput('Error: No project loaded\n', 'error');
            return;
        }

        const shell = (window as any).__esengine_shell;
        if (!shell) {
            this.appendOutput('Error: Shell not available\n', 'error');
            return;
        }

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');

        this.outputPanelVisible_ = true;
        this.assetsPanelVisible_ = false;
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

    private appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        const outputContent = this.container_.querySelector('.es-output-content');
        if (!outputContent) return;

        const empty = outputContent.querySelector('.es-output-empty');
        if (empty) empty.remove();

        const line = document.createElement('div');
        line.className = `es-output-line es-output-${type}`;
        line.textContent = text;
        outputContent.appendChild(line);
        outputContent.scrollTop = outputContent.scrollHeight;
    }

    private updateBottomPanelVisibility(): void {
        const assetsBtn = this.container_.querySelector('[data-action="toggle-assets"]');
        const outputBtn = this.container_.querySelector('[data-action="toggle-output"]');
        const contentBrowser = this.container_.querySelector('.es-content-browser-container') as HTMLElement;
        const outputPanel = this.container_.querySelector('.es-output-container') as HTMLElement;
        const bottomPanel = this.container_.querySelector('.es-editor-bottom') as HTMLElement;

        assetsBtn?.classList.toggle('es-active', this.assetsPanelVisible_);
        outputBtn?.classList.toggle('es-active', this.outputPanelVisible_);

        if (contentBrowser) contentBrowser.style.display = this.assetsPanelVisible_ ? '' : 'none';
        if (outputPanel) outputPanel.style.display = this.outputPanelVisible_ ? '' : 'none';
        if (bottomPanel) bottomPanel.style.display = (this.assetsPanelVisible_ || this.outputPanelVisible_) ? '' : 'none';

        requestAnimationFrame(() => this.sceneViewPanel_?.resize());
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
