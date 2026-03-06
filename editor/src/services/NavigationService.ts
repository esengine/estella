import type { PanelManager } from '../PanelManager';
import type { DockLayoutManager } from '../DockLayoutManager';
import type { ContentDrawer } from '../ui/ContentDrawer';
import type { EditorAssetServer } from '../asset/EditorAssetServer';

export type NavigateToAssetHandler = (path: string) => Promise<void>;
export type AssetServerProvider = () => EditorAssetServer | null;

export class NavigationService {
    private panelManager_: PanelManager;
    private dockLayout_: DockLayoutManager | null = null;
    private contentDrawer_: ContentDrawer | null = null;
    private navigateHandler_: NavigateToAssetHandler | null = null;
    private assetServerProvider_: AssetServerProvider | null = null;

    constructor(panelManager: PanelManager) {
        this.panelManager_ = panelManager;
    }

    setDockLayout(dockLayout: DockLayoutManager | null): void {
        this.dockLayout_ = dockLayout;
    }

    setContentDrawer(contentDrawer: ContentDrawer | null): void {
        this.contentDrawer_ = contentDrawer;
    }

    registerNavigateToAsset(handler: NavigateToAssetHandler): () => void {
        this.navigateHandler_ = handler;
        return () => { this.navigateHandler_ = null; };
    }

    registerAssetServerProvider(provider: AssetServerProvider): () => void {
        this.assetServerProvider_ = provider;
        return () => { this.assetServerProvider_ = null; };
    }

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

    async navigateToAsset(assetPath: string): Promise<void> {
        await this.navigateHandler_?.(assetPath);
    }

    getAssetServer(): EditorAssetServer | null {
        return this.assetServerProvider_?.() ?? null;
    }
}
