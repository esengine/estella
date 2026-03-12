import type { DockRegion } from './DockRegion';
import { icon } from '../utils/icons';

const DRAG_THRESHOLD = 5;
const EDGE_ZONE_SIZE = 40;

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export type DropResult =
    | { type: 'tab'; region: DockRegion; index: number }
    | { type: 'edge'; region: DockRegion; side: EdgeSide };

export interface TabDragHost {
    getRegions(): DockRegion[];
    getEdgeDirections(region: DockRegion): EdgeSide[];
    onTabMoved(panelId: string, sourceRegion: DockRegion, targetRegion: DockRegion, index: number): void;
    onTabReordered(panelId: string, region: DockRegion, newIndex: number): void;
    onEdgeDrop(panelId: string, source: DockRegion, target: DockRegion, side: EdgeSide): void;
}

export class DockTabDrag {
    private host_: TabDragHost;
    private dragging_ = false;
    private panelId_: string | null = null;
    private sourceRegion_: DockRegion | null = null;
    private ghost_: HTMLElement | null = null;
    private indicator_: HTMLElement | null = null;
    private edgeOverlay_: HTMLElement | null = null;
    private overlay_: HTMLElement | null = null;
    private startX_ = 0;
    private startY_ = 0;
    private thresholdMet_ = false;
    private lastDrop_: DropResult | null = null;

    private onMouseMove_: (e: MouseEvent) => void;
    private onMouseUp_: (e: MouseEvent) => void;

    constructor(host: TabDragHost) {
        this.host_ = host;
        this.onMouseMove_ = this.handleMouseMove_.bind(this);
        this.onMouseUp_ = this.handleMouseUp_.bind(this);
    }

    startDrag(panelId: string, sourceRegion: DockRegion, e: MouseEvent): void {
        if (this.dragging_) return;

        this.panelId_ = panelId;
        this.sourceRegion_ = sourceRegion;
        this.startX_ = e.clientX;
        this.startY_ = e.clientY;
        this.thresholdMet_ = false;
        this.dragging_ = true;
        this.lastDrop_ = null;

        document.addEventListener('mousemove', this.onMouseMove_);
        document.addEventListener('mouseup', this.onMouseUp_);
    }

    private handleMouseMove_(e: MouseEvent): void {
        if (!this.dragging_ || !this.panelId_ || !this.sourceRegion_) return;

        if (!this.thresholdMet_) {
            const dx = e.clientX - this.startX_;
            const dy = e.clientY - this.startY_;
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            this.thresholdMet_ = true;
            this.createDragVisuals_();
        }

        if (this.ghost_) {
            this.ghost_.style.left = `${e.clientX + 10}px`;
            this.ghost_.style.top = `${e.clientY + 10}px`;
        }

        this.updateDropTarget_(e.clientX, e.clientY);
    }

    private handleMouseUp_(_e: MouseEvent): void {
        document.removeEventListener('mousemove', this.onMouseMove_);
        document.removeEventListener('mouseup', this.onMouseUp_);

        if (this.thresholdMet_ && this.panelId_ && this.sourceRegion_ && this.lastDrop_) {
            const drop = this.lastDrop_;
            if (drop.type === 'edge') {
                this.host_.onEdgeDrop(this.panelId_, this.sourceRegion_, drop.region, drop.side);
            } else if (drop.region === this.sourceRegion_) {
                this.host_.onTabReordered(this.panelId_, this.sourceRegion_, drop.index);
            } else {
                this.host_.onTabMoved(this.panelId_, this.sourceRegion_, drop.region, drop.index);
            }
        }

        this.cleanup_();
    }

    private createDragVisuals_(): void {
        if (!this.panelId_ || !this.sourceRegion_) return;

        const sourceTab = this.sourceRegion_.getTabElement(this.panelId_);
        if (sourceTab) sourceTab.classList.add('es-dock-tab-dragging');

        this.ghost_ = document.createElement('div');
        this.ghost_.className = 'es-dock-tab-ghost';
        const gripSvg = icon('grip', 12);
        const entry = this.sourceRegion_.panels.find(p => p.id === this.panelId_);
        this.ghost_.innerHTML = `${gripSvg}<span>${entry?.title ?? this.panelId_}</span>`;
        document.body.appendChild(this.ghost_);

        this.indicator_ = document.createElement('div');
        this.indicator_.className = 'es-dock-drop-indicator';
        this.indicator_.style.display = 'none';
        document.body.appendChild(this.indicator_);

        this.edgeOverlay_ = document.createElement('div');
        this.edgeOverlay_.className = 'es-dock-edge-overlay';
        this.edgeOverlay_.style.display = 'none';
        document.body.appendChild(this.edgeOverlay_);

        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-dock-drag-overlay';
        document.body.appendChild(this.overlay_);
    }

    private updateDropTarget_(x: number, y: number): void {
        if (!this.indicator_ || !this.edgeOverlay_) return;

        this.lastDrop_ = null;
        this.indicator_.style.display = 'none';
        this.edgeOverlay_.style.display = 'none';

        for (const region of this.host_.getRegions()) {
            region.tabBar.classList.remove('es-dock-tabs-drop-target');
        }

        const edgeDrop = this.findEdgeDrop_(x, y);
        if (edgeDrop && edgeDrop.type === 'edge') {
            this.lastDrop_ = edgeDrop;
            this.showEdgeOverlay_(edgeDrop.region, edgeDrop.side);
            return;
        }

        const tabDrop = this.findTabDrop_(x, y);
        if (tabDrop && tabDrop.type === 'tab') {
            this.lastDrop_ = tabDrop;
            tabDrop.region.tabBar.classList.add('es-dock-tabs-drop-target');
            this.showTabIndicator_(tabDrop.region, tabDrop.index);
        }
    }

    private findEdgeDrop_(x: number, y: number): DropResult | null {
        for (const region of this.host_.getRegions()) {
            const contentRect = region.contentArea.getBoundingClientRect();
            if (x < contentRect.left || x > contentRect.right || y < contentRect.top || y > contentRect.bottom) continue;

            const directions = this.host_.getEdgeDirections(region);

            for (const dir of directions) {
                if (dir === 'left' && x < contentRect.left + EDGE_ZONE_SIZE) {
                    return { type: 'edge', region, side: 'left' };
                }
                if (dir === 'right' && x > contentRect.right - EDGE_ZONE_SIZE) {
                    return { type: 'edge', region, side: 'right' };
                }
                if (dir === 'top' && y < contentRect.top + EDGE_ZONE_SIZE) {
                    return { type: 'edge', region, side: 'top' };
                }
                if (dir === 'bottom' && y > contentRect.bottom - EDGE_ZONE_SIZE) {
                    return { type: 'edge', region, side: 'bottom' };
                }
            }
        }
        return null;
    }

    private showEdgeOverlay_(region: DockRegion, side: EdgeSide): void {
        if (!this.edgeOverlay_) return;

        const rect = region.contentArea.getBoundingClientRect();
        this.edgeOverlay_.style.display = '';

        switch (side) {
            case 'left':
                this.edgeOverlay_.style.left = `${rect.left}px`;
                this.edgeOverlay_.style.top = `${rect.top}px`;
                this.edgeOverlay_.style.width = `${rect.width / 2}px`;
                this.edgeOverlay_.style.height = `${rect.height}px`;
                break;
            case 'right':
                this.edgeOverlay_.style.left = `${rect.left + rect.width / 2}px`;
                this.edgeOverlay_.style.top = `${rect.top}px`;
                this.edgeOverlay_.style.width = `${rect.width / 2}px`;
                this.edgeOverlay_.style.height = `${rect.height}px`;
                break;
            case 'top':
                this.edgeOverlay_.style.left = `${rect.left}px`;
                this.edgeOverlay_.style.top = `${rect.top}px`;
                this.edgeOverlay_.style.width = `${rect.width}px`;
                this.edgeOverlay_.style.height = `${rect.height / 2}px`;
                break;
            case 'bottom':
                this.edgeOverlay_.style.left = `${rect.left}px`;
                this.edgeOverlay_.style.top = `${rect.top + rect.height / 2}px`;
                this.edgeOverlay_.style.width = `${rect.width}px`;
                this.edgeOverlay_.style.height = `${rect.height / 2}px`;
                break;
        }
    }

    private findTabDrop_(x: number, y: number): DropResult | null {
        for (const region of this.host_.getRegions()) {
            const rect = region.tabBar.getBoundingClientRect();
            const hitArea = {
                left: rect.left,
                right: rect.right,
                top: rect.top - 10,
                bottom: rect.bottom + 20,
            };
            if (x >= hitArea.left && x <= hitArea.right && y >= hitArea.top && y <= hitArea.bottom) {
                return { type: 'tab', region, index: region.getInsertIndexAtX(x) };
            }
        }
        return null;
    }

    private showTabIndicator_(region: DockRegion, insertIdx: number): void {
        if (!this.indicator_) return;

        const tabs = Array.from(region.tabBar.querySelector('.es-dock-tabs-inner')?.children ?? []) as HTMLElement[];

        if (tabs.length === 0) {
            const barRect = region.tabBar.getBoundingClientRect();
            this.indicator_.style.display = '';
            this.indicator_.style.left = `${barRect.left + 4}px`;
            this.indicator_.style.top = `${barRect.top + 2}px`;
            this.indicator_.style.height = `${barRect.height - 4}px`;
        } else if (insertIdx < tabs.length) {
            const tabRect = tabs[insertIdx].getBoundingClientRect();
            this.indicator_.style.display = '';
            this.indicator_.style.left = `${tabRect.left - 1}px`;
            this.indicator_.style.top = `${tabRect.top + 2}px`;
            this.indicator_.style.height = `${tabRect.height - 4}px`;
        } else {
            const lastTab = tabs[tabs.length - 1];
            const tabRect = lastTab.getBoundingClientRect();
            this.indicator_.style.display = '';
            this.indicator_.style.left = `${tabRect.right - 1}px`;
            this.indicator_.style.top = `${tabRect.top + 2}px`;
            this.indicator_.style.height = `${tabRect.height - 4}px`;
        }
    }

    private cleanup_(): void {
        if (this.panelId_ && this.sourceRegion_) {
            const sourceTab = this.sourceRegion_.getTabElement(this.panelId_);
            sourceTab?.classList.remove('es-dock-tab-dragging');
        }

        this.ghost_?.remove();
        this.indicator_?.remove();
        this.edgeOverlay_?.remove();
        this.overlay_?.remove();
        this.ghost_ = null;
        this.indicator_ = null;
        this.edgeOverlay_ = null;
        this.overlay_ = null;

        for (const region of this.host_.getRegions()) {
            region.tabBar.classList.remove('es-dock-tabs-drop-target');
        }

        this.dragging_ = false;
        this.panelId_ = null;
        this.sourceRegion_ = null;
        this.thresholdMet_ = false;
        this.lastDrop_ = null;
    }

    dispose(): void {
        document.removeEventListener('mousemove', this.onMouseMove_);
        document.removeEventListener('mouseup', this.onMouseUp_);
        this.cleanup_();
    }
}
