import type { DockLayoutManager } from '../DockLayoutManager';
import type { EditorStore } from '../store/EditorStore';
import { ContentBrowserPanel, type ContentBrowserOptions } from '../panels/ContentBrowserPanel';
import { icons } from '../utils/icons';

type DrawerState = 'hidden' | 'open';

const DRAWER_HEIGHT_KEY = 'esengine.content-drawer.height';
const DRAWER_PINNED_KEY = 'esengine.content-drawer.pinned';
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

export class ContentDrawer {
    private state_: DrawerState = 'hidden';
    private drawerEl_: HTMLElement | null = null;
    private panelBody_: HTMLElement | null = null;
    private panel_: ContentBrowserPanel | null = null;
    private drawerHeight_: number;
    private outsideClickHandler_: ((e: MouseEvent) => void) | null = null;
    private resizing_ = false;
    private pinned_: boolean;
    private pinBtn_: HTMLElement | null = null;

    constructor(
        private editorContainer_: HTMLElement,
        private dockLayout_: DockLayoutManager,
        private store_: EditorStore,
        private panelOptions_: ContentBrowserOptions,
    ) {
        this.drawerHeight_ = parseInt(localStorage.getItem(DRAWER_HEIGHT_KEY) ?? '', 10) || DEFAULT_HEIGHT;
        this.pinned_ = localStorage.getItem(DRAWER_PINNED_KEY) === 'true';
    }

    get state(): DrawerState {
        return this.state_;
    }

    toggle(): void {
        if (this.state_ === 'open') {
            this.closeDrawer();
        } else {
            this.openDrawer();
        }
    }

    openDrawer(): void {
        if (this.state_ === 'open') return;

        if (!this.drawerEl_) {
            this.createDrawerDOM_();
        }

        this.ensurePanel_();

        this.drawerEl_!.style.setProperty('--drawer-height', `${this.drawerHeight_}px`);

        requestAnimationFrame(() => {
            this.drawerEl_!.classList.add('es-drawer-open');
            this.state_ = 'open';
            this.updateStatusbarButton_(true);
        });

        if (!this.pinned_) {
            this.attachOutsideClick_();
        }

        this.drawerEl_!.addEventListener('transitionend', () => {
            window.dispatchEvent(new Event('resize'));
        }, { once: true });
    }

    closeDrawer(): void {
        if (this.state_ !== 'open' || !this.drawerEl_) return;

        this.drawerEl_.classList.remove('es-drawer-open');
        this.state_ = 'hidden';
        this.detachOutsideClick_();
        this.updateStatusbarButton_(false);

        this.drawerEl_.addEventListener('transitionend', () => {
            window.dispatchEvent(new Event('resize'));
        }, { once: true });
    }

    dockInLayout(): void {
        this.closeDrawer();
        this.destroyPanel_();

        this.dockLayout_.showPanel('content-browser');
    }

    onResetLayout(): void {
        this.closeDrawer();
        this.destroyPanel_();
    }

    dispose(): void {
        this.detachOutsideClick_();
        this.destroyPanel_();
        if (this.drawerEl_) {
            this.drawerEl_.remove();
            this.drawerEl_ = null;
        }
        this.panelBody_ = null;
    }

    private ensurePanel_(): void {
        if (this.panel_ || !this.panelBody_) return;
        this.panelBody_.innerHTML = '';
        this.panel_ = new ContentBrowserPanel(this.panelBody_, this.store_, this.panelOptions_);
    }

    private destroyPanel_(): void {
        if (!this.panel_) return;
        this.panel_.dispose();
        this.panel_ = null;
        if (this.panelBody_) {
            this.panelBody_.innerHTML = '';
        }
    }

    private createDrawerDOM_(): void {
        this.drawerEl_ = document.createElement('div');
        this.drawerEl_.className = 'es-content-drawer';
        this.drawerEl_.innerHTML = `
            <div class="es-content-drawer-resize"></div>
            <div class="es-content-drawer-header">
                <span class="es-content-drawer-title">${icons.folder(14)} Content Browser</span>
                <div class="es-content-drawer-actions">
                    <button class="es-btn-icon" title="Dock in Layout">${icons.template(14)}</button>
                    <button class="es-btn-icon es-drawer-pin-btn${this.pinned_ ? ' es-active' : ''}" title="${this.pinned_ ? 'Unpin' : 'Pin'}">${this.pinned_ ? icons.lock(14) : icons.lockOpen(14)}</button>
                    <button class="es-btn-icon" title="Close">${icons.x(14)}</button>
                </div>
            </div>
            <div class="es-content-drawer-body"></div>
        `;

        const statusbar = this.editorContainer_.querySelector('.es-editor-statusbar');
        if (statusbar) {
            this.editorContainer_.insertBefore(this.drawerEl_, statusbar);
        } else {
            this.editorContainer_.appendChild(this.drawerEl_);
        }

        this.panelBody_ = this.drawerEl_.querySelector('.es-content-drawer-body') as HTMLElement;

        const dockBtn = this.drawerEl_.querySelector('[title="Dock in Layout"]');
        this.pinBtn_ = this.drawerEl_.querySelector('.es-drawer-pin-btn') as HTMLElement;
        const closeBtn = this.drawerEl_.querySelector('[title="Close"]');

        dockBtn?.addEventListener('click', () => this.dockInLayout());
        this.pinBtn_?.addEventListener('click', () => this.togglePin_());
        closeBtn?.addEventListener('click', () => this.closeDrawer());

        this.setupResize_();
    }

    private setupResize_(): void {
        const handle = this.drawerEl_!.querySelector('.es-content-drawer-resize') as HTMLElement;
        if (!handle) return;

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = this.drawerHeight_;

            this.resizing_ = true;
            this.drawerEl_!.classList.add('es-drawer-resizing');

            const onMove = (ev: MouseEvent) => {
                const delta = startY - ev.clientY;
                const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta));
                this.drawerHeight_ = newHeight;
                this.drawerEl_!.style.setProperty('--drawer-height', `${newHeight}px`);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this.resizing_ = false;
                this.drawerEl_!.classList.remove('es-drawer-resizing');
                localStorage.setItem(DRAWER_HEIGHT_KEY, String(this.drawerHeight_));
                window.dispatchEvent(new Event('resize'));
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    private togglePin_(): void {
        this.pinned_ = !this.pinned_;
        localStorage.setItem(DRAWER_PINNED_KEY, String(this.pinned_));

        if (this.pinBtn_) {
            this.pinBtn_.innerHTML = this.pinned_ ? icons.lock(14) : icons.lockOpen(14);
            this.pinBtn_.title = this.pinned_ ? 'Unpin' : 'Pin';
            this.pinBtn_.classList.toggle('es-active', this.pinned_);
        }

        if (this.pinned_) {
            this.detachOutsideClick_();
        } else if (this.state_ === 'open') {
            this.attachOutsideClick_();
        }
    }

    private attachOutsideClick_(): void {
        this.detachOutsideClick_();

        requestAnimationFrame(() => {
            this.outsideClickHandler_ = (e: MouseEvent) => {
                if (this.resizing_) return;
                const target = e.target as HTMLElement;
                if (!target) return;
                if (this.drawerEl_?.contains(target)) return;
                if (target.closest('[data-bottom-panel="content-browser"]')) return;
                if (target.closest('.es-context-menu')) return;
                if (target.closest('.es-dialog-overlay')) return;
                this.closeDrawer();
            };
            document.addEventListener('mousedown', this.outsideClickHandler_);
        });
    }

    private detachOutsideClick_(): void {
        if (this.outsideClickHandler_) {
            document.removeEventListener('mousedown', this.outsideClickHandler_);
            this.outsideClickHandler_ = null;
        }
    }

    private updateStatusbarButton_(active: boolean): void {
        const btn = this.editorContainer_.querySelector('[data-bottom-panel="content-browser"]');
        if (btn) {
            btn.classList.toggle('es-active', active);
        }
    }
}
