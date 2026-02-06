import { registerStatusbarItem } from './MenuRegistry';
import { getPanelsByPosition } from '../panels/PanelRegistry';
import { icons } from '../utils/icons';
import type { Editor } from '../Editor';

export function registerBuiltinStatusbarItems(editor: Editor): void {
    const bottomPanels = getPanelsByPosition('bottom');

    for (const panel of bottomPanels) {
        const isPrimary = panel.defaultVisible;
        registerStatusbarItem({
            id: `toggle-${panel.id}`,
            position: 'left',
            order: panel.order ?? 0,
            render: (container) => {
                const btn = document.createElement('button');
                btn.className = `es-statusbar-btn${isPrimary ? ' es-statusbar-btn-primary' : ''}`;
                btn.dataset.bottomPanel = panel.id;
                btn.innerHTML = `${panel.icon ?? ''}<span>${panel.title}</span>`;

                if (isPrimary) {
                    btn.innerHTML += icons.chevronDown(10);
                }

                btn.addEventListener('click', () => editor.toggleBottomPanel(panel.id));
                container.appendChild(btn);

                return {
                    dispose() { btn.remove(); },
                    update() {
                        const isActive = editor.activeBottomPanelId === panel.id;
                        btn.classList.toggle('es-active', isActive);
                    },
                };
            },
        });
    }

    registerStatusbarItem({
        id: 'cmd-input',
        position: 'left',
        order: 100,
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
                        editor.executeCommand(command);
                        input.value = '';
                    }
                }
            });

            return { dispose() { wrapper.remove(); } };
        },
    });

    registerStatusbarItem({
        id: 'undo',
        position: 'right',
        order: 0,
        render: (container) => {
            const btn = document.createElement('button');
            btn.className = 'es-statusbar-btn';
            btn.dataset.action = 'undo';
            btn.title = 'Undo';
            btn.innerHTML = '<span>Undo</span>';
            btn.addEventListener('click', () => editor.store.undo());
            container.appendChild(btn);

            return { dispose() { btn.remove(); } };
        },
    });

    registerStatusbarItem({
        id: 'notifications',
        position: 'right',
        order: 10,
        render: (container) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'es-statusbar-icons';
            wrapper.innerHTML = `
                <button title="Notifications">${icons.list(12)}</button>
                <button title="Extensions">${icons.grid(12)}</button>
                <button title="Settings">${icons.settings(12)}</button>
            `;
            container.appendChild(wrapper);

            return { dispose() { wrapper.remove(); } };
        },
    });

    registerStatusbarItem({
        id: 'save-status',
        position: 'right',
        order: 100,
        render: (container) => {
            const wrapper = document.createElement('span');
            wrapper.innerHTML = `
                <span class="es-status-indicator es-status-saved">
                    ${icons.check(12)}
                    <span>All Saved</span>
                </span>
                <div class="es-statusbar-divider"></div>
                <span class="es-status-indicator">
                    <span>Version Control</span>
                </span>
            `;
            container.appendChild(wrapper);

            return {
                dispose() { wrapper.remove(); },
                update() {
                    const saved = wrapper.querySelector('.es-status-saved');
                    if (editor.store.isDirty) {
                        saved?.classList.add('es-hidden');
                    } else {
                        saved?.classList.remove('es-hidden');
                    }
                },
            };
        },
    });
}
