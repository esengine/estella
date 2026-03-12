import { DockRegion, type RegionId, type DockRegionOptions, type DockPanelEntry } from './DockRegion';
import { DockSplitter } from './DockSplitter';

const MIN_PANE_SIZE = 80;

export type SplitDirection = 'horizontal' | 'vertical';

export interface DockPaneGroupOptions {
    regionId: RegionId;
    direction: SplitDirection;
    makeRegionOpts: (id: RegionId) => DockRegionOptions;
    onSplitterResizeEnd?: () => void;
}

export class DockPaneGroup {
    readonly container: HTMLElement;
    readonly direction: SplitDirection;
    private regionId_: RegionId;
    private panes_: DockRegion[] = [];
    private splitters_: DockSplitter[] = [];
    private makeRegionOpts_: (id: RegionId) => DockRegionOptions;
    private onSplitterResizeEnd_?: () => void;

    constructor(options: DockPaneGroupOptions) {
        this.regionId_ = options.regionId;
        this.direction = options.direction;
        this.makeRegionOpts_ = options.makeRegionOpts;
        this.onSplitterResizeEnd_ = options.onSplitterResizeEnd;

        this.container = document.createElement('div');
        this.container.className = `es-dock-pane-group es-dock-pane-group-${options.direction}`;
    }

    get panes(): readonly DockRegion[] {
        return this.panes_;
    }

    get primary(): DockRegion {
        return this.panes_[0];
    }

    get paneCount(): number {
        return this.panes_.length;
    }

    addPane(): DockRegion {
        const region = new DockRegion(this.makeRegionOpts_(this.regionId_));

        if (this.panes_.length > 0) {
            const splitter = this.makeSplitter_(this.splitters_.length);
            this.splitters_.push(splitter);
        }

        this.panes_.push(region);
        this.rebuildDOM_();
        this.applyEqualFlex_();
        return region;
    }

    removePane(region: DockRegion): void {
        const idx = this.panes_.indexOf(region);
        if (idx < 0 || this.panes_.length <= 1) return;

        region.element.remove();
        this.panes_.splice(idx, 1);

        if (this.splitters_.length > 0) {
            const splitterIdx = Math.min(idx, this.splitters_.length - 1);
            this.splitters_[splitterIdx].element.remove();
            this.splitters_[splitterIdx].dispose();
            this.splitters_.splice(splitterIdx, 1);
        }

        this.rebuildDOM_();
        this.applyEqualFlex_();
        region.dispose();
    }

    splitPane(sourceRegion: DockRegion, panelId: string, side: string): void {
        const entry = sourceRegion.removePanel(panelId);
        if (!entry) return;

        const sourceIdx = this.panes_.indexOf(sourceRegion);
        if (sourceIdx < 0) return;

        const isBefore = (this.direction === 'horizontal')
            ? (side === 'left')
            : (side === 'top');
        const insertIdx = isBefore ? sourceIdx : sourceIdx + 1;

        const newRegion = new DockRegion(this.makeRegionOpts_(this.regionId_));
        const splitter = this.makeSplitter_(this.splitters_.length);
        this.splitters_.push(splitter);
        this.panes_.splice(insertIdx, 0, newRegion);

        this.rebuildDOM_();
        newRegion.addPanel(entry);
        newRegion.activate(panelId);
        this.applyEqualFlex_();
    }

    insertPane(entry: DockPanelEntry, targetRegion: DockRegion, side: string): DockRegion {
        const targetIdx = this.panes_.indexOf(targetRegion);
        if (targetIdx < 0) return targetRegion;

        const isBefore = (this.direction === 'horizontal')
            ? (side === 'left')
            : (side === 'top');
        const insertIdx = isBefore ? targetIdx : targetIdx + 1;

        const newRegion = new DockRegion(this.makeRegionOpts_(this.regionId_));
        const splitter = this.makeSplitter_(this.splitters_.length);
        this.splitters_.push(splitter);
        this.panes_.splice(insertIdx, 0, newRegion);

        this.rebuildDOM_();
        newRegion.addPanel(entry);
        newRegion.activate(entry.id);
        this.applyEqualFlex_();
        return newRegion;
    }

    containsPane(region: DockRegion): boolean {
        return this.panes_.includes(region);
    }

    hasPanel(panelId: string): DockRegion | null {
        for (const pane of this.panes_) {
            if (pane.hasPanel(panelId)) return pane;
        }
        return null;
    }

    serialize(): Array<{ panels: string[]; active: string | null }> {
        return this.panes_.map(p => ({
            panels: p.panels.map(e => e.id),
            active: p.activeId,
        }));
    }

    private makeSplitter_(index: number): DockSplitter {
        const dir = this.direction === 'horizontal' ? 'vertical' : 'horizontal';
        return new DockSplitter({
            direction: dir,
            onResize: (d) => this.resizeSplitter_(index, d),
            onResizeEnd: () => this.onSplitterResizeEnd_?.(),
        });
    }

    private resizeSplitter_(splitterIdx: number): void;
    private resizeSplitter_(splitterIdx: number, delta: number): void;
    private resizeSplitter_(splitterIdx: number, delta?: number): void {
        if (delta === undefined || splitterIdx >= this.panes_.length - 1) return;
        const a = this.panes_[splitterIdx];
        const b = this.panes_[splitterIdx + 1];

        const isHoriz = this.direction === 'horizontal';
        const aSize = isHoriz ? a.element.offsetWidth : a.element.offsetHeight;
        const bSize = isHoriz ? b.element.offsetWidth : b.element.offsetHeight;

        const newA = aSize + delta;
        const newB = bSize - delta;

        if (newA >= MIN_PANE_SIZE && newB >= MIN_PANE_SIZE) {
            a.element.style.flex = `0 0 ${newA}px`;
            b.element.style.flex = `0 0 ${newB}px`;
        }
    }

    applyEqualFlex_(): void {
        for (const pane of this.panes_) {
            pane.element.style.flex = '1 1 0';
        }
    }

    private rebuildDOM_(): void {
        this.container.innerHTML = '';
        for (let i = 0; i < this.panes_.length; i++) {
            if (i > 0 && i - 1 < this.splitters_.length) {
                this.container.appendChild(this.splitters_[i - 1].element);
            }
            this.container.appendChild(this.panes_[i].element);
        }
    }

    dispose(): void {
        for (const s of this.splitters_) s.dispose();
        for (const p of this.panes_) p.dispose();
        this.splitters_ = [];
        this.panes_ = [];
        this.container.remove();
    }
}
