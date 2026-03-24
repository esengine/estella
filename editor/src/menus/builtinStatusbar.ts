import type { StatusbarItemDescriptor } from './MenuRegistry';
import { getPanelsByPosition } from '../panels/PanelRegistry';
import type { PluginRegistrar } from '../container';
import { STATUSBAR_ITEM } from '../container/tokens';
import { getEditorStore } from '../store';
import { getNavigationService, getShellService, getProjectService } from '../services';
import { icons } from '../utils/icons';

let statusMessageTimer_: ReturnType<typeof setTimeout> | null = null;
let statusMessageEl_: HTMLElement | null = null;

export function showStatusBarMessage(text: string, durationMs = 2000): void {
    if (!statusMessageEl_) return;
    statusMessageEl_.textContent = text;
    statusMessageEl_.style.display = '';
    if (statusMessageTimer_) clearTimeout(statusMessageTimer_);
    statusMessageTimer_ = setTimeout(() => {
        if (statusMessageEl_) statusMessageEl_.style.display = 'none';
    }, durationMs);
}

function createPanelToggleButton(panelId: string, label: string, icon: string | undefined, isPrimary: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `es-statusbar-btn${isPrimary ? ' es-statusbar-btn-primary' : ''}`;
    btn.dataset.panelToggle = panelId;
    btn.innerHTML = `${icon ?? ''}<span>${label}</span>`;
    btn.addEventListener('click', () => getNavigationService().togglePanel(panelId));
    return btn;
}

function updatePanelButtonState(btn: HTMLElement, panelId: string): void {
    const nav = getNavigationService();
    const collapsed = nav.isCollapsed(panelId);
    btn.classList.toggle('es-active', !collapsed);
}

export function registerBuiltinStatusbarItems(registrar: PluginRegistrar): void {
    const registerStatusbarItem = (d: StatusbarItemDescriptor) => registrar.provide(STATUSBAR_ITEM, d.id, d);

    const leftPanels = getPanelsByPosition('left');
    const PERMANENT_BOTTOM_PANELS = new Set(['content-browser', 'output', 'ai-chat']);
    const bottomPanels = getPanelsByPosition('bottom').filter(p => PERMANENT_BOTTOM_PANELS.has(p.id));
    const rightPanels = getPanelsByPosition('right');

    let orderCounter = 0;

    for (const panel of leftPanels) {
        registerStatusbarItem({
            id: `toggle-${panel.id}`,
            position: 'left',
            order: orderCounter++,
            render: (container) => {
                const btn = createPanelToggleButton(panel.id, panel.title, panel.icon, false);
                container.appendChild(btn);

                const unlisten = getNavigationService().onPanelToggle(() => updatePanelButtonState(btn, panel.id));
                updatePanelButtonState(btn, panel.id);

                return { dispose() { btn.remove(); unlisten(); } };
            },
        });
    }

    if (leftPanels.length > 0 && bottomPanels.length > 0) {
        registerStatusbarItem({
            id: 'divider-left-bottom',
            position: 'left',
            order: orderCounter++,
            render: (container) => {
                const div = document.createElement('div');
                div.className = 'es-statusbar-divider';
                container.appendChild(div);
                return { dispose() { div.remove(); } };
            },
        });
    }

    for (const panel of bottomPanels) {
        registerStatusbarItem({
            id: `toggle-${panel.id}`,
            position: 'left',
            order: orderCounter++,
            render: (container) => {
                const btn = createPanelToggleButton(panel.id, panel.title, panel.icon, true);
                container.appendChild(btn);

                const unlisten = getNavigationService().onPanelToggle(() => updatePanelButtonState(btn, panel.id));
                updatePanelButtonState(btn, panel.id);

                return { dispose() { btn.remove(); unlisten(); } };
            },
        });
    }

    registerStatusbarItem({
        id: 'cmd-input',
        position: 'left',
        order: 200,
        render: (container) => {
            const wrapper = document.createElement('span');
            wrapper.className = 'es-statusbar-cmd-wrapper';
            wrapper.innerHTML = `
                <div class="es-statusbar-divider"></div>
                <span class="es-cmd-prompt">&gt;</span>
                <input type="text" class="es-cmd-input" placeholder="pnpm install, npm run build..." />
            `;
            container.appendChild(wrapper);

            const input = wrapper.querySelector('.es-cmd-input') as HTMLInputElement;
            input?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const command = input.value.trim();
                    if (command) {
                        getShellService().executeCommand(command);
                        input.value = '';
                    }
                }
            });

            return { dispose() { wrapper.remove(); } };
        },
    });

    for (const panel of rightPanels) {
        registerStatusbarItem({
            id: `toggle-${panel.id}`,
            position: 'right',
            order: -20 + (panel.order ?? 0),
            render: (container) => {
                const btn = createPanelToggleButton(panel.id, panel.title, panel.icon, false);
                container.appendChild(btn);

                const unlisten = getNavigationService().onPanelToggle(() => updatePanelButtonState(btn, panel.id));
                updatePanelButtonState(btn, panel.id);

                return { dispose() { btn.remove(); unlisten(); } };
            },
        });
    }

    registerStatusbarItem({
        id: 'status-message',
        position: 'right',
        order: -10,
        render: (container) => {
            const el = document.createElement('span');
            el.className = 'es-statusbar-message';
            el.style.display = 'none';
            container.appendChild(el);
            statusMessageEl_ = el;
            return { dispose() { el.remove(); statusMessageEl_ = null; } };
        },
    });

    registerStatusbarItem({
        id: 'settings',
        position: 'right',
        order: 10,
        render: (container) => {
            const btn = document.createElement('button');
            btn.className = 'es-statusbar-btn';
            btn.title = 'Settings';
            btn.innerHTML = icons.settings(12);
            btn.addEventListener('click', () => getProjectService().showSettings());
            container.appendChild(btn);
            return { dispose() { btn.remove(); } };
        },
    });

    registerStatusbarItem({
        id: 'save-status',
        position: 'right',
        order: 100,
        render: (container) => {
            const indicator = document.createElement('span');
            indicator.className = 'es-status-indicator es-status-saved';
            indicator.innerHTML = icons.check(12);
            indicator.title = 'All saved';
            container.appendChild(indicator);

            return {
                dispose() { indicator.remove(); },
                update() {
                    const dirty = getEditorStore().isDirty;
                    indicator.className = `es-status-indicator ${dirty ? 'es-status-unsaved' : 'es-status-saved'}`;
                    indicator.innerHTML = dirty ? '<span class="es-unsaved-dot"></span>' : icons.check(12);
                    indicator.title = dirty ? 'Unsaved changes' : 'All saved';
                },
            };
        },
    });
}
