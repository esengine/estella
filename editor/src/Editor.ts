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
import { registerBuiltinEditors } from './property/editors';
import { registerBuiltinSchemas } from './schemas/ComponentSchemas';
import { saveSceneToFile, loadSceneFromFile } from './io/SceneSerializer';

// =============================================================================
// Editor
// =============================================================================

export class Editor {
    private container_: HTMLElement;
    private app_: App | null = null;
    private store_: EditorStore;
    private bridge_: EditorBridge | null = null;

    private hierarchyPanel_: HierarchyPanel | null = null;
    private inspectorPanel_: InspectorPanel | null = null;
    private sceneViewPanel_: SceneViewPanel | null = null;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.store_ = new EditorStore();

        registerBuiltinEditors();
        registerBuiltinSchemas();

        this.setupLayout();
        this.setupKeyboardShortcuts();
    }

    setApp(app: App): void {
        this.app_ = app;
        this.bridge_ = new EditorBridge(app, this.store_);

        if (this.sceneViewPanel_) {
            this.sceneViewPanel_.setBridge(this.bridge_);
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

    // =========================================================================
    // Private Methods
    // =========================================================================

    private setupLayout(): void {
        this.container_.className = 'es-editor';
        this.container_.innerHTML = `
            <div class="es-editor-toolbar">
                <button class="es-btn" data-action="new">New</button>
                <button class="es-btn" data-action="open">Open</button>
                <button class="es-btn" data-action="save">Save</button>
                <div class="es-toolbar-spacer"></div>
                <button class="es-btn" data-action="undo" disabled>Undo</button>
                <button class="es-btn" data-action="redo" disabled>Redo</button>
            </div>
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
        `;

        const hierarchyContainer = this.container_.querySelector('.es-hierarchy-container') as HTMLElement;
        const inspectorContainer = this.container_.querySelector('.es-inspector-container') as HTMLElement;
        const sceneViewContainer = this.container_.querySelector('.es-sceneview-container') as HTMLElement;

        this.hierarchyPanel_ = new HierarchyPanel(hierarchyContainer, this.store_);
        this.inspectorPanel_ = new InspectorPanel(inspectorContainer, this.store_);
        this.sceneViewPanel_ = new SceneViewPanel(sceneViewContainer, this.store_);

        this.setupToolbarEvents();
        this.store_.subscribe(() => this.updateToolbarState());
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

    dispose(): void {
        this.hierarchyPanel_?.dispose();
        this.inspectorPanel_?.dispose();
        this.sceneViewPanel_?.dispose();
    }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createEditor(container: HTMLElement): Editor {
    return new Editor(container);
}
