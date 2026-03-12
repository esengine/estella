import { icon } from '../utils/icons';

export type RegionId = 'left' | 'center' | 'right' | 'bottom';

export interface DockPanelEntry {
    id: string;
    title: string;
    contentEl: HTMLElement;
}

export interface DockRegionOptions {
    id: RegionId;
    instanceId?: string;
    onTabContextMenu?: (panelId: string, x: number, y: number) => void;
    onPanelActivated?: (panelId: string) => void;
    onTabDragStart?: (panelId: string, e: MouseEvent) => void;
    onTabClose?: (panelId: string) => void;
    onEmpty?: (region: DockRegion) => void;
}

let regionCounter = 0;

export class DockRegion {
    readonly id: RegionId;
    readonly instanceId: string;
    readonly element: HTMLElement;
    readonly tabBar: HTMLElement;
    readonly contentArea: HTMLElement;

    private panels_: DockPanelEntry[] = [];
    private activeId_: string | null = null;
    private collapsed_ = false;
    private savedSize_ = 0;
    private options_: DockRegionOptions;

    private scrollLeftBtn_: HTMLElement | null = null;
    private scrollRightBtn_: HTMLElement | null = null;
    private tabsInner_: HTMLElement;

    constructor(options: DockRegionOptions) {
        this.id = options.id;
        this.instanceId = options.instanceId ?? `region-${regionCounter++}`;
        this.options_ = options;

        this.element = document.createElement('div');
        this.element.className = `es-dock-region es-dock-${options.id}`;
        this.element.dataset.region = options.id;
        this.element.dataset.instanceId = this.instanceId;

        this.tabBar = document.createElement('div');
        this.tabBar.className = 'es-dock-tabs';
        this.tabBar.dataset.region = options.id;
        this.tabBar.dataset.instanceId = this.instanceId;

        this.tabsInner_ = document.createElement('div');
        this.tabsInner_.className = 'es-dock-tabs-inner';
        this.tabBar.appendChild(this.tabsInner_);

        this.contentArea = document.createElement('div');
        this.contentArea.className = 'es-dock-content';
        this.contentArea.dataset.instanceId = this.instanceId;

        this.element.appendChild(this.tabBar);
        this.element.appendChild(this.contentArea);

        this.tabBar.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.tabsInner_.scrollLeft += e.deltaY;
        }, { passive: false });
    }

    get panels(): readonly DockPanelEntry[] {
        return this.panels_;
    }

    get activeId(): string | null {
        return this.activeId_;
    }

    get panelCount(): number {
        return this.panels_.length;
    }

    get isCollapsed(): boolean {
        return this.collapsed_;
    }

    get savedSize(): number {
        return this.savedSize_;
    }

    addPanel(entry: DockPanelEntry, index?: number): void {
        const idx = index !== undefined ? Math.min(index, this.panels_.length) : this.panels_.length;
        this.panels_.splice(idx, 0, entry);

        entry.contentEl.classList.add('es-dock-panel');
        entry.contentEl.style.display = 'none';
        this.contentArea.appendChild(entry.contentEl);

        this.rebuildTabs_();

        if (this.panels_.length === 1 || !this.activeId_) {
            this.activate(entry.id);
        }
    }

    removePanel(panelId: string): DockPanelEntry | null {
        const idx = this.panels_.findIndex(p => p.id === panelId);
        if (idx < 0) return null;

        const [entry] = this.panels_.splice(idx, 1);
        entry.contentEl.style.display = 'none';
        entry.contentEl.remove();

        if (this.activeId_ === panelId) {
            const newActive = this.panels_[Math.min(idx, this.panels_.length - 1)];
            this.activeId_ = null;
            if (newActive) {
                this.activate(newActive.id);
            }
        }

        this.rebuildTabs_();

        if (this.panels_.length === 0) {
            this.options_.onEmpty?.(this);
        }

        return entry;
    }

    hasPanel(panelId: string): boolean {
        return this.panels_.some(p => p.id === panelId);
    }

    activate(panelId: string): void {
        if (this.activeId_ === panelId) return;

        for (const p of this.panels_) {
            const isActive = p.id === panelId;
            p.contentEl.style.display = isActive ? '' : 'none';
        }

        this.activeId_ = panelId;
        this.updateTabActive_();
        this.scrollTabIntoView_(panelId);
        this.options_.onPanelActivated?.(panelId);
    }

    reorderPanel(panelId: string, newIndex: number): void {
        const oldIdx = this.panels_.findIndex(p => p.id === panelId);
        if (oldIdx < 0 || oldIdx === newIndex) return;

        const [entry] = this.panels_.splice(oldIdx, 1);
        this.panels_.splice(Math.min(newIndex, this.panels_.length), 0, entry);
        this.rebuildTabs_();
    }

    collapse(size?: number): void {
        if (this.collapsed_) return;
        if (size !== undefined) this.savedSize_ = size;
        this.collapsed_ = true;
        this.element.classList.add('es-dock-collapsed');
    }

    expand(): void {
        if (!this.collapsed_) return;
        this.collapsed_ = false;
        this.element.classList.remove('es-dock-collapsed');

        if (this.activeId_) {
            const p = this.panels_.find(e => e.id === this.activeId_);
            if (p) p.contentEl.style.display = '';
        }
    }

    setSavedSize(size: number): void {
        this.savedSize_ = size;
    }

    getTabElement(panelId: string): HTMLElement | null {
        return this.tabsInner_.querySelector(`[data-panel-id="${panelId}"]`);
    }

    getInsertIndexAtX(clientX: number): number {
        const tabs = Array.from(this.tabsInner_.children) as HTMLElement[];
        for (let i = 0; i < tabs.length; i++) {
            const rect = tabs[i].getBoundingClientRect();
            if (clientX < rect.left + rect.width / 2) return i;
        }
        return tabs.length;
    }

    private rebuildTabs_(): void {
        this.tabsInner_.innerHTML = '';

        for (const p of this.panels_) {
            const tab = document.createElement('div');
            tab.className = 'es-dock-tab';
            tab.dataset.panelId = p.id;

            const label = document.createElement('span');
            label.className = 'es-dock-tab-label';
            label.textContent = p.title;
            tab.appendChild(label);

            const closeBtn = document.createElement('span');
            closeBtn.className = 'es-dock-tab-close';
            closeBtn.innerHTML = icon('x', 12);
            closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.options_.onTabClose?.(p.id);
            });
            tab.appendChild(closeBtn);

            tab.addEventListener('mousedown', (e) => {
                if (e.button === 0 && !(e.target as HTMLElement).closest('.es-dock-tab-close')) {
                    this.activate(p.id);
                    this.options_.onTabDragStart?.(p.id, e);
                }
            });

            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.options_.onTabContextMenu?.(p.id, e.clientX, e.clientY);
            });

            this.tabsInner_.appendChild(tab);
        }

        this.updateTabActive_();
        this.updateScrollButtons_();
    }

    private updateTabActive_(): void {
        const tabs = this.tabsInner_.children;
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i] as HTMLElement;
            tab.classList.toggle('es-dock-tab-active', tab.dataset.panelId === this.activeId_);
        }
    }

    private scrollTabIntoView_(panelId: string): void {
        const tab = this.getTabElement(panelId);
        if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    private updateScrollButtons_(): void {
        const needsScroll = this.tabsInner_.scrollWidth > this.tabsInner_.clientWidth;

        if (needsScroll && !this.scrollLeftBtn_) {
            this.scrollLeftBtn_ = document.createElement('div');
            this.scrollLeftBtn_.className = 'es-dock-tabs-scroll es-dock-tabs-scroll-left';
            this.scrollLeftBtn_.innerHTML = icon('chevronLeft', 12);
            this.scrollLeftBtn_.addEventListener('click', () => {
                this.tabsInner_.scrollBy({ left: -100, behavior: 'smooth' });
            });
            this.tabBar.insertBefore(this.scrollLeftBtn_, this.tabsInner_);

            this.scrollRightBtn_ = document.createElement('div');
            this.scrollRightBtn_.className = 'es-dock-tabs-scroll es-dock-tabs-scroll-right';
            this.scrollRightBtn_.innerHTML = icon('chevronRight', 12);
            this.scrollRightBtn_.addEventListener('click', () => {
                this.tabsInner_.scrollBy({ left: 100, behavior: 'smooth' });
            });
            this.tabBar.appendChild(this.scrollRightBtn_);
        } else if (!needsScroll && this.scrollLeftBtn_) {
            this.scrollLeftBtn_.remove();
            this.scrollRightBtn_?.remove();
            this.scrollLeftBtn_ = null;
            this.scrollRightBtn_ = null;
        }
    }

    dispose(): void {
        this.panels_ = [];
        this.element.remove();
    }
}
