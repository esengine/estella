// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editorCommands.ts
 * @brief   Registers every editor command. This is the ONE place each action,
 *          its enablement, and its keybinding are wired — App's keymap, the menu
 *          bar, the toolbar, and the viewport toolbar all dispatch through these
 *          ids rather than re-implementing the action + disabled logic per site.
 *          Importing this module performs the registration (side effect).
 */
import { commands } from './registry';
import { ProjectStore } from '@/project/ProjectStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { SceneCommands } from '@/engine/SceneCommands';
import { ViewportController } from '@/engine/ViewportController';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { Toasts } from '@/store/Toasts';
import type { ToolMode } from '@/types';

const editor = () => useEditorStore.getState();
const sel = () => useSelection.getState();
const tool = (mode: ToolMode) => () => editor().setTool(mode);

// — File / project —
commands.register({
  id: 'scene.new',
  label: 'New Scene',
  category: 'File',
  keybinding: 'mod+n',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => {
    // Discard guard: history is the editor's unsaved-changes proxy (no dirty flag).
    if (EditorHistory.canUndo() && !window.confirm('New scene? Unsaved changes will be lost.')) return;
    void ProjectStore.newScene().then(() => sel().select(null));
  },
});
commands.register({
  id: 'project.open',
  label: 'Open Project…',
  category: 'File',
  keybinding: 'mod+o',
  run: () => void ProjectStore.openViaDialog().then((ok) => ok && sel().select(null)),
});
commands.register({
  id: 'project.save',
  label: 'Save Scene',
  category: 'File',
  keybinding: 'mod+s',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => void ProjectStore.save().catch(() => ProjectStore.saveAsViaDialog()),
});
commands.register({
  id: 'project.saveAs',
  label: 'Save Scene As…',
  category: 'File',
  keybinding: 'mod+shift+s',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => void ProjectStore.saveAsViaDialog(),
});
commands.register({
  id: 'project.export',
  label: 'Build…',
  category: 'File',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => editor().setBuildOpen(true),
});
commands.register({
  id: 'project.close',
  label: 'Close Project',
  category: 'File',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => editor().openLauncher(),
});

// — Edit / history —
commands.register({
  id: 'edit.undo',
  label: 'Undo',
  category: 'Edit',
  keybinding: 'mod+z',
  isEnabled: () => EditorHistory.canUndo(),
  run: () => EditorHistory.undo(),
});
commands.register({
  id: 'edit.redo',
  label: 'Redo',
  category: 'Edit',
  keybinding: ['mod+shift+z', 'mod+y'],
  isEnabled: () => EditorHistory.canRedo(),
  run: () => EditorHistory.redo(),
});

// — Entity —
commands.register({
  id: 'entity.add',
  label: 'Add Entity',
  category: 'Entity',
  run: () => {
    const e = SceneCommands.addEntity();
    if (e != null) sel().select(e);
  },
});
commands.register({
  id: 'entity.duplicate',
  label: 'Duplicate',
  category: 'Entity',
  keybinding: 'mod+d',
  isEnabled: () => sel().selectedId != null,
  run: () => {
    const id = sel().selectedId;
    if (id == null) return;
    const dup = SceneCommands.duplicateEntity(id);
    if (dup != null) sel().select(dup);
  },
});
commands.register({
  id: 'entity.delete',
  label: 'Delete',
  category: 'Entity',
  keybinding: ['delete', 'backspace'],
  isEnabled: () => sel().selectedIds.size > 0,
  // Despawn self-heals the selection (SelectionStore) — no manual deselect.
  run: () => [...sel().selectedIds].forEach((id) => SceneCommands.deleteEntity(id)),
});
commands.register({
  id: 'entity.deselect',
  label: 'Deselect',
  category: 'Entity',
  isEnabled: () => sel().selectedId != null,
  run: () => sel().select(null),
});

// — Transform tools —
commands.register({ id: 'tool.select', label: 'Select Tool', category: 'Tools', keybinding: 'q', run: tool('select') });
commands.register({ id: 'tool.move', label: 'Move Tool', category: 'Tools', keybinding: 'w', run: tool('move') });
commands.register({ id: 'tool.rotate', label: 'Rotate Tool', category: 'Tools', keybinding: 'e', run: tool('rotate') });
commands.register({ id: 'tool.scale', label: 'Scale Tool', category: 'Tools', keybinding: 'r', run: tool('scale') });

// — Viewport / view —
commands.register({
  id: 'view.frameSelected',
  label: 'Frame Selected',
  category: 'View',
  keybinding: 'f',
  isEnabled: () => sel().selectedId != null,
  run: () => {
    const id = sel().selectedId;
    if (id != null) ViewportController.frameEntity(id);
  },
});
commands.register({
  id: 'view.toggleGrid',
  label: 'Show Grid',
  category: 'View',
  isChecked: () => editor().showGrid,
  run: () => editor().toggleGrid(),
});
commands.register({
  id: 'view.toggleGizmos',
  label: 'Show Gizmos',
  category: 'View',
  isChecked: () => editor().showGizmos,
  run: () => editor().toggleGizmos(),
});
commands.register({
  id: 'view.toggleSnapping',
  label: 'Snapping',
  category: 'View',
  isChecked: () => editor().snapping,
  run: () => editor().toggleSnapping(),
});

// — Editor —
commands.register({
  id: 'settings.open',
  label: 'Settings…',
  category: 'Editor',
  keybinding: 'mod+,',
  run: () => editor().setSettingsOpen(true),
});

// — Play —
commands.register({
  id: 'play.toggle',
  label: 'Play',
  category: 'Play',
  keybinding: 'f5',
  run: () => editor().togglePlay(),
});
commands.register({
  id: 'play.stop',
  label: 'Stop',
  category: 'Play',
  keybinding: 'escape',
  isEnabled: () => editor().isPlaying,
  run: () => editor().stop(),
});

// — Build —
commands.register({
  id: 'build.scripts',
  label: 'Build Project Scripts',
  category: 'Build',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () =>
    void window.estella?.project
      ?.buildScripts?.()
      .then(() => Toasts.push('Built project scripts', 'success'))
      .catch(() => Toasts.push('Build failed', 'error')),
});
