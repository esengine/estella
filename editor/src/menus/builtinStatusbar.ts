import { registerStatusbarItem } from './MenuRegistry';
import { getPanelsByPosition } from '../panels/PanelRegistry';
import { icons } from '../utils/icons';
import type { Editor } from '../Editor';

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

                btn.addEventListener('click', () => editor.showPanel(panel.id));
                container.appendChild(btn);

                return {
                    dispose() { btn.remove(); },
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
        id: 'undo',
        position: 'right',
        order: 0,
        render: (container) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'es-statusbar-icons';

            const undoBtn = document.createElement('button');
            undoBtn.title = 'Undo';
            undoBtn.innerHTML = '<span>Undo</span>';
            undoBtn.addEventListener('click', () => {
                const desc = editor.store.undoDescription;
                editor.store.undo();
                if (desc) showStatusBarMessage(`Undo: ${desc}`);
            });

            const redoBtn = document.createElement('button');
            redoBtn.title = 'Redo';
            redoBtn.innerHTML = '<span>Redo</span>';
            redoBtn.addEventListener('click', () => {
                const desc = editor.store.redoDescription;
                editor.store.redo();
                if (desc) showStatusBarMessage(`Redo: ${desc}`);
            });

            wrapper.appendChild(undoBtn);
            wrapper.appendChild(redoBtn);
            container.appendChild(wrapper);

            return {
                dispose() { wrapper.remove(); },
                update() {
                    const undoDesc = editor.store.undoDescription;
                    const redoDesc = editor.store.redoDescription;
                    undoBtn.title = undoDesc ? `Undo: ${undoDesc}` : 'Undo';
                    redoBtn.title = redoDesc ? `Redo: ${redoDesc}` : 'Redo';
                    undoBtn.disabled = !editor.store.canUndo;
                    redoBtn.disabled = !editor.store.canRedo;
                },
            };
        },
    });

    registerStatusbarItem({
        id: 'notifications',
        position: 'right',
        order: 10,
        render: (container) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'es-statusbar-icons';

            const notifBtn = document.createElement('button');
            notifBtn.title = 'Notifications';
            notifBtn.innerHTML = icons.list(12);
            notifBtn.addEventListener('click', () => editor.showPanel('output'));

            const settingsBtn = document.createElement('button');
            settingsBtn.title = 'Settings';
            settingsBtn.innerHTML = icons.settings(12);
            settingsBtn.addEventListener('click', () => editor.showSettings());

            wrapper.appendChild(notifBtn);
            wrapper.appendChild(settingsBtn);
            container.appendChild(wrapper);

            return { dispose() { wrapper.remove(); } };
        },
    });

    registerStatusbarItem({
        id: 'save-status',
        position: 'right',
        order: 100,
        render: (container) => {
            container.innerHTML = `
                <span class="es-status-indicator es-status-saved">
                    ${icons.check(12)}
                    <span>All Saved</span>
                </span>
                <span class="es-status-indicator es-status-unsaved" style="display: none;">
                    <span class="es-unsaved-dot"></span>
                    <span>Unsaved Changes</span>
                </span>
            `;

            return {
                dispose() { container.innerHTML = ''; },
                update() {
                    const saved = container.querySelector('.es-status-saved') as HTMLElement;
                    const unsaved = container.querySelector('.es-status-unsaved') as HTMLElement;
                    if (editor.store.isDirty) {
                        if (saved) saved.style.display = 'none';
                        if (unsaved) unsaved.style.display = '';
                    } else {
                        if (saved) saved.style.display = '';
                        if (unsaved) unsaved.style.display = 'none';
                    }
                },
            };
        },
    });
}
