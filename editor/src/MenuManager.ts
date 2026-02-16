import { getAllMenus, getMenuItems, getAllStatusbarItems } from './menus';
import { ShortcutManager } from './menus/ShortcutManager';
import { getPanelsByPosition } from './panels/PanelRegistry';
import { icons } from './utils/icons';

export class MenuManager {
    private statusbarInstances_: Array<{ dispose(): void; update?(): void }> = [];
    private shortcutManager_: ShortcutManager;

    constructor() {
        this.shortcutManager_ = new ShortcutManager();
    }

    get statusbarInstances(): Array<{ dispose(): void; update?(): void }> {
        return this.statusbarInstances_;
    }

    attach(): void {
        this.shortcutManager_.attach();
    }

    detach(): void {
        this.shortcutManager_.detach();
    }

    setupMenuShortcuts(): void {
        const menus = getAllMenus();
        for (const menu of menus) {
            const items = getMenuItems(menu.id);
            for (const item of items) {
                if (item.shortcut) {
                    this.shortcutManager_.register(item.shortcut, item.action);
                }
            }
        }
    }

    instantiateStatusbar(container: HTMLElement): void {
        const items = getAllStatusbarItems();
        const leftContainer = container.querySelector('.es-statusbar-left');
        const rightContainer = container.querySelector('.es-statusbar-right');

        for (const item of items) {
            const target = item.position === 'left' ? leftContainer : rightContainer;
            if (!target) continue;
            const span = document.createElement('span');
            span.dataset.statusbarId = item.id;
            target.appendChild(span);
            const instance = item.render(span);
            this.statusbarInstances_.push(instance);
        }
    }

    buildMenuBarHTML(): string {
        const menus = getAllMenus();
        return menus.map(menu => {
            const items = getMenuItems(menu.id);
            const itemsHTML = items.map(item => {
                const parts: string[] = [];
                if (item.separator) {
                    parts.push('<div class="es-menu-divider"></div>');
                }
                parts.push(`<div class="es-menu-item" data-action="${item.id}">`);
                parts.push(`<span class="es-menu-item-text">${item.label}</span>`);
                if (item.shortcut) {
                    parts.push(`<span class="es-menu-item-shortcut">${item.shortcut}</span>`);
                }
                parts.push('</div>');
                return parts.join('');
            }).join('');

            return `
                <div class="es-menu" data-menu="${menu.id}">
                    <div class="es-menu-trigger">${menu.label}</div>
                    <div class="es-menu-dropdown">${itemsHTML}</div>
                </div>
            `;
        }).join('');
    }

    buildStatusBarHTML(): string {
        return `
            <div class="es-editor-statusbar">
                <div class="es-statusbar-left"></div>
                <div class="es-statusbar-right"></div>
            </div>
        `;
    }

    rebuildMenuBar(container: HTMLElement): void {
        const menubar = container.querySelector('.es-editor-menubar');
        if (!menubar) return;

        menubar.querySelectorAll('.es-menu').forEach(el => el.remove());

        const spacer = menubar.querySelector('.es-menubar-spacer');
        if (!spacer) return;

        const fragment = document.createRange().createContextualFragment(this.buildMenuBarHTML());
        menubar.insertBefore(fragment, spacer);

        this.attachMenuTriggers(container);
    }

    attachMenuTriggers(container: HTMLElement): void {
        const menubar = container.querySelector('.es-editor-menubar');
        if (!menubar) return;

        menubar.querySelectorAll('.es-menu-trigger').forEach(trigger => {
            if ((trigger as any).__menuBound) return;
            (trigger as any).__menuBound = true;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = (trigger as HTMLElement).parentElement!;
                const isOpen = menu.classList.contains('es-open');
                menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
                if (!isOpen) {
                    menu.classList.add('es-open');
                }
            });

            trigger.addEventListener('mouseenter', () => {
                const hasOpen = menubar.querySelector('.es-menu.es-open');
                if (hasOpen && hasOpen !== trigger.parentElement) {
                    menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
                    const menu = (trigger as HTMLElement).parentElement!;
                    menu.classList.add('es-open');
                }
            });
        });
    }

    setupToolbarEvents(container: HTMLElement, onPreview: () => void): void {
        const menubar = container.querySelector('.es-editor-menubar');
        if (!menubar) return;

        let activeMenu: HTMLElement | null = null;

        const closeAllMenus = () => {
            menubar.querySelectorAll('.es-menu').forEach(m => m.classList.remove('es-open'));
            activeMenu = null;
        };

        menubar.querySelectorAll('.es-menu-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = (trigger as HTMLElement).parentElement!;
                const isOpen = menu.classList.contains('es-open');
                closeAllMenus();
                if (!isOpen) {
                    menu.classList.add('es-open');
                    activeMenu = menu;
                }
            });

            trigger.addEventListener('mouseenter', () => {
                if (activeMenu && activeMenu !== trigger.parentElement) {
                    closeAllMenus();
                    const menu = (trigger as HTMLElement).parentElement!;
                    menu.classList.add('es-open');
                    activeMenu = menu;
                }
            });
        });

        menubar.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const menuItem = target.closest('.es-menu-item') as HTMLElement;
            if (!menuItem) return;

            if (menuItem.classList.contains('es-disabled')) return;

            const actionId = menuItem.dataset.action;
            if (!actionId) return;

            closeAllMenus();

            const allMenus = getAllMenus();
            for (const menu of allMenus) {
                const items = getMenuItems(menu.id);
                const found = items.find(i => i.id === actionId);
                if (found) {
                    found.action();
                    return;
                }
            }
        });

        const previewBtn = menubar.querySelector('[data-action="preview"]');
        previewBtn?.addEventListener('click', () => onPreview());

        document.addEventListener('click', (e) => {
            if (!menubar.contains(e.target as Node)) {
                closeAllMenus();
            }
        });
    }

    updateToolbarState(container: HTMLElement): void {
        const allMenus = getAllMenus();
        for (const menu of allMenus) {
            const items = getMenuItems(menu.id);
            for (const item of items) {
                if (item.enabled) {
                    const el = container.querySelector(`[data-action="${item.id}"]`);
                    el?.classList.toggle('es-disabled', !item.enabled());
                }
            }
        }
    }

    updateStatusbar(): void {
        for (const instance of this.statusbarInstances_) {
            instance.update?.();
        }
    }

    addExtensionBottomPanelToggles(
        container: HTMLElement,
        activeBottomPanelId: string | null,
        onToggle: (id: string) => void,
    ): void {
        const leftContainer = container.querySelector('.es-statusbar-left');
        if (!leftContainer) return;

        for (const panel of getPanelsByPosition('bottom')) {
            if (leftContainer.querySelector(`[data-statusbar-id="toggle-${panel.id}"]`)) continue;

            const item = {
                id: `toggle-${panel.id}`,
                position: 'left' as const,
                render: (renderContainer: HTMLElement) => {
                    const btn = document.createElement('button');
                    btn.className = 'es-statusbar-btn';
                    btn.dataset.bottomPanel = panel.id;
                    btn.innerHTML = `${panel.icon ?? ''}<span>${panel.title}</span>`;
                    btn.addEventListener('click', () => onToggle(panel.id));
                    renderContainer.appendChild(btn);
                    return {
                        dispose() { btn.remove(); },
                        update: () => {
                            btn.classList.toggle('es-active', activeBottomPanelId === panel.id);
                        },
                    };
                },
            };

            const span = document.createElement('span');
            span.dataset.statusbarId = item.id;

            const cmdInputItem = leftContainer.querySelector('[data-statusbar-id="cmd-input"]');
            if (cmdInputItem) {
                leftContainer.insertBefore(span, cmdInputItem);
            } else {
                leftContainer.appendChild(span);
            }

            const instance = item.render(span);
            this.statusbarInstances_.push(instance);
        }
    }

    dispose(): void {
        this.shortcutManager_.detach();
        for (const instance of this.statusbarInstances_) {
            instance.dispose();
        }
        this.statusbarInstances_ = [];
    }
}
