import type { PanelManager } from '../PanelManager';
import type { DockLayoutManager } from '../DockLayoutManager';
import type { EditorAssetServer } from '../asset/EditorAssetServer';
import type { EditorStore } from '../store/EditorStore';
import { getPanel, getAllPanels, getPanelsByPosition, type PanelPosition } from '../panels/PanelRegistry';
import type { RegionId } from '../dock/DockRegion';

export type NavigateToAssetHandler = (path: string) => Promise<void>;
export type AssetServerProvider = () => EditorAssetServer | null;

type CollapsibleRegion = 'left' | 'right' | 'bottom';

const POSITION_TO_REGION: Record<PanelPosition, CollapsibleRegion | null> = {
    left: 'left',
    right: 'right',
    bottom: 'bottom',
    center: null,
};

const SIDEBAR_REGIONS: CollapsibleRegion[] = ['left', 'right'];

export class NavigationService {
    private panelManager_: PanelManager;
    private dockLayout_: DockLayoutManager | null = null;
    private navigateHandler_: NavigateToAssetHandler | null = null;
    private assetServerProvider_: AssetServerProvider | null = null;

    private lastActiveBottom_: string | null = null;
    private panelToggleListeners_: Array<() => void> = [];
    private contextDebounceTimer_: ReturnType<typeof setTimeout> | null = null;
    private storeUnsubscribe_: (() => void) | null = null;
    private activeContextPanels_ = new Set<string>();

    constructor(panelManager: PanelManager) {
        this.panelManager_ = panelManager;
    }

    setDockLayout(dockLayout: DockLayoutManager | null): void {
        this.dockLayout_ = dockLayout;
    }

    registerNavigateToAsset(handler: NavigateToAssetHandler): () => void {
        this.navigateHandler_ = handler;
        return () => { this.navigateHandler_ = null; };
    }

    registerAssetServerProvider(provider: AssetServerProvider): () => void {
        this.assetServerProvider_ = provider;
        return () => { this.assetServerProvider_ = null; };
    }

    // =========================================================================
    // Context-sensitive panels
    // =========================================================================

    initContextPanels(store: EditorStore): void {
        this.storeUnsubscribe_?.();
        this.storeUnsubscribe_ = store.subscribe(() => {
            if (this.contextDebounceTimer_) clearTimeout(this.contextDebounceTimer_);
            this.contextDebounceTimer_ = setTimeout(() => {
                this.updateContextPanels_(store);
            }, 100);
        });
    }

    private updateContextPanels_(store: EditorStore): void {
        if (!this.dockLayout_) return;

        for (const desc of getAllPanels()) {
            if (!desc.contextMatch) continue;

            const matches = desc.contextMatch(store);
            const isInDock = !!this.dockLayout_.findPanelRegion(desc.id);
            const isPinned = this.dockLayout_.isPanelPinned(desc.id);

            if (matches && !isInDock) {
                this.dockLayout_.showPanel(desc.id);
                this.activeContextPanels_.add(desc.id);
                if (!this.dockLayout_.isRegionCollapsed('bottom')) {
                    this.dockLayout_.dock?.activatePanel(desc.id);
                } else {
                    this.expandBottomRegion_(desc.id);
                }
            } else if (!matches && isInDock && !isPinned && this.activeContextPanels_.has(desc.id)) {
                this.dockLayout_.removePanel(desc.id);
                this.activeContextPanels_.delete(desc.id);
                this.notifyToggleListeners_();
            }
        }
    }

    // =========================================================================
    // Panel visibility
    // =========================================================================

    showPanel(id: string): void {
        const region = this.getRegion_(id);
        if (!region) {
            this.dockLayout_?.showPanel(id);
            return;
        }

        if (region === 'bottom') {
            this.expandBottomRegion_(id);
        } else {
            this.expandRegion_(region);
            this.dockLayout_?.dock?.activatePanel(id);
        }
    }

    hidePanel(id: string): void {
        this.panelManager_.hidePanel(id);
    }

    togglePanel(id: string): void {
        const region = this.getRegion_(id);
        if (!region) {
            this.dockLayout_?.showPanel(id);
            return;
        }

        const desc = getPanel(id);
        if (desc?.contextMatch) {
            const isInDock = !!this.dockLayout_?.findPanelRegion(id);
            if (!isInDock) {
                this.dockLayout_?.setPanelPinned(id, true);
            } else {
                this.dockLayout_?.setPanelPinned(id, false);
                this.activeContextPanels_.delete(id);
            }
        }

        if (region === 'bottom') {
            this.toggleBottomPanel_(id);
        } else {
            this.toggleSidePanel_(id, region);
        }
    }

    toggleRegion(region: CollapsibleRegion): void {
        if (region === 'bottom') {
            this.toggleBottomRegion_();
        } else {
            if (this.dockLayout_?.isRegionCollapsed(region)) {
                this.expandRegion_(region);
            } else {
                this.collapseRegion_(region);
            }
        }
    }

    toggleAllSidebars(): void {
        const anyVisible = SIDEBAR_REGIONS.some(r => !this.dockLayout_?.isRegionCollapsed(r));

        for (const r of SIDEBAR_REGIONS) {
            if (anyVisible) {
                if (!this.dockLayout_?.isRegionCollapsed(r)) this.collapseRegion_(r);
            } else {
                if (this.dockLayout_?.isRegionCollapsed(r)) this.expandRegion_(r);
            }
        }
    }

    isCollapsed(id: string): boolean {
        if (!this.dockLayout_) return false;
        const actualRegion = this.dockLayout_.findPanelRegion(id);
        if (actualRegion) return this.dockLayout_.isRegionCollapsed(actualRegion);

        const region = this.getRegion_(id);
        return region ? this.dockLayout_.isRegionCollapsed(region) : false;
    }

    isRegionCollapsed(region: CollapsibleRegion): boolean {
        return this.dockLayout_?.isRegionCollapsed(region) ?? false;
    }

    isBottomCollapsed(): boolean {
        return this.isRegionCollapsed('bottom');
    }

    resetLayout(): void {
        this.lastActiveBottom_ = null;
        this.dockLayout_?.resetLayout();
        this.notifyToggleListeners_();
    }

    onPanelToggle(listener: () => void): () => void {
        this.panelToggleListeners_.push(listener);
        return () => {
            const idx = this.panelToggleListeners_.indexOf(listener);
            if (idx >= 0) this.panelToggleListeners_.splice(idx, 1);
        };
    }

    // =========================================================================
    // Navigation
    // =========================================================================

    async navigateToAsset(assetPath: string): Promise<void> {
        await this.navigateHandler_?.(assetPath);
    }

    getAssetServer(): EditorAssetServer | null {
        return this.assetServerProvider_?.() ?? null;
    }

    // =========================================================================
    // Private: side panels (left / right)
    // =========================================================================

    private toggleSidePanel_(id: string, region: CollapsibleRegion): void {
        if (!this.dockLayout_) return;

        if (this.dockLayout_.isRegionCollapsed(region)) {
            this.expandRegion_(region);
            this.ensureAndActivate_(id);
        } else if (this.dockLayout_.isPanelActive(id)) {
            this.collapseRegion_(region);
        } else {
            this.ensureAndActivate_(id);
        }
        this.notifyToggleListeners_();
    }

    private collapseRegion_(region: CollapsibleRegion): void {
        this.dockLayout_?.collapseRegion(region);
        this.notifyToggleListeners_();
    }

    private expandRegion_(region: CollapsibleRegion): void {
        this.dockLayout_?.expandRegion(region);
        this.notifyToggleListeners_();
    }

    // =========================================================================
    // Private: bottom region
    // =========================================================================

    private toggleBottomPanel_(id: string): void {
        if (!this.dockLayout_) return;

        if (this.dockLayout_.isRegionCollapsed('bottom')) {
            this.expandBottomRegion_(id);
            return;
        }

        if (this.dockLayout_.isPanelActive(id)) {
            this.lastActiveBottom_ = id;
            this.collapseRegion_('bottom');
        } else {
            this.ensureAndActivate_(id);
            this.lastActiveBottom_ = id;
            this.notifyToggleListeners_();
        }
    }

    private toggleBottomRegion_(): void {
        if (this.dockLayout_?.isRegionCollapsed('bottom')) {
            const restoreId = this.lastActiveBottom_ ?? 'content-browser';
            this.expandBottomRegion_(restoreId);
        } else {
            const activeId = this.dockLayout_?.dock?.bottomRegion.activeId;
            if (activeId) this.lastActiveBottom_ = activeId;
            this.collapseRegion_('bottom');
        }
    }

    private expandBottomRegion_(activeId: string): void {
        if (!this.dockLayout_) return;

        this.expandRegion_('bottom');
        this.ensureAndActivate_(activeId);
        this.lastActiveBottom_ = activeId;
        this.notifyToggleListeners_();
    }

    // =========================================================================
    // Private: utils
    // =========================================================================

    private getRegion_(panelId: string): CollapsibleRegion | null {
        const actualRegion = this.dockLayout_?.findPanelRegion(panelId);
        if (actualRegion && actualRegion !== 'center') return actualRegion as CollapsibleRegion;

        const desc = getPanel(panelId);
        if (!desc) return null;
        return POSITION_TO_REGION[desc.position];
    }

    private ensureAndActivate_(id: string): void {
        if (!this.dockLayout_) return;
        if (this.dockLayout_.findPanelRegion(id)) {
            this.dockLayout_.dock?.activatePanel(id);
        } else {
            this.dockLayout_.showPanel(id);
        }
    }

    private notifyToggleListeners_(): void {
        for (const fn of this.panelToggleListeners_) {
            fn();
        }
    }
}
