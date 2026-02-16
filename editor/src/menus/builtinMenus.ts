import { registerMenu, registerMenuItem } from './MenuRegistry';
import type { Editor } from '../Editor';
import { getEditorContext } from '../context/EditorContext';
import { showStatusBarMessage } from './builtinStatusbar';
import { showConfirmDialog } from '../ui/dialog';
import type { Entity } from 'esengine';

export function registerBuiltinMenus(editor: Editor): void {
    registerMenu({ id: 'file', label: 'File', order: 0 });
    registerMenu({ id: 'edit', label: 'Edit', order: 1 });
    registerMenu({ id: 'view', label: 'View', order: 2 });
    registerMenu({ id: 'help', label: 'Help', order: 3 });

    registerMenuItem({
        id: 'file.new', menu: 'file', label: 'New Scene',
        shortcut: 'Ctrl+N', order: 0,
        action: () => editor.newScene(),
    });
    registerMenuItem({
        id: 'file.open', menu: 'file', label: 'Open...',
        shortcut: 'Ctrl+O', order: 1,
        action: () => editor.loadScene(),
    });
    registerMenuItem({
        id: 'file.save', menu: 'file', label: 'Save',
        shortcut: 'Ctrl+S', order: 2, separator: true,
        action: () => editor.saveScene(),
    });
    registerMenuItem({
        id: 'file.save-as', menu: 'file', label: 'Save As...',
        shortcut: 'Ctrl+Shift+S', order: 3,
        action: () => editor.saveSceneAs(),
    });
    registerMenuItem({
        id: 'file.preview', menu: 'file', label: 'Preview',
        shortcut: 'F5', order: 4, separator: true,
        action: () => editor.togglePreview(),
    });
    registerMenuItem({
        id: 'file.stop-preview', menu: 'file', label: 'Stop Preview',
        shortcut: 'Shift+F5', order: 5,
        action: () => editor.stopPreview(),
        hidden: true,
    });
    registerMenuItem({
        id: 'file.build-settings', menu: 'file', label: 'Build Settings...',
        shortcut: 'Ctrl+Shift+B', order: 6, separator: true,
        action: () => editor.showBuildSettings(),
    });

    registerMenuItem({
        id: 'edit.undo', menu: 'edit', label: 'Undo',
        shortcut: 'Ctrl+Z', order: 0,
        enabled: () => editor.store.canUndo,
        action: () => {
            const desc = editor.store.undoDescription;
            editor.store.undo();
            if (desc) showStatusBarMessage(`Undo: ${desc}`);
        },
    });
    registerMenuItem({
        id: 'edit.redo', menu: 'edit', label: 'Redo',
        shortcut: 'Ctrl+Y', order: 1,
        enabled: () => editor.store.canRedo,
        action: () => {
            const desc = editor.store.redoDescription;
            editor.store.redo();
            if (desc) showStatusBarMessage(`Redo: ${desc}`);
        },
    });
    registerMenuItem({
        id: 'edit.redo-alt', menu: 'edit', label: 'Redo (Alt)',
        shortcut: 'Ctrl+Shift+Z', order: 1,
        enabled: () => editor.store.canRedo,
        action: () => {
            const desc = editor.store.redoDescription;
            editor.store.redo();
            if (desc) showStatusBarMessage(`Redo: ${desc}`);
        },
        hidden: true,
    });
    registerMenuItem({
        id: 'edit.delete', menu: 'edit', label: 'Delete',
        shortcut: 'Delete', order: 2, separator: true,
        enabled: () => editor.store.selectedEntities.size > 0,
        action: () => {
            if (editor.store.selectedEntities.size === 1) {
                const id = Array.from(editor.store.selectedEntities)[0];
                editor.store.deleteEntity(id as Entity);
            } else if (editor.store.selectedEntities.size > 1) {
                editor.store.deleteSelectedEntities();
            }
        },
    });
    registerMenuItem({
        id: 'edit.duplicate', menu: 'edit', label: 'Duplicate',
        shortcut: 'Ctrl+D', order: 3,
        enabled: () => editor.store.selectedEntities.size > 0,
        action: () => editor.duplicateSelected(),
    });
    registerMenuItem({
        id: 'edit.copy', menu: 'edit', label: 'Copy',
        shortcut: 'Ctrl+C', order: 4,
        enabled: () => editor.store.selectedEntities.size > 0,
        action: () => editor.copySelected(),
    });
    registerMenuItem({
        id: 'edit.cut', menu: 'edit', label: 'Cut',
        shortcut: 'Ctrl+X', order: 4.5,
        enabled: () => editor.store.selectedEntities.size > 0,
        action: () => {
            editor.copySelected();
            if (editor.store.selectedEntities.size === 1) {
                const id = Array.from(editor.store.selectedEntities)[0];
                editor.store.deleteEntity(id as Entity);
            } else if (editor.store.selectedEntities.size > 1) {
                editor.store.deleteSelectedEntities();
            }
        },
    });
    registerMenuItem({
        id: 'edit.paste', menu: 'edit', label: 'Paste',
        shortcut: 'Ctrl+V', order: 5,
        enabled: () => editor.hasClipboard(),
        action: () => editor.pasteEntity(),
    });
    registerMenuItem({
        id: 'edit.create-entity', menu: 'edit', label: 'Create Entity',
        shortcut: 'Ctrl+Shift+N', order: 6,
        action: () => editor.store.createEntity('New Entity', editor.store.selectedEntity),
        hidden: true,
    });
    registerMenuItem({
        id: 'edit.preferences', menu: 'edit', label: 'Settings...',
        shortcut: 'Ctrl+,', order: 10, separator: true,
        action: () => editor.showSettings(),
    });

    registerMenuItem({
        id: 'view.hierarchy', menu: 'view', label: 'Hierarchy', order: 0,
        action: () => editor.showPanel('hierarchy'),
    });
    registerMenuItem({
        id: 'view.inspector', menu: 'view', label: 'Inspector', order: 1,
        action: () => editor.showPanel('inspector'),
    });
    registerMenuItem({
        id: 'view.content-browser', menu: 'view', label: 'Content Browser',
        shortcut: 'Ctrl+Space', order: 2,
        action: () => editor.showPanel('content-browser'),
    });
    registerMenuItem({
        id: 'view.output', menu: 'view', label: 'Output', order: 3,
        action: () => editor.showPanel('output'),
    });
    registerMenuItem({
        id: 'view.addressable', menu: 'view', label: 'Addressable Groups',
        order: 4, separator: true,
        action: () => editor.showAddressableWindow(),
    });
    registerMenuItem({
        id: 'view.reset-layout', menu: 'view', label: 'Reset Layout',
        order: 5, separator: true,
        action: () => editor.resetLayout(),
    });
    registerMenuItem({
        id: 'view.reload-extensions', menu: 'view', label: 'Reload Extensions',
        order: 10, separator: true,
        action: async () => {
            const confirmed = await showConfirmDialog({
                title: 'Reload Extensions',
                message: 'Reload all extensions? This will reset any extension state.',
                confirmText: 'Reload',
            });
            if (confirmed) editor.reloadExtensions();
        },
    });
    registerMenuItem({
        id: 'view.reload', menu: 'view', label: 'Reload',
        shortcut: 'Ctrl+R', order: 20, separator: true,
        action: () => window.location.reload(),
    });
    registerMenuItem({
        id: 'view.devtools', menu: 'view', label: 'Developer Tools',
        shortcut: 'F12', order: 21,
        action: () => {
            const ctx = getEditorContext();
            ctx.invoke?.('toggle_devtools');
        },
    });

    registerMenuItem({
        id: 'view.focus-hierarchy', menu: 'view', label: 'Focus Hierarchy',
        shortcut: 'Ctrl+1', order: 30,
        action: () => editor.showPanel('hierarchy'),
        hidden: true,
    });
    registerMenuItem({
        id: 'view.focus-scene', menu: 'view', label: 'Focus Scene',
        shortcut: 'Ctrl+2', order: 31,
        action: () => editor.showPanel('scene'),
        hidden: true,
    });
    registerMenuItem({
        id: 'view.focus-inspector', menu: 'view', label: 'Focus Inspector',
        shortcut: 'Ctrl+3', order: 32,
        action: () => editor.showPanel('inspector'),
        hidden: true,
    });

    registerMenuItem({
        id: 'help.docs', menu: 'help', label: 'Documentation', order: 0,
        action: () => {
            const shell = getEditorContext().shell;
            if (shell) {
                shell.openUrl('https://esengine.github.io/microes/');
            } else {
                window.open('https://esengine.github.io/microes/', '_blank');
            }
        },
    });
    registerMenuItem({
        id: 'help.about', menu: 'help', label: 'About ESEngine', order: 1, separator: true,
        action: () => editor.showAboutDialog(),
    });
}
