import { DockLayout, type DockLayoutCallbacks, type AreaId } from './dock/DockLayout';
import { type DockRegion, type RegionId } from './dock/DockRegion';
import type { EditorStore } from './store/EditorStore';
import { getPanel, getAllPanels, type PanelDescriptor, type PanelPosition } from './panels/PanelRegistry';
import type { PanelManager } from './PanelManager';
import { showContextMenu } from './ui/ContextMenu';

const NON_DETACHABLE_PANELS = new Set(['scene']);

const POSITION_TO_AREA: Record<PanelPosition, AreaId> = {
    left: 'left',
    center: 'center',
    right: 'right',
    bottom: 'bottom',
};

export interface DetachPanelHandler {
    detachPanel(panelId: string, title: string): Promise<void>;
    detachGameView(previewUrl: string): Promise<void>;
    isDetached(panelId: string): boolean;
}

export interface DetachContext {
    handler: DetachPanelHandler;
    getPreviewUrl: () => Promise<string | null>;
    onPanelClosed: (callback: (panelId: string) => void) => (() => void);
}

export class DockLayoutManager {
    private dock_: DockLayout | null = null;
    private panelManager_: PanelManager;
    private store_: EditorStore;
    private lastActivePanelId_: string | null = null;
    private detachContext_: DetachContext | null = null;
    private panelClosedUnlisten_: (() => void) | null = null;
    private pinnedPanels_ = new Set<string>();

    constructor(panelManager: PanelManager, store: EditorStore) {
        this.panelManager_ = panelManager;
        this.store_ = store;
    }

    get dock(): DockLayout | null {
        return this.dock_;
    }

    setDetachContext(context: DetachContext): void {
        this.detachContext_ = context;
        this.panelClosedUnlisten_ = context.onPanelClosed(() => {
            // Detached panel closed externally — user can re-open via View menu.
        });
    }

    initialize(container: HTMLElement): void {
        const callbacks: DockLayoutCallbacks = {
            onPanelActivated: (panelId) => {
                if (panelId === this.lastActivePanelId_) return;
                if (this.lastActivePanelId_) this.panelManager_.hidePanel(this.lastActivePanelId_);
                this.panelManager_.showPanel(panelId);
                this.lastActivePanelId_ = panelId;
            },
            onTabContextMenu: (panelId, region, x, y) => {
                this.showTabContextMenu_(panelId, region, x, y);
            },
            onTabClose: (panelId) => {
                this.removePanel(panelId);
            },
        };

        this.dock_ = new DockLayout(container, callbacks);
        this.applyDefaultLayout_();
    }

    private applyDefaultLayout_(): void {
        if (!this.dock_) return;

        const saved = this.dock_.getSerializedPanelOrder();

        if (saved) {
            const placed = new Set<string>();

            const areas: AreaId[] = ['left', 'center', 'right', 'bottom'];
            for (const areaId of areas) {
                const paneDataList = saved[areaId];
                if (!Array.isArray(paneDataList)) continue;

                const group = this.dock_.getGroup(areaId);

                for (let i = 0; i < paneDataList.length; i++) {
                    const paneData = paneDataList[i];
                    if (!paneData?.panels) continue;

                    const targetPane = (i === 0)
                        ? (group.panes[0] ?? group.addPane())
                        : group.addPane();

                    for (const panelId of paneData.panels) {
                        const desc = getPanel(panelId);
                        if (!desc || placed.has(panelId)) continue;
                        this.addPanelToRegion_(desc, targetPane);
                        placed.add(panelId);
                    }
                    if (paneData.active) {
                        targetPane.activate(paneData.active);
                    }
                }
            }

            const defaultPanels: Array<{ id: string; area: AreaId }> = [
                { id: 'hierarchy', area: 'left' },
                { id: 'scene', area: 'center' },
                { id: 'game', area: 'center' },
                { id: 'inspector', area: 'right' },
                { id: 'content-browser', area: 'bottom' },
                { id: 'output', area: 'bottom' },
            ];

            for (const dp of defaultPanels) {
                if (placed.has(dp.id)) continue;
                const desc = getPanel(dp.id);
                if (desc) this.addPanelToRegion_(desc, dp.area);
            }
        } else {
            this.addPanelToRegion_(getPanel('hierarchy')!, 'left');

            const centerGroup = this.dock_.getGroup('center');
            const scenePane = centerGroup.panes[0] ?? centerGroup.addPane();
            this.addPanelToRegion_(getPanel('scene')!, scenePane);

            const gamePane = centerGroup.addPane();
            this.addPanelToRegion_(getPanel('game')!, gamePane);

            this.addPanelToRegion_(getPanel('inspector')!, 'right');
            this.addPanelToRegion_(getPanel('content-browser')!, 'bottom');
            this.addPanelToRegion_(getPanel('output')!, 'bottom');

            scenePane.activate('scene');
            gamePane.activate('game');
        }
    }

    private addPanelToRegion_(desc: PanelDescriptor, regionOrId: DockRegion | AreaId): void {
        if (!this.dock_) return;

        const contentEl = document.createElement('div');
        contentEl.className = 'es-panel-container';
        contentEl.dataset.panelId = desc.id;

        if (typeof regionOrId === 'string') {
            const group = this.dock_.getGroup(regionOrId);
            const target = group.panes[0] ?? group.addPane();
            this.dock_.addPanel(target, { id: desc.id, title: desc.title, contentEl });
        } else {
            this.dock_.addPanel(regionOrId, { id: desc.id, title: desc.title, contentEl });
        }

        this.panelManager_.createPanelInContainer(desc.id, contentEl);
    }

    showPanel(id: string): void {
        if (!this.dock_) return;

        const region = this.dock_.findPanelRegion(id);
        if (region) {
            const area = this.dock_.findRegionArea(region);
            if (area && this.dock_.isRegionCollapsed(area)) this.dock_.expandRegion(area);
            region.activate(id);
            return;
        }

        const desc = getPanel(id);
        if (!desc) return;
        const areaId = POSITION_TO_AREA[desc.position];
        this.addPanelToRegion_(desc, areaId);
        if (this.dock_.isRegionCollapsed(areaId)) this.dock_.expandRegion(areaId);
        this.dock_.activatePanel(id);
    }

    removePanel(id: string): void {
        if (!this.dock_) return;
        const entry = this.dock_.removePanel(id);
        if (entry) {
            this.panelManager_.removePanelInstance(id);
        }
    }

    addPanel(desc: PanelDescriptor): void {
        if (!this.dock_) return;
        if (this.dock_.findPanelRegion(desc.id)) return;
        const areaId = POSITION_TO_AREA[desc.position];
        this.addPanelToRegion_(desc, areaId);
    }

    isPanelPinned(panelId: string): boolean {
        return this.pinnedPanels_.has(panelId);
    }

    setPanelPinned(panelId: string, pinned: boolean): void {
        if (pinned) {
            this.pinnedPanels_.add(panelId);
        } else {
            this.pinnedPanels_.delete(panelId);
        }
    }

    resetLayout(): void {
        this.pinnedPanels_.clear();
        this.dock_?.resetLayout();
    }

    saveLayout(): void {
        this.dock_?.saveLayout();
    }

    findPanelRegion(panelId: string): RegionId | null {
        return this.dock_?.findPanelRegion(panelId)?.id ?? null;
    }

    collapseRegion(regionId: RegionId): void {
        this.dock_?.collapseRegion(regionId as AreaId);
    }

    expandRegion(regionId: RegionId): void {
        this.dock_?.expandRegion(regionId as AreaId);
    }

    isRegionCollapsed(regionId: RegionId): boolean {
        return this.dock_?.isRegionCollapsed(regionId as AreaId) ?? false;
    }

    isPanelActive(panelId: string): boolean {
        return this.dock_?.isPanelActive(panelId) ?? false;
    }

    private showTabContextMenu_(panelId: string, region: DockRegion, x: number, y: number): void {
        if (!this.dock_) return;

        const area = this.dock_.findRegionArea(region);
        if (!area) return;

        const group = this.dock_.getGroup(area);
        const canClose = !(area === 'center' && group.paneCount <= 1 && region.panelCount <= 1);
        const canDetach = this.detachContext_ && !NON_DETACHABLE_PANELS.has(panelId);

        const items: Array<{ label: string; onClick: () => void }> = [];

        if (canClose) {
            items.push({ label: 'Close', onClick: () => this.removePanel(panelId) });
        }

        if (region.panelCount > 1) {
            if (group.direction === 'horizontal') {
                items.push({ label: 'Split Right', onClick: () => { group.splitPane(region, panelId, 'right'); this.dock_?.saveLayout(); } });
                items.push({ label: 'Split Left', onClick: () => { group.splitPane(region, panelId, 'left'); this.dock_?.saveLayout(); } });
            } else {
                items.push({ label: 'Split Down', onClick: () => { group.splitPane(region, panelId, 'bottom'); this.dock_?.saveLayout(); } });
                items.push({ label: 'Split Up', onClick: () => { group.splitPane(region, panelId, 'top'); this.dock_?.saveLayout(); } });
            }
        }

        const moveTargets: Array<{ label: string; areaId: AreaId }> = [
            { label: 'Left', areaId: 'left' },
            { label: 'Center', areaId: 'center' },
            { label: 'Right', areaId: 'right' },
            { label: 'Bottom', areaId: 'bottom' },
        ];
        for (const mt of moveTargets) {
            if (mt.areaId === area) continue;
            items.push({
                label: `Move to ${mt.label}`,
                onClick: () => {
                    const target = this.dock_?.getGroup(mt.areaId).primary;
                    if (target) this.dock_?.onTabMoved(panelId, region, target, target.panelCount);
                },
            });
        }

        if (canDetach) {
            items.push({
                label: 'Open in New Window',
                onClick: () => this.handleDetachPanel_(panelId),
            });
        }

        showContextMenu({ items, x, y });
    }

    private async handleDetachPanel_(panelId: string): Promise<void> {
        if (!this.detachContext_) return;

        try {
            const isGame = panelId === 'game';
            if (isGame) {
                const url = await this.detachContext_.getPreviewUrl();
                if (!url) return;
                await this.detachContext_.handler.detachGameView(url);
            } else {
                const desc = getPanel(panelId);
                const title = desc?.title ?? panelId;
                await this.detachContext_.handler.detachPanel(panelId, title);
            }
            this.removePanel(panelId);
        } catch (err) {
            console.error(`Failed to detach panel "${panelId}":`, err);
        }
    }

    dispose(): void {
        this.panelClosedUnlisten_?.();
        this.panelClosedUnlisten_ = null;
        this.dock_?.dispose();
        this.dock_ = null;
    }
}
