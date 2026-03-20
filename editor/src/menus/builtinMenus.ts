import type { MenuDescriptor, MenuItemDescriptor } from './MenuRegistry';
import type { PluginRegistrar } from '../container';
import { MENU, MENU_ITEM } from '../container/tokens';
import { getEditorContext } from '../context/EditorContext';
import { showAboutDialog } from '../dialogs/AboutDialog';
import { showShortcutHelpDialog } from '../dialogs/ShortcutHelpDialog';
import { showAddressableWindow } from '../dialogs/AddressableWindow';
import { showStatusBarMessage } from './builtinStatusbar';
import { showConfirmDialog } from '../ui/dialog';
import { showCommandPalette } from '../ui/CommandPalette';
import { getEditorStore } from '../store';
import {
    getSceneService,
    getClipboardService,
    getPreviewService,
    getNavigationService,
    getProfilerService,
    getFrameDebuggerService,
    getProjectService,
    getExtensionService,
} from '../services';
import type { Entity } from 'esengine';

export function registerBuiltinMenus(registrar: PluginRegistrar): void {
    const registerMenu = (d: MenuDescriptor) => registrar.provide(MENU, d.id, d);
    const registerMenuItem = (d: MenuItemDescriptor) => registrar.provide(MENU_ITEM, d.id, d);
    registerMenu({ id: 'file', label: 'File', order: 0 });
    registerMenu({ id: 'edit', label: 'Edit', order: 1 });
    registerMenu({ id: 'view', label: 'View', order: 2 });
    registerMenu({ id: 'help', label: '\u22EF', order: 3 });

    registerMenuItem({
        id: 'file.new', menu: 'file', label: 'New Scene',
        shortcut: 'Ctrl+N', order: 0,
        action: () => getSceneService().newScene(),
    });
    registerMenuItem({
        id: 'file.open', menu: 'file', label: 'Open...',
        shortcut: 'Ctrl+O', order: 1,
        action: () => getSceneService().loadScene(),
    });
    registerMenuItem({
        id: 'file.save', menu: 'file', label: 'Save',
        shortcut: 'Ctrl+S', order: 2, separator: true,
        action: () => getSceneService().saveScene(),
    });
    registerMenuItem({
        id: 'file.save-as', menu: 'file', label: 'Save As...',
        shortcut: 'Ctrl+Shift+S', order: 3,
        action: () => getSceneService().saveSceneAs(),
    });
    registerMenuItem({
        id: 'file.preview', menu: 'file', label: 'Preview',
        shortcut: 'F5', order: 4, separator: true,
        action: () => getPreviewService().startPreview(),
    });
    registerMenuItem({
        id: 'file.build-settings', menu: 'file', label: 'Build Settings...',
        shortcut: 'Ctrl+Shift+B', order: 6, separator: true,
        action: () => getProjectService().showBuildSettings(),
    });

    registerMenuItem({
        id: 'edit.undo', menu: 'edit', label: 'Undo',
        shortcut: 'Ctrl+Z', order: 0,
        enabled: () => getEditorStore().canUndo,
        action: () => {
            const store = getEditorStore();
            const desc = store.undoDescription;
            store.undo();
            if (desc) showStatusBarMessage(`Undo: ${desc}`);
        },
    });
    registerMenuItem({
        id: 'edit.redo', menu: 'edit', label: 'Redo',
        shortcut: 'Ctrl+Y', order: 1,
        enabled: () => getEditorStore().canRedo,
        action: () => {
            const store = getEditorStore();
            const desc = store.redoDescription;
            store.redo();
            if (desc) showStatusBarMessage(`Redo: ${desc}`);
        },
    });
    registerMenuItem({
        id: 'edit.redo-alt', menu: 'edit', label: 'Redo (Alt)',
        shortcut: 'Ctrl+Shift+Z', order: 1,
        enabled: () => getEditorStore().canRedo,
        action: () => {
            const store = getEditorStore();
            const desc = store.redoDescription;
            store.redo();
            if (desc) showStatusBarMessage(`Redo: ${desc}`);
        },
        hidden: true,
    });
    registerMenuItem({
        id: 'edit.delete', menu: 'edit', label: 'Delete',
        shortcut: 'Delete', order: 2, separator: true,
        enabled: () => getEditorStore().selectedEntities.size > 0,
        action: () => {
            const store = getEditorStore();
            if (store.selectedEntities.size === 1) {
                const id = Array.from(store.selectedEntities)[0];
                store.deleteEntity(id as Entity);
            } else if (store.selectedEntities.size > 1) {
                store.deleteSelectedEntities();
            }
        },
    });
    registerMenuItem({
        id: 'edit.duplicate', menu: 'edit', label: 'Duplicate',
        shortcut: 'Ctrl+D', order: 3,
        enabled: () => getEditorStore().selectedEntities.size > 0,
        action: () => getClipboardService().duplicateSelected(),
    });
    registerMenuItem({
        id: 'edit.copy', menu: 'edit', label: 'Copy',
        shortcut: 'Ctrl+C', order: 4,
        enabled: () => getEditorStore().selectedEntities.size > 0,
        action: () => getClipboardService().copySelected(),
    });
    registerMenuItem({
        id: 'edit.cut', menu: 'edit', label: 'Cut',
        shortcut: 'Ctrl+X', order: 4.5,
        enabled: () => getEditorStore().selectedEntities.size > 0,
        action: () => {
            const store = getEditorStore();
            getClipboardService().copySelected();
            if (store.selectedEntities.size === 1) {
                const id = Array.from(store.selectedEntities)[0];
                store.deleteEntity(id as Entity);
            } else if (store.selectedEntities.size > 1) {
                store.deleteSelectedEntities();
            }
        },
    });
    registerMenuItem({
        id: 'edit.paste', menu: 'edit', label: 'Paste',
        shortcut: 'Ctrl+V', order: 5,
        enabled: () => getClipboardService().hasClipboard(),
        action: () => getClipboardService().pasteEntity(),
    });
    registerMenuItem({
        id: 'edit.create-entity', menu: 'edit', label: 'Create Entity',
        shortcut: 'Ctrl+Shift+N', order: 6,
        action: () => {
            const store = getEditorStore();
            store.createEntity('New Entity', store.selectedEntity);
        },
        hidden: true,
    });
    registerMenuItem({
        id: 'edit.command-palette', menu: 'edit', label: 'Command Palette',
        shortcut: 'Ctrl+K', order: 9, separator: true,
        action: () => showCommandPalette(),
    });
    registerMenuItem({
        id: 'edit.preferences', menu: 'edit', label: 'Settings...',
        shortcut: 'Ctrl+,', order: 10,
        action: () => getProjectService().showSettings(),
    });

    registerMenuItem({
        id: 'view.panels', menu: 'view', label: 'Panels', order: 0,
        action: () => {},
    });
    registerMenuItem({
        id: 'view.hierarchy', menu: 'view', label: 'Hierarchy', order: 0,
        shortcut: 'Ctrl+Shift+H', submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('hierarchy'),
    });
    registerMenuItem({
        id: 'view.inspector', menu: 'view', label: 'Inspector', order: 1,
        shortcut: 'Ctrl+Shift+I', submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('inspector'),
    });
    registerMenuItem({
        id: 'view.content-browser', menu: 'view', label: 'Content Browser',
        shortcut: 'Ctrl+Space', order: 2, submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('content-browser'),
    });
    registerMenuItem({
        id: 'view.output', menu: 'view', label: 'Output', order: 3,
        submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('output'),
    });
    registerMenuItem({
        id: 'view.game', menu: 'view', label: 'Game', order: 4,
        submenu: 'view.panels',
        action: () => getNavigationService().showPanel('game'),
    });
    registerMenuItem({
        id: 'view.timeline', menu: 'view', label: 'Timeline', order: 5,
        submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('timeline'),
    });
    registerMenuItem({
        id: 'view.state-machine-graph', menu: 'view', label: 'State Machine',
        order: 6, submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('state-machine-graph'),
    });
    registerMenuItem({
        id: 'view.extensions', menu: 'view', label: 'Extensions', order: 7,
        submenu: 'view.panels',
        action: () => getNavigationService().togglePanel('extensions'),
    });
    registerMenuItem({
        id: 'view.addressable', menu: 'view', label: 'Addressable Groups',
        order: 8, submenu: 'view.panels',
        action: () => showAddressableWindow(),
    });

    registerMenuItem({
        id: 'view.layout', menu: 'view', label: 'Layout', order: 1,
        action: () => {},
    });
    registerMenuItem({
        id: 'view.toggle-bottom', menu: 'view', label: 'Toggle Bottom Panel',
        shortcut: 'Ctrl+J', order: 0, submenu: 'view.layout',
        action: () => getNavigationService().toggleRegion('bottom'),
    });
    registerMenuItem({
        id: 'view.toggle-sidebars', menu: 'view', label: 'Toggle Sidebars',
        shortcut: 'Ctrl+\\', order: 1, submenu: 'view.layout',
        action: () => getNavigationService().toggleAllSidebars(),
    });
    registerMenuItem({
        id: 'view.reset-layout', menu: 'view', label: 'Reset Layout',
        order: 2, submenu: 'view.layout',
        action: () => getNavigationService().resetLayout(),
    });

    registerMenuItem({
        id: 'view.profiler', menu: 'view', label: 'Profiler',
        order: 10, separator: true,
        action: () => getProfilerService()?.showProfilerWindow(),
    });
    registerMenuItem({
        id: 'view.frame-debugger', menu: 'view', label: 'Frame Debugger',
        order: 11,
        action: () => getFrameDebuggerService()?.showFrameDebuggerWindow(),
    });

    registerMenuItem({
        id: 'view.reload-extensions', menu: 'view', label: 'Reload Extensions',
        order: 20, separator: true,
        action: async () => {
            const confirmed = await showConfirmDialog({
                title: 'Reload Extensions',
                message: 'Reload all extensions? This will reset any extension state.',
                confirmText: 'Reload',
            });
            if (confirmed) getExtensionService().reload();
        },
    });
    registerMenuItem({
        id: 'view.reload', menu: 'view', label: 'Reload',
        shortcut: 'Ctrl+R', order: 21,
        action: () => window.location.reload(),
    });
    registerMenuItem({
        id: 'view.devtools', menu: 'view', label: 'Developer Tools',
        shortcut: 'F12', order: 22,
        action: () => {
            const ctx = getEditorContext();
            ctx.invoke?.('toggle_devtools');
        },
    });

    registerMenuItem({
        id: 'view.focus-hierarchy', menu: 'view', label: 'Focus Hierarchy',
        shortcut: 'Ctrl+1', order: 30,
        action: () => getNavigationService().showPanel('hierarchy'),
        hidden: true,
    });
    registerMenuItem({
        id: 'view.focus-scene', menu: 'view', label: 'Focus Scene',
        shortcut: 'Ctrl+2', order: 31,
        action: () => getNavigationService().showPanel('scene'),
        hidden: true,
    });
    registerMenuItem({
        id: 'view.focus-inspector', menu: 'view', label: 'Focus Inspector',
        shortcut: 'Ctrl+3', order: 32,
        action: () => getNavigationService().showPanel('inspector'),
        hidden: true,
    });

    registerMenuItem({
        id: 'help.docs', menu: 'help', label: 'Documentation', order: 0,
        action: () => {
            const shell = getEditorContext().shell;
            if (shell) {
                shell.openUrl('https://estellaengine.com/docs/');
            } else {
                window.open('https://estellaengine.com/docs/', '_blank');
            }
        },
    });
    registerMenuItem({
        id: 'help.shortcuts', menu: 'help', label: 'Keyboard Shortcuts', order: 0.5,
        shortcut: '?',
        action: () => showShortcutHelpDialog(),
    });
    registerMenuItem({
        id: 'help.about', menu: 'help', label: 'About ESEngine', order: 1, separator: true,
        action: () => showAboutDialog(),
    });
}
