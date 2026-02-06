/**
 * @file    ContextMenu.ts
 * @brief   Context menu component with submenu support
 */

import { icons } from '../utils/icons';

// =============================================================================
// Types
// =============================================================================

export interface ContextMenuItem {
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    separator?: boolean;
    onClick?: () => void;
    children?: ContextMenuItem[];
}

export interface ContextMenuOptions {
    items: ContextMenuItem[];
    x: number;
    y: number;
}

// =============================================================================
// ContextMenu
// =============================================================================

class ContextMenuManager {
    private root_: HTMLElement | null = null;
    private submenus_: HTMLElement[] = [];
    private closeHandler_: ((e: MouseEvent) => void) | null = null;
    private keyHandler_: ((e: KeyboardEvent) => void) | null = null;

    show(options: ContextMenuOptions): void {
        this.hide();

        const existingMenu = document.querySelector('.es-context-menu');
        existingMenu?.remove();

        this.root_ = this.createMenu(options.items, options.x, options.y, true);
        document.body.appendChild(this.root_);

        this.closeHandler_ = (e: MouseEvent) => {
            const target = e.target as Node;
            const isInMenu = this.root_?.contains(target) ||
                this.submenus_.some(sub => sub.contains(target));
            if (!isInMenu) {
                this.hide();
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', this.closeHandler_!);
        }, 0);

        this.keyHandler_ = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.keyHandler_);
    }

    hide(): void {
        if (this.root_) {
            this.root_.remove();
            this.root_ = null;
        }
        for (const sub of this.submenus_) {
            sub.remove();
        }
        this.submenus_ = [];
        if (this.closeHandler_) {
            document.removeEventListener('mousedown', this.closeHandler_);
            this.closeHandler_ = null;
        }
        if (this.keyHandler_) {
            document.removeEventListener('keydown', this.keyHandler_);
            this.keyHandler_ = null;
        }
    }

    private createMenu(items: ContextMenuItem[], x: number, y: number, isRoot: boolean): HTMLElement {
        const menu = document.createElement('div');
        menu.className = 'es-context-menu';

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'es-context-menu-separator';
                menu.appendChild(sep);
                continue;
            }

            const el = document.createElement('div');
            el.className = 'es-context-menu-item';
            if (item.disabled) {
                el.classList.add('es-disabled');
            }
            if (item.children && item.children.length > 0) {
                el.classList.add('es-has-submenu');
            }

            if (item.icon) {
                const iconEl = document.createElement('span');
                iconEl.className = 'es-context-menu-icon';
                iconEl.innerHTML = item.icon;
                el.appendChild(iconEl);
            }

            const labelEl = document.createElement('span');
            labelEl.className = 'es-context-menu-label';
            labelEl.textContent = item.label;
            el.appendChild(labelEl);

            if (item.shortcut) {
                const shortcutEl = document.createElement('span');
                shortcutEl.className = 'es-context-menu-shortcut';
                shortcutEl.textContent = item.shortcut;
                el.appendChild(shortcutEl);
            }

            if (item.children && item.children.length > 0) {
                const arrowEl = document.createElement('span');
                arrowEl.className = 'es-context-menu-arrow';
                arrowEl.innerHTML = icons.chevronRight(12);
                el.appendChild(arrowEl);
            }

            if (item.children && item.children.length > 0) {
                let submenu: HTMLElement | null = null;
                let hideTimeout: number | null = null;

                el.addEventListener('mouseenter', () => {
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }

                    this.hideSubmenusAfter(menu);

                    const rect = el.getBoundingClientRect();
                    let subX = rect.right;
                    let subY = rect.top;

                    submenu = this.createMenu(item.children!, subX, subY, false);
                    document.body.appendChild(submenu);
                    this.submenus_.push(submenu);

                    const subRect = submenu.getBoundingClientRect();
                    if (subX + subRect.width > window.innerWidth) {
                        subX = rect.left - subRect.width;
                    }
                    if (subY + subRect.height > window.innerHeight) {
                        subY = window.innerHeight - subRect.height - 5;
                    }
                    submenu.style.left = `${subX}px`;
                    submenu.style.top = `${subY}px`;
                });

                el.addEventListener('mouseleave', (e) => {
                    const related = e.relatedTarget as HTMLElement;
                    if (submenu && submenu.contains(related)) {
                        return;
                    }
                    hideTimeout = window.setTimeout(() => {
                        if (submenu) {
                            const idx = this.submenus_.indexOf(submenu);
                            if (idx >= 0) {
                                this.submenus_.splice(idx, 1);
                            }
                            submenu.remove();
                            submenu = null;
                        }
                    }, 100);
                });
            } else if (item.onClick && !item.disabled) {
                el.addEventListener('click', () => {
                    item.onClick!();
                    this.hide();
                });
            }

            menu.appendChild(el);
        }

        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        menu.remove();

        if (x + rect.width > window.innerWidth) {
            x = window.innerWidth - rect.width - 5;
        }
        if (y + rect.height > window.innerHeight) {
            y = window.innerHeight - rect.height - 5;
        }

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        return menu;
    }

    private hideSubmenusAfter(parentMenu: HTMLElement): void {
        const parentIndex = this.submenus_.findIndex(m => {
            const rect = m.getBoundingClientRect();
            const parentRect = parentMenu.getBoundingClientRect();
            return rect.left >= parentRect.right - 10;
        });

        if (parentIndex >= 0) {
            const toRemove = this.submenus_.splice(parentIndex);
            for (const sub of toRemove) {
                sub.remove();
            }
        }
    }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const contextMenu = new ContextMenuManager();

export function showContextMenu(options: ContextMenuOptions): void {
    contextMenu.show(options);
}

export function hideContextMenu(): void {
    contextMenu.hide();
}
