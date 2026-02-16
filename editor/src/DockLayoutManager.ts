import {
    createDockview,
    themeDark,
    type DockviewApi,
    type IContentRenderer,
    type GroupPanelPartInitParameters,
    type SerializedDockview,
} from 'dockview-core';
import type { EditorStore } from './store/EditorStore';
import { getPanel, type PanelDescriptor } from './panels/PanelRegistry';
import type { PanelManager } from './PanelManager';

const LAYOUT_STORAGE_KEY = 'esengine.editor.layout';

class EditorPanelRenderer implements IContentRenderer {
    private readonly element_: HTMLElement;
    private panelId_: string;
    private panelManager_: PanelManager;
    private store_: EditorStore;

    get element(): HTMLElement {
        return this.element_;
    }

    constructor(panelId: string, panelManager: PanelManager, store: EditorStore) {
        this.panelId_ = panelId;
        this.panelManager_ = panelManager;
        this.store_ = store;
        this.element_ = document.createElement('div');
        this.element_.className = 'es-panel-container';
        this.element_.dataset.panelId = panelId;
        this.element_.style.width = '100%';
        this.element_.style.height = '100%';
        this.element_.style.overflow = 'hidden';
    }

    init(_params: GroupPanelPartInitParameters): void {
        this.panelManager_.createPanelInContainer(this.panelId_, this.element_, this.store_);
    }

    dispose(): void {
        this.panelManager_.removePanelInstance(this.panelId_);
    }
}

export class DockLayoutManager {
    private api_: DockviewApi | null = null;
    private panelManager_: PanelManager;
    private store_: EditorStore;
    private layoutChangeDisposable_: { dispose(): void } | null = null;

    constructor(panelManager: PanelManager, store: EditorStore) {
        this.panelManager_ = panelManager;
        this.store_ = store;
    }

    get api(): DockviewApi | null {
        return this.api_;
    }

    initialize(container: HTMLElement): void {
        this.api_ = createDockview(container, {
            theme: themeDark,
            createComponent: (options) => {
                return new EditorPanelRenderer(
                    options.id,
                    this.panelManager_,
                    this.store_,
                );
            },
            disableFloatingGroups: true,
        });

        const saved = this.loadSavedLayout();
        if (saved) {
            try {
                this.api_.fromJSON(saved);
                this.startSavingLayout();
                return;
            } catch {
                localStorage.removeItem(LAYOUT_STORAGE_KEY);
            }
        }

        this.applyDefaultLayout();
        this.startSavingLayout();
    }

    private applyDefaultLayout(): void {
        if (!this.api_) return;

        this.api_.addPanel({
            id: 'hierarchy',
            component: 'hierarchy',
            title: 'Hierarchy',
            initialWidth: 250,
        });

        this.api_.addPanel({
            id: 'scene',
            component: 'scene',
            title: 'Scene',
            position: { referencePanel: 'hierarchy', direction: 'right' },
        });

        this.api_.addPanel({
            id: 'inspector',
            component: 'inspector',
            title: 'Inspector',
            position: { referencePanel: 'scene', direction: 'right' },
            initialWidth: 260,
        });
    }

    private startSavingLayout(): void {
        if (!this.api_) return;
        this.layoutChangeDisposable_ = this.api_.onDidLayoutChange(() => {
            this.saveLayout();
        });
    }

    saveLayout(): void {
        if (!this.api_) return;
        try {
            const json = this.api_.toJSON();
            localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(json));
        } catch {
            // ignore serialization failures
        }
    }

    private loadSavedLayout(): SerializedDockview | null {
        try {
            const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch {
            // ignore parse failures
        }
        return null;
    }

    resetLayout(): void {
        if (!this.api_) return;
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        this.api_.clear();
        this.applyDefaultLayout();
    }

    showPanel(id: string): void {
        if (!this.api_) return;

        let panel = this.api_.getPanel(id);
        if (!panel) {
            const desc = getPanel(id);
            if (!desc) return;
            this.api_.addPanel({
                id: desc.id,
                component: desc.id,
                title: desc.title,
                position: { referencePanel: 'scene', direction: 'below' },
                initialHeight: 200,
            });
            panel = this.api_.getPanel(id);
        }
        panel?.api.setActive();
    }

    addPanel(desc: PanelDescriptor): void {
        if (!this.api_) return;

        const existing = this.api_.getPanel(desc.id);
        if (existing) return;

        const position = desc.position ?? 'bottom';
        let referenceId = 'scene';
        if (position === 'left') referenceId = 'hierarchy';
        else if (position === 'right') referenceId = 'inspector';

        const refPanel = this.api_.getPanel(referenceId);
        if (!refPanel) return;

        const direction = position === 'bottom' ? 'below' : undefined;

        this.api_.addPanel({
            id: desc.id,
            component: desc.id,
            title: desc.title,
            position: direction
                ? { referencePanel: refPanel, direction }
                : { referencePanel: refPanel },
            inactive: true,
        });
    }

    removePanel(id: string): void {
        if (!this.api_) return;
        const panel = this.api_.getPanel(id);
        if (panel) {
            this.api_.removePanel(panel);
        }
    }

    dispose(): void {
        this.layoutChangeDisposable_?.dispose();
        this.layoutChangeDisposable_ = null;
        this.api_?.dispose();
        this.api_ = null;
    }
}
