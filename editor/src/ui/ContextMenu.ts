/**
 * @file    ContextMenu.ts
 * @brief   Context menu component for right-click actions
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
    private menu_: HTMLElement | null = null;
    private closeHandler_: ((e: MouseEvent) => void) | null = null;
    private keyHandler_: ((e: KeyboardEvent) => void) | null = null;

    show(options: ContextMenuOptions): void {
        this.hide();

        this.menu_ = document.createElement('div');
        this.menu_.className = 'es-context-menu';

        const itemsHtml = options.items.map((item, index) => {
            if (item.separator) {
                return '<div class="es-context-menu-separator"></div>';
            }

            const disabledClass = item.disabled ? 'es-disabled' : '';
            const iconHtml = item.icon ? `<span class="es-context-menu-icon">${item.icon}</span>` : '';
            const shortcutHtml = item.shortcut ? `<span class="es-context-menu-shortcut">${item.shortcut}</span>` : '';

            return `
                <div class="es-context-menu-item ${disabledClass}" data-index="${index}">
                    ${iconHtml}
                    <span class="es-context-menu-label">${item.label}</span>
                    ${shortcutHtml}
                </div>
            `;
        }).join('');

        this.menu_.innerHTML = itemsHtml;

        // Position menu
        document.body.appendChild(this.menu_);

        // Adjust position if menu goes off screen
        const rect = this.menu_.getBoundingClientRect();
        let x = options.x;
        let y = options.y;

        if (x + rect.width > window.innerWidth) {
            x = window.innerWidth - rect.width - 5;
        }
        if (y + rect.height > window.innerHeight) {
            y = window.innerHeight - rect.height - 5;
        }

        this.menu_.style.left = `${x}px`;
        this.menu_.style.top = `${y}px`;

        // Event handlers
        this.menu_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const itemEl = target.closest('.es-context-menu-item') as HTMLElement;
            if (!itemEl || itemEl.classList.contains('es-disabled')) return;

            const index = parseInt(itemEl.dataset.index ?? '-1', 10);
            const item = options.items[index];
            if (item?.onClick) {
                item.onClick();
            }
            this.hide();
        });

        // Close on click outside
        this.closeHandler_ = (e: MouseEvent) => {
            if (!this.menu_?.contains(e.target as Node)) {
                this.hide();
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', this.closeHandler_!);
        }, 0);

        // Close on Escape
        this.keyHandler_ = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.keyHandler_);
    }

    hide(): void {
        if (this.menu_) {
            this.menu_.remove();
            this.menu_ = null;
        }
        if (this.closeHandler_) {
            document.removeEventListener('mousedown', this.closeHandler_);
            this.closeHandler_ = null;
        }
        if (this.keyHandler_) {
            document.removeEventListener('keydown', this.keyHandler_);
            this.keyHandler_ = null;
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
