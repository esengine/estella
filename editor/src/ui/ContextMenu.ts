/**
 * @file    ContextMenu.ts
 * @brief   Context menu component with submenu support and keyboard navigation
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
    private activeMenu_: HTMLElement | null = null;
    private focusedIndex_: number = -1;
    private hideTimeouts_: Set<number> = new Set();

    show(options: ContextMenuOptions): void {
        this.hide();

        const existingMenu = document.querySelector('.es-context-menu');
        existingMenu?.remove();

        this.root_ = this.createMenu(options.items, options.x, options.y, true);
        document.body.appendChild(this.root_);
        this.activeMenu_ = this.root_;
        this.focusedIndex_ = -1;

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
            this.handleKeyDown(e);
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
        this.activeMenu_ = null;
        this.focusedIndex_ = -1;
        for (const id of this.hideTimeouts_) {
            clearTimeout(id);
        }
        this.hideTimeouts_.clear();
        if (this.closeHandler_) {
            document.removeEventListener('mousedown', this.closeHandler_);
            this.closeHandler_ = null;
        }
        if (this.keyHandler_) {
            document.removeEventListener('keydown', this.keyHandler_);
            this.keyHandler_ = null;
        }
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (!this.activeMenu_) return;

        const actionItems = this.getActionItems(this.activeMenu_);
        if (actionItems.length === 0) return;

        switch (e.key) {
            case 'Escape': {
                if (this.submenus_.length > 0 && this.activeMenu_ !== this.root_) {
                    this.closeActiveSubmenu();
                } else {
                    this.hide();
                }
                e.preventDefault();
                break;
            }
            case 'ArrowDown': {
                this.focusedIndex_ = this.focusedIndex_ < actionItems.length - 1
                    ? this.focusedIndex_ + 1
                    : 0;
                this.updateFocus(actionItems);
                e.preventDefault();
                break;
            }
            case 'ArrowUp': {
                this.focusedIndex_ = this.focusedIndex_ > 0
                    ? this.focusedIndex_ - 1
                    : actionItems.length - 1;
                this.updateFocus(actionItems);
                e.preventDefault();
                break;
            }
            case 'ArrowRight': {
                const focused = actionItems[this.focusedIndex_];
                if (focused?.classList.contains('es-has-submenu')) {
                    focused.dispatchEvent(new MouseEvent('mouseenter'));
                    setTimeout(() => {
                        const lastSub = this.submenus_[this.submenus_.length - 1];
                        if (lastSub) {
                            this.activeMenu_ = lastSub;
                            this.focusedIndex_ = 0;
                            this.updateFocus(this.getActionItems(lastSub));
                        }
                    }, 0);
                }
                e.preventDefault();
                break;
            }
            case 'ArrowLeft': {
                if (this.submenus_.length > 0 && this.activeMenu_ !== this.root_) {
                    this.closeActiveSubmenu();
                }
                e.preventDefault();
                break;
            }
            case 'Enter': {
                const focused = actionItems[this.focusedIndex_];
                if (focused && !focused.classList.contains('es-disabled')) {
                    if (focused.classList.contains('es-has-submenu')) {
                        focused.dispatchEvent(new MouseEvent('mouseenter'));
                        setTimeout(() => {
                            const lastSub = this.submenus_[this.submenus_.length - 1];
                            if (lastSub) {
                                this.activeMenu_ = lastSub;
                                this.focusedIndex_ = 0;
                                this.updateFocus(this.getActionItems(lastSub));
                            }
                        }, 0);
                    } else {
                        focused.click();
                    }
                }
                e.preventDefault();
                break;
            }
        }
    }

    private getActionItems(menu: HTMLElement): HTMLElement[] {
        return Array.from(menu.querySelectorAll(':scope > .es-context-menu-item'));
    }

    private updateFocus(items: HTMLElement[]): void {
        if (!this.activeMenu_) return;
        for (const el of items) {
            el.classList.remove('es-focused');
        }
        const focused = items[this.focusedIndex_];
        if (focused) {
            focused.classList.add('es-focused');
            focused.scrollIntoView({ block: 'nearest' });
        }
    }

    private closeActiveSubmenu(): void {
        const lastSub = this.submenus_.pop();
        if (lastSub) {
            lastSub.remove();
        }
        this.activeMenu_ = this.submenus_.length > 0
            ? this.submenus_[this.submenus_.length - 1]
            : this.root_;
        this.focusedIndex_ = -1;
        if (this.activeMenu_) {
            const items = this.getActionItems(this.activeMenu_);
            const active = this.activeMenu_.querySelector('.es-has-submenu.es-focused, .es-has-submenu:hover');
            if (active) {
                this.focusedIndex_ = items.indexOf(active as HTMLElement);
            }
        }
    }

    private createMenu(items: ContextMenuItem[], x: number, y: number, isRoot: boolean): HTMLElement {
        const menu = document.createElement('div');
        menu.className = 'es-context-menu';
        menu.addEventListener('contextmenu', (e) => e.preventDefault());

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

            el.addEventListener('mouseenter', () => {
                if (this.activeMenu_ === menu || this.activeMenu_ === null) {
                    const actionItems = this.getActionItems(menu);
                    this.activeMenu_ = menu;
                    this.focusedIndex_ = actionItems.indexOf(el);
                    this.updateFocus(actionItems);
                }
            });

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
                        this.hideTimeouts_.delete(hideTimeout);
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
                        this.hideTimeouts_.delete(hideTimeout!);
                        if (submenu) {
                            const idx = this.submenus_.indexOf(submenu);
                            if (idx >= 0) {
                                this.submenus_.splice(idx, 1);
                            }
                            submenu.remove();
                            submenu = null;
                        }
                    }, 100);
                    this.hideTimeouts_.add(hideTimeout);
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
