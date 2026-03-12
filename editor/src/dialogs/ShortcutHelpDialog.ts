import { getAllMenus, getMenuItems } from '../menus/MenuRegistry';
import { getAllGizmos } from '../gizmos';

interface ShortcutEntry {
    label: string;
    shortcut: string;
}

interface ShortcutGroup {
    name: string;
    entries: ShortcutEntry[];
}

function collectShortcuts(): ShortcutGroup[] {
    const groups: ShortcutGroup[] = [];

    const menus = getAllMenus();
    for (const menu of menus) {
        const items = getMenuItems(menu.id);
        const entries: ShortcutEntry[] = [];
        for (const item of items) {
            if (item.shortcut && !item.hidden) {
                entries.push({ label: item.label, shortcut: formatShortcut(item.shortcut) });
            }
        }
        if (entries.length > 0) {
            groups.push({ name: menu.label, entries });
        }
    }

    const gizmos = getAllGizmos();
    const gizmoEntries: ShortcutEntry[] = [];
    for (const g of gizmos) {
        if (g.shortcut) {
            gizmoEntries.push({ label: g.name, shortcut: g.shortcut.toUpperCase() });
        }
    }
    if (gizmoEntries.length > 0) {
        groups.push({ name: 'Gizmos', entries: gizmoEntries });
    }

    groups.push({
        name: 'Scene View',
        entries: [
            { label: 'Cycle selection (overlap)', shortcut: formatShortcut('Alt') },
            { label: 'Deep select (deepest child)', shortcut: formatShortcut('Cmd+Click') },
            { label: 'Enter child', shortcut: 'Enter' },
            { label: 'Select parent', shortcut: 'Esc' },
        ],
    });

    groups.push({
        name: 'Hierarchy',
        entries: [
            { label: 'Recursive expand/collapse', shortcut: formatShortcut('Alt+Click') },
            { label: 'Move up in siblings', shortcut: formatShortcut('Cmd+[') },
            { label: 'Move down in siblings', shortcut: formatShortcut('Cmd+]') },
            { label: 'Select all', shortcut: formatShortcut('Cmd+A') },
            { label: 'Rename', shortcut: 'F2' },
        ],
    });

    groups.push({
        name: 'Inspector',
        entries: [
            { label: 'Fine drag (0.1x)', shortcut: 'Shift+Drag' },
            { label: 'Coarse drag (10x)', shortcut: 'Alt+Drag' },
        ],
    });

    return groups;
}

const isMac = navigator.platform.includes('Mac');

function formatShortcut(shortcut: string): string {
    if (isMac) {
        return shortcut
            .replace(/Ctrl\+/g, '\u2318')
            .replace(/Cmd\+/g, '\u2318')
            .replace(/Shift\+/g, '\u21E7')
            .replace(/Alt\+/g, '\u2325');
    }
    return shortcut.replace(/Cmd\+/g, 'Ctrl+');
}

function renderGroup(group: ShortcutGroup): string {
    const rows = group.entries.map(e =>
        `<div class="es-shortcut-row">
            <span class="es-shortcut-label">${e.label}</span>
            <kbd class="es-shortcut-key">${e.shortcut}</kbd>
        </div>`
    ).join('');
    return `<div class="es-shortcut-group">
        <div class="es-shortcut-group-title">${group.name}</div>
        ${rows}
    </div>`;
}

export function showShortcutHelpDialog(): void {
    const groups = collectShortcuts();

    const overlay = document.createElement('div');
    overlay.className = 'es-dialog-overlay';

    const mid = Math.ceil(groups.length / 2);
    const leftGroups = groups.slice(0, mid);
    const rightGroups = groups.slice(mid);

    overlay.innerHTML = `
        <div class="es-dialog" style="max-width: 640px;">
            <div class="es-dialog-header">
                <span class="es-dialog-title">Keyboard Shortcuts</span>
                <button class="es-dialog-close">&times;</button>
            </div>
            <div class="es-dialog-body" style="padding: 16px; max-height: 70vh; overflow-y: auto;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div>${leftGroups.map(renderGroup).join('')}</div>
                    <div>${rightGroups.map(renderGroup).join('')}</div>
                </div>
            </div>
            <div class="es-dialog-footer">
                <button class="es-dialog-btn es-dialog-btn-primary">OK</button>
            </div>
        </div>
    `;

    const close = () => overlay.remove();
    overlay.querySelector('.es-dialog-close')?.addEventListener('click', close);
    overlay.querySelector('.es-dialog-btn-primary')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', onKey);
        }
    });

    document.body.appendChild(overlay);
}
