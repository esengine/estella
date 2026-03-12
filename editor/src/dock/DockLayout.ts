import { DockRegion, type RegionId, type DockPanelEntry, type DockRegionOptions } from './DockRegion';
import { DockSplitter } from './DockSplitter';
import { DockPaneGroup } from './DockPaneGroup';
import { DockTabDrag, type TabDragHost } from './DockTabDrag';
import { showContextMenu } from '../ui/ContextMenu';

const LAYOUT_STORAGE_KEY = 'esengine.editor.layout.v3';
const OLD_LAYOUT_KEYS = ['esengine.editor.layout', 'esengine.editor.layout.v2'];

const MIN_SIDE_WIDTH = 120;
const MIN_CENTER_WIDTH = 200;
const MIN_BOTTOM_HEIGHT = 80;

const DEFAULT_LEFT_WIDTH = 250;
const DEFAULT_RIGHT_WIDTH = 260;
const DEFAULT_BOTTOM_HEIGHT = 200;

interface SerializedRegion {
    panels: string[];
    active: string | null;
    width?: number;
    height?: number;
}

interface SerializedLayout {
    v: number;
    left: SerializedRegion[];
    center: SerializedRegion[];
    bottom: SerializedRegion[];
    right: SerializedRegion[];
    collapsed: string[];
}

export type AreaId = 'left' | 'center' | 'right' | 'bottom';

export interface DockLayoutCallbacks {
    onPanelActivated?: (panelId: string) => void;
    onLayoutChange?: () => void;
    onTabContextMenu?: (panelId: string, region: DockRegion, x: number, y: number) => void;
    onTabClose?: (panelId: string) => void;
}

export class DockLayout implements TabDragHost {
    readonly element: HTMLElement;

    private leftGroup_: DockPaneGroup;
    private centerGroup_: DockPaneGroup;
    private rightGroup_: DockPaneGroup;
    private bottomGroup_: DockPaneGroup;

    private leftSplitter_: DockSplitter;
    private rightSplitter_: DockSplitter;
    private bottomSplitter_: DockSplitter;
    private tabDrag_: DockTabDrag;
    private callbacks_: DockLayoutCallbacks;
    private saveTimer_: ReturnType<typeof setTimeout> | null = null;

    private leftWidth_ = DEFAULT_LEFT_WIDTH;
    private rightWidth_ = DEFAULT_RIGHT_WIDTH;
    private bottomHeight_ = DEFAULT_BOTTOM_HEIGHT;

    private collapsed_: Set<AreaId> = new Set();
    private savedSizes_: Map<AreaId, number> = new Map();

    private resizeObserver_: ResizeObserver;

    constructor(container: HTMLElement, callbacks: DockLayoutCallbacks = {}) {
        this.callbacks_ = callbacks;

        const makeOpts = (id: RegionId): DockRegionOptions => this.makeRegionOpts_(id);

        this.leftGroup_ = new DockPaneGroup({ regionId: 'left', direction: 'vertical', makeRegionOpts: makeOpts, onSplitterResizeEnd: () => this.scheduleSave_() });
        this.centerGroup_ = new DockPaneGroup({ regionId: 'center', direction: 'horizontal', makeRegionOpts: makeOpts, onSplitterResizeEnd: () => this.scheduleSave_() });
        this.rightGroup_ = new DockPaneGroup({ regionId: 'right', direction: 'vertical', makeRegionOpts: makeOpts, onSplitterResizeEnd: () => this.scheduleSave_() });
        this.bottomGroup_ = new DockPaneGroup({ regionId: 'bottom', direction: 'horizontal', makeRegionOpts: makeOpts, onSplitterResizeEnd: () => this.scheduleSave_() });

        this.leftSplitter_ = new DockSplitter({
            direction: 'vertical',
            onResize: (d) => this.resizeLeft_(d),
            onResizeEnd: () => this.scheduleSave_(),
            onDoubleClick: () => { this.leftWidth_ = DEFAULT_LEFT_WIDTH; this.applyLayout_(); this.scheduleSave_(); },
        });

        this.rightSplitter_ = new DockSplitter({
            direction: 'vertical',
            onResize: (d) => this.resizeRight_(d),
            onResizeEnd: () => this.scheduleSave_(),
            onDoubleClick: () => { this.rightWidth_ = DEFAULT_RIGHT_WIDTH; this.applyLayout_(); this.scheduleSave_(); },
        });

        this.bottomSplitter_ = new DockSplitter({
            direction: 'horizontal',
            onResize: (d) => this.resizeBottom_(d),
            onResizeEnd: () => this.scheduleSave_(),
            onDoubleClick: () => { this.bottomHeight_ = DEFAULT_BOTTOM_HEIGHT; this.applyLayout_(); this.scheduleSave_(); },
        });

        this.tabDrag_ = new DockTabDrag(this);

        this.element = document.createElement('div');
        this.element.className = 'es-dock';

        const leftWrapper = document.createElement('div');
        leftWrapper.className = 'es-dock-area es-dock-area-left';
        leftWrapper.appendChild(this.leftGroup_.container);

        const rightWrapper = document.createElement('div');
        rightWrapper.className = 'es-dock-area es-dock-area-right';
        rightWrapper.appendChild(this.rightGroup_.container);

        const bottomWrapper = document.createElement('div');
        bottomWrapper.className = 'es-dock-area es-dock-area-bottom';
        bottomWrapper.appendChild(this.bottomGroup_.container);

        const centerArea = document.createElement('div');
        centerArea.className = 'es-dock-center-area';
        centerArea.appendChild(this.centerGroup_.container);
        centerArea.appendChild(this.bottomSplitter_.element);
        centerArea.appendChild(bottomWrapper);

        this.element.appendChild(leftWrapper);
        this.element.appendChild(this.leftSplitter_.element);
        this.element.appendChild(centerArea);
        this.element.appendChild(this.rightSplitter_.element);
        this.element.appendChild(rightWrapper);

        container.appendChild(this.element);

        this.resizeObserver_ = new ResizeObserver(() => this.onContainerResize_());
        this.resizeObserver_.observe(this.element);

        this.loadLayout_();
        this.applyLayout_();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    get leftRegion(): DockRegion { return this.leftGroup_.primary; }
    get rightRegion(): DockRegion { return this.rightGroup_.primary; }
    get bottomRegion(): DockRegion { return this.bottomGroup_.primary; }
    get centerPanes(): readonly DockRegion[] { return this.centerGroup_.panes; }

    getGroup(area: AreaId): DockPaneGroup {
        switch (area) {
            case 'left': return this.leftGroup_;
            case 'center': return this.centerGroup_;
            case 'right': return this.rightGroup_;
            case 'bottom': return this.bottomGroup_;
        }
    }

    getFixedRegion(id: 'left' | 'right' | 'bottom'): DockRegion {
        return this.getGroup(id).primary;
    }

    addCenterPane(): DockRegion {
        return this.centerGroup_.addPane();
    }

    removeCenterPane(region: DockRegion): void {
        this.centerGroup_.removePane(region);
    }

    addPanel(regionOrId: DockRegion | RegionId, entry: DockPanelEntry, index?: number): void {
        const region = typeof regionOrId === 'string' ? this.resolveRegion_(regionOrId) : regionOrId;
        region.addPanel(entry, index);
        this.scheduleSave_();
    }

    removePanel(panelId: string): DockPanelEntry | null {
        const region = this.findPanelRegion(panelId);
        if (!region) return null;
        const entry = region.removePanel(panelId);
        this.scheduleSave_();
        return entry;
    }

    findPanelRegion(panelId: string): DockRegion | null {
        return this.leftGroup_.hasPanel(panelId)
            ?? this.centerGroup_.hasPanel(panelId)
            ?? this.rightGroup_.hasPanel(panelId)
            ?? this.bottomGroup_.hasPanel(panelId);
    }

    findPanelArea(panelId: string): AreaId | null {
        if (this.leftGroup_.hasPanel(panelId)) return 'left';
        if (this.centerGroup_.hasPanel(panelId)) return 'center';
        if (this.rightGroup_.hasPanel(panelId)) return 'right';
        if (this.bottomGroup_.hasPanel(panelId)) return 'bottom';
        return null;
    }

    findRegionArea(region: DockRegion): AreaId | null {
        if (this.leftGroup_.containsPane(region)) return 'left';
        if (this.centerGroup_.containsPane(region)) return 'center';
        if (this.rightGroup_.containsPane(region)) return 'right';
        if (this.bottomGroup_.containsPane(region)) return 'bottom';
        return null;
    }

    activatePanel(panelId: string): void {
        const region = this.findPanelRegion(panelId);
        if (!region) return;
        const area = this.findRegionArea(region);
        if (area && this.collapsed_.has(area)) this.expandRegion(area);
        region.activate(panelId);
    }

    collapseRegion(areaId: AreaId): void {
        if (areaId === 'center' || this.collapsed_.has(areaId)) return;

        const size = areaId === 'bottom' ? this.bottomHeight_
            : areaId === 'left' ? this.leftWidth_
            : this.rightWidth_;
        this.savedSizes_.set(areaId, size);
        this.collapsed_.add(areaId);
        this.updateAreaCollapsed_(areaId, true);
        this.updateSplitterVisibility_();
        this.applyLayout_();
        this.scheduleSave_();
    }

    expandRegion(areaId: AreaId): void {
        if (areaId === 'center' || !this.collapsed_.has(areaId)) return;

        const saved = this.savedSizes_.get(areaId);
        if (areaId === 'left') this.leftWidth_ = saved || DEFAULT_LEFT_WIDTH;
        else if (areaId === 'right') this.rightWidth_ = saved || DEFAULT_RIGHT_WIDTH;
        else if (areaId === 'bottom') this.bottomHeight_ = saved || DEFAULT_BOTTOM_HEIGHT;

        this.collapsed_.delete(areaId);
        this.updateAreaCollapsed_(areaId, false);
        this.updateSplitterVisibility_();
        this.applyLayout_();
        this.scheduleSave_();
    }

    isRegionCollapsed(areaId: AreaId | RegionId): boolean {
        if (areaId === 'center') return false;
        return this.collapsed_.has(areaId as AreaId);
    }

    isPanelActive(panelId: string): boolean {
        const region = this.findPanelRegion(panelId);
        if (!region) return false;
        const area = this.findRegionArea(region);
        if (area && this.collapsed_.has(area)) return false;
        return region.activeId === panelId;
    }

    splitCenterPane(sourceRegion: DockRegion, panelId: string, side: 'left' | 'right'): void {
        this.centerGroup_.splitPane(sourceRegion, panelId, side);
        this.scheduleSave_();
    }

    resetLayout(): void {
        this.leftWidth_ = DEFAULT_LEFT_WIDTH;
        this.rightWidth_ = DEFAULT_RIGHT_WIDTH;
        this.bottomHeight_ = DEFAULT_BOTTOM_HEIGHT;
        this.collapsed_.clear();
        this.savedSizes_.clear();
        for (const area of [this.leftGroup_, this.centerGroup_, this.rightGroup_, this.bottomGroup_]) {
            this.updateAreaCollapsed_(area === this.leftGroup_ ? 'left'
                : area === this.centerGroup_ ? 'center'
                : area === this.rightGroup_ ? 'right' : 'bottom', false);
        }
        this.updateSplitterVisibility_();
        this.applyLayout_();
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
    }

    saveLayout(): void {
        const data: SerializedLayout = {
            v: 3,
            left: this.leftGroup_.serialize(),
            center: this.centerGroup_.serialize(),
            bottom: this.bottomGroup_.serialize(),
            right: this.rightGroup_.serialize(),
            collapsed: Array.from(this.collapsed_),
        };

        if (!this.collapsed_.has('left')) (data as any).leftWidth = this.leftWidth_;
        if (!this.collapsed_.has('right')) (data as any).rightWidth = this.rightWidth_;
        if (!this.collapsed_.has('bottom')) (data as any).bottomHeight = this.bottomHeight_;

        try {
            localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data));
        } catch {
            // ignore
        }
    }

    getSerializedPanelOrder(): SerializedLayout | null {
        try {
            const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data.v === 3) return data as SerializedLayout;
            return null;
        } catch {
            return null;
        }
    }

    // =========================================================================
    // TabDragHost implementation
    // =========================================================================

    getRegions(): DockRegion[] {
        return [
            ...this.leftGroup_.panes,
            ...this.centerGroup_.panes,
            ...this.rightGroup_.panes,
            ...this.bottomGroup_.panes,
        ];
    }

    getEdgeDirections(region: DockRegion): Array<'left' | 'right' | 'top' | 'bottom'> {
        const area = this.findRegionArea(region);
        if (!area) return [];

        const group = this.getGroup(area);
        if (group.direction === 'horizontal') return ['left', 'right'];
        return ['top', 'bottom'];
    }

    onTabReordered(panelId: string, region: DockRegion, newIndex: number): void {
        region.reorderPanel(panelId, newIndex);
        this.scheduleSave_();
    }

    onTabMoved(panelId: string, source: DockRegion, target: DockRegion, index: number): void {
        const sourceArea = this.findRegionArea(source);
        const sourceGroup = sourceArea ? this.getGroup(sourceArea) : null;
        if (sourceGroup && sourceGroup.containsPane(source) && source.panelCount <= 1 && sourceGroup.paneCount <= 1) {
            if (sourceArea === 'center') return;
        }

        const entry = source.removePanel(panelId);
        if (!entry) return;

        const targetArea = this.findRegionArea(target);
        if (targetArea && this.collapsed_.has(targetArea)) this.expandRegion(targetArea);
        target.addPanel(entry, index);
        target.activate(panelId);

        this.scheduleSave_();
    }

    onEdgeDrop(panelId: string, source: DockRegion, target: DockRegion, side: 'left' | 'right' | 'top' | 'bottom'): void {
        const targetArea = this.findRegionArea(target);
        if (!targetArea) return;

        const sourceArea = this.findRegionArea(source);
        const sourceGroup = sourceArea ? this.getGroup(sourceArea) : null;
        if (sourceGroup && sourceGroup.containsPane(source) && source.panelCount <= 1 && sourceGroup.paneCount <= 1) {
            if (sourceArea === 'center') return;
        }

        const entry = source.removePanel(panelId);
        if (!entry) return;

        const group = this.getGroup(targetArea);
        group.insertPane(entry, target, side);
        this.scheduleSave_();
    }

    // =========================================================================
    // Private: region factory
    // =========================================================================

    private makeRegionOpts_(id: RegionId): DockRegionOptions {
        return {
            id,
            onPanelActivated: (panelId: string) => {
                this.callbacks_.onPanelActivated?.(panelId);
                this.scheduleSave_();
            },
            onTabContextMenu: (panelId: string, x: number, y: number) => {
                const region = this.findPanelRegion(panelId);
                if (!region) return;
                if (this.callbacks_.onTabContextMenu) {
                    this.callbacks_.onTabContextMenu(panelId, region, x, y);
                } else {
                    this.showDefaultTabContextMenu_(panelId, region, x, y);
                }
            },
            onTabDragStart: (panelId: string, e: MouseEvent) => {
                const region = this.findPanelRegion(panelId);
                if (region) this.tabDrag_.startDrag(panelId, region, e);
            },
            onTabClose: (panelId: string) => {
                if (this.callbacks_.onTabClose) {
                    this.callbacks_.onTabClose(panelId);
                } else {
                    this.removePanel(panelId);
                }
            },
            onEmpty: (region: DockRegion) => {
                const area = this.findRegionArea(region);
                if (!area) return;
                const group = this.getGroup(area);
                if (group.paneCount > 1) {
                    group.removePane(region);
                } else if (area !== 'center') {
                    this.collapseRegion(area);
                }
            },
        };
    }

    private resolveRegion_(id: RegionId): DockRegion {
        return this.getGroup(id as AreaId).primary;
    }

    // =========================================================================
    // Private: layout
    // =========================================================================

    private resizeLeft_(delta: number): void {
        this.leftWidth_ = Math.max(MIN_SIDE_WIDTH, this.leftWidth_ + delta);
        this.clampWidths_();
        this.applyLayout_();
    }

    private resizeRight_(delta: number): void {
        this.rightWidth_ = Math.max(MIN_SIDE_WIDTH, this.rightWidth_ - delta);
        this.clampWidths_();
        this.applyLayout_();
    }

    private resizeBottom_(delta: number): void {
        this.bottomHeight_ = Math.max(MIN_BOTTOM_HEIGHT, this.bottomHeight_ - delta);
        this.applyLayout_();
    }

    private clampWidths_(): void {
        const totalWidth = this.element.clientWidth;
        const splitterWidth = 8;
        const leftW = this.collapsed_.has('left') ? 0 : this.leftWidth_;
        const rightW = this.collapsed_.has('right') ? 0 : this.rightWidth_;
        const available = totalWidth - (this.collapsed_.has('left') ? 0 : splitterWidth) - (this.collapsed_.has('right') ? 0 : splitterWidth);

        if (leftW + rightW + MIN_CENTER_WIDTH > available) {
            const excess = leftW + rightW + MIN_CENTER_WIDTH - available;
            const halfExcess = excess / 2;
            if (!this.collapsed_.has('left')) this.leftWidth_ = Math.max(MIN_SIDE_WIDTH, this.leftWidth_ - halfExcess);
            if (!this.collapsed_.has('right')) this.rightWidth_ = Math.max(MIN_SIDE_WIDTH, this.rightWidth_ - halfExcess);
        }
    }

    private applyLayout_(): void {
        const leftEl = this.leftGroup_.container.parentElement;
        const rightEl = this.rightGroup_.container.parentElement;
        const bottomEl = this.bottomGroup_.container.parentElement;

        if (leftEl) leftEl.style.width = this.collapsed_.has('left') ? '0' : `${this.leftWidth_}px`;
        if (rightEl) rightEl.style.width = this.collapsed_.has('right') ? '0' : `${this.rightWidth_}px`;
        if (bottomEl) bottomEl.style.height = this.collapsed_.has('bottom') ? '0' : `${this.bottomHeight_}px`;

        this.callbacks_.onLayoutChange?.();
    }

    private updateAreaCollapsed_(areaId: AreaId, collapsed: boolean): void {
        const group = this.getGroup(areaId);
        const wrapper = group.container.parentElement;
        if (wrapper) {
            wrapper.classList.toggle('es-dock-area-collapsed', collapsed);
        }
        for (const pane of group.panes) {
            if (collapsed) {
                pane.element.classList.add('es-dock-collapsed');
            } else {
                pane.element.classList.remove('es-dock-collapsed');
                if (pane.activeId) {
                    const p = pane.panels.find(e => e.id === pane.activeId);
                    if (p) p.contentEl.style.display = '';
                }
            }
        }
    }

    private updateSplitterVisibility_(): void {
        this.leftSplitter_.setVisible(!this.collapsed_.has('left'));
        this.rightSplitter_.setVisible(!this.collapsed_.has('right'));
        this.bottomSplitter_.setVisible(!this.collapsed_.has('bottom'));
    }

    private onContainerResize_(): void {
        this.clampWidths_();
        this.applyLayout_();
    }

    private loadLayout_(): void {
        for (const key of OLD_LAYOUT_KEYS) {
            localStorage.removeItem(key);
        }

        try {
            const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.v !== 3) {
                localStorage.removeItem(LAYOUT_STORAGE_KEY);
                return;
            }

            if (data.leftWidth) this.leftWidth_ = data.leftWidth;
            if (data.rightWidth) this.rightWidth_ = data.rightWidth;
            if (data.bottomHeight) this.bottomHeight_ = data.bottomHeight;

            if (data.collapsed) {
                for (const id of data.collapsed) {
                    if (id === 'left' || id === 'right' || id === 'bottom') {
                        this.collapsed_.add(id);
                        this.savedSizes_.set(id, id === 'left' ? this.leftWidth_ : id === 'right' ? this.rightWidth_ : this.bottomHeight_);
                        this.updateAreaCollapsed_(id, true);
                    }
                }
            }

            this.updateSplitterVisibility_();
        } catch {
            localStorage.removeItem(LAYOUT_STORAGE_KEY);
        }
    }

    private scheduleSave_(): void {
        if (this.saveTimer_) clearTimeout(this.saveTimer_);
        this.saveTimer_ = setTimeout(() => {
            this.saveTimer_ = null;
            this.saveLayout();
        }, 500);
    }

    private showDefaultTabContextMenu_(panelId: string, region: DockRegion, x: number, y: number): void {
        const area = this.findRegionArea(region);
        if (!area) return;

        const group = this.getGroup(area);
        const canClose = !(group.paneCount <= 1 && region.panelCount <= 1 && area === 'center');

        const items: Array<{ label: string; onClick: () => void }> = [];

        if (canClose) {
            items.push({ label: 'Close', onClick: () => this.removePanel(panelId) });
        }

        if (region.panelCount > 1) {
            if (group.direction === 'horizontal') {
                items.push({ label: 'Split Right', onClick: () => { group.splitPane(region, panelId, 'right'); this.scheduleSave_(); } });
                items.push({ label: 'Split Left', onClick: () => { group.splitPane(region, panelId, 'left'); this.scheduleSave_(); } });
            } else {
                items.push({ label: 'Split Down', onClick: () => { group.splitPane(region, panelId, 'bottom'); this.scheduleSave_(); } });
                items.push({ label: 'Split Up', onClick: () => { group.splitPane(region, panelId, 'top'); this.scheduleSave_(); } });
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
                    const target = this.getGroup(mt.areaId).primary;
                    this.onTabMoved(panelId, region, target, target.panelCount);
                },
            });
        }

        showContextMenu({ items, x, y });
    }

    dispose(): void {
        if (this.saveTimer_) {
            clearTimeout(this.saveTimer_);
            this.saveLayout();
        }
        this.resizeObserver_.disconnect();
        this.tabDrag_.dispose();
        this.leftSplitter_.dispose();
        this.rightSplitter_.dispose();
        this.bottomSplitter_.dispose();
        this.leftGroup_.dispose();
        this.centerGroup_.dispose();
        this.rightGroup_.dispose();
        this.bottomGroup_.dispose();
        this.element.remove();
    }
}
