import { registerMenu, registerMenuItem } from './MenuRegistry';
import type { Editor } from '../Editor';

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
        id: 'file.build-settings', menu: 'file', label: 'Build Settings...',
        shortcut: 'Ctrl+Shift+B', order: 4, separator: true,
        action: () => editor.showBuildSettings(),
    });

    registerMenuItem({
        id: 'edit.undo', menu: 'edit', label: 'Undo',
        shortcut: 'Ctrl+Z', order: 0,
        enabled: () => editor.store.canUndo,
        action: () => editor.store.undo(),
    });
    registerMenuItem({
        id: 'edit.redo', menu: 'edit', label: 'Redo',
        shortcut: 'Ctrl+Y', order: 1,
        enabled: () => editor.store.canRedo,
        action: () => editor.store.redo(),
    });
    registerMenuItem({
        id: 'edit.delete', menu: 'edit', label: 'Delete',
        shortcut: 'Delete', order: 2, separator: true,
        enabled: () => editor.store.selectedEntity !== null,
        action: () => {
            const selected = editor.store.selectedEntity;
            if (selected !== null) editor.store.deleteEntity(selected);
        },
    });
    registerMenuItem({
        id: 'edit.duplicate', menu: 'edit', label: 'Duplicate',
        shortcut: 'Ctrl+D', order: 3,
        enabled: () => editor.store.selectedEntity !== null,
        action: () => editor.duplicateSelected(),
    });
    registerMenuItem({
        id: 'edit.preferences', menu: 'edit', label: 'Preferences...',
        shortcut: 'Ctrl+,', order: 10, separator: true,
        action: () => editor.showSettings(),
    });

    registerMenuItem({
        id: 'view.hierarchy', menu: 'view', label: 'Hierarchy', order: 0,
        action: () => editor.togglePanel('hierarchy'),
    });
    registerMenuItem({
        id: 'view.inspector', menu: 'view', label: 'Inspector', order: 1,
        action: () => editor.togglePanel('inspector'),
    });
    registerMenuItem({
        id: 'view.content-browser', menu: 'view', label: 'Content Browser', order: 2,
        action: () => editor.toggleBottomPanel('content-browser'),
    });
    registerMenuItem({
        id: 'view.output', menu: 'view', label: 'Output', order: 3,
        action: () => editor.toggleBottomPanel('output'),
    });
    registerMenuItem({
        id: 'view.reload-extensions', menu: 'view', label: 'Reload Extensions',
        order: 10, separator: true,
        action: () => editor.reloadExtensions(),
    });

    registerMenuItem({
        id: 'help.docs', menu: 'help', label: 'Documentation', order: 0,
        action: () => window.open('https://github.com/nicholaswan/ESEngine', '_blank'),
    });
    registerMenuItem({
        id: 'help.about', menu: 'help', label: 'About ESEngine', order: 1, separator: true,
        action: () => editor.showAboutDialog(),
    });
}
