// SPDX-License-Identifier: Apache-2.0
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
import { confirmDiscard } from '@/project/discardGuard';
import { EditorHistory } from '@/engine/EditorHistory';
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneModel } from '@/engine/SceneModel';
import { hasEntityClipboard } from '@/engine/entityClipboard';
import { ViewportController } from '@/engine/ViewportController';
import { applyFxPreview } from '@/engine/fxPreview';
import { dockApi } from '@/layout/dockApi';
import { panelDirtySource } from '@/layout/panelDirty';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import { MaterialDocument } from '@/material/MaterialDocument';
import { isTilePaintMode, exitTilePaint } from '@/tools/tileMode';
import { EDITOR_MODES } from '@/mode/editorModes';
import { activeMode } from '@/mode/activeMode';
import { useEditorMode } from '@/store/editorModeStore';
import { useEditorStore } from '@/store/editorStore';
import { useSelection } from '@/store/selectionStore';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';
import type { ToolMode } from '@/types';

const editor = () => useEditorStore.getState();
const sel = () => useSelection.getState();
// Selecting a transform tool while tile-painting must LEAVE paint mode (else the
// paint tool keeps owning the stroke and the palette button reads as a no-op).
// exitTilePaint sets the transform tool as it exits, so both paths agree.
const tool = (mode: ToolMode) => () => (isTilePaintMode() ? exitTilePaint(mode) : editor().setTool(mode));

// — File / project —
commands.register({
  id: 'scene.new',
  label: t('cmd.scene.new'),
  category: t('cat.file'),
  keybinding: 'mod+n',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: async () => {
    if (!(await confirmDiscard(t('discard.newScene')))) return;
    void ProjectStore.newScene().then(() => sel().select(null));
  },
});
commands.register({
  id: 'project.open',
  label: t('cmd.project.open'),
  category: t('cat.file'),
  keybinding: 'mod+o',
  run: async () => {
    if (!(await confirmDiscard(t('discard.openProject')))) return;
    void ProjectStore.openViaDialog().then((ok) => ok && sel().select(null));
  },
});
commands.register({
  id: 'project.save',
  label: t('cmd.project.save'),
  category: t('cat.file'),
  keybinding: 'mod+s',
  // Context-aware "save what you're looking at": if an asset editor panel is active,
  // Ctrl+S targets THAT document (else it was a scene-only no-op or, worse, it saved
  // the scene instead). Otherwise save the scene — enabled while it has unsaved edits
  // or is untitled (Save → Save As to give it a path the first time).
  isEnabled: () => {
    const p = ProjectStore.getSnapshot();
    if (!p) return false;
    const activeId = dockApi.activePanelId() ?? '';
    const active = panelDirtySource(activeId);
    if (active.docId) return active.isDirty();
    // A material edits in the Details panel (no docId of its own).
    if (activeId === 'details' && MaterialDocument.isOpen) return MaterialDocument.dirty;
    return EditorHistory.isDirty() || !p.currentScene;
  },
  run: () => {
    const activeId = dockApi.activePanelId() ?? '';
    const active = panelDirtySource(activeId);
    if (active.docId) {
      void DirtyRegistry.saveDoc(active.docId);
      return;
    }
    // Shared-Inspector editors have no dock docId: a material being edited in the
    // Details panel saves ITSELF on Cmd+S, not the scene.
    if (activeId === 'details' && MaterialDocument.isOpen) {
      void DirtyRegistry.saveDoc('material');
      return;
    }
    void ProjectStore.save().catch(() => ProjectStore.saveAsViaDialog());
  },
});
commands.register({
  id: 'project.saveAs',
  label: t('cmd.project.saveAs'),
  category: t('cat.file'),
  keybinding: 'mod+shift+s',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => void ProjectStore.saveAsViaDialog(),
});
commands.register({
  id: 'project.export',
  label: t('cmd.project.export'),
  category: t('cat.build'),
  keybinding: 'mod+shift+b',
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => editor().setBuildOpen(true),
});
commands.register({
  id: 'project.close',
  label: t('cmd.project.close'),
  category: t('cat.file'),
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: async () => {
    if (!(await confirmDiscard(t('discard.closeProject')))) return;
    editor().openLauncher();
  },
});

// — Edit / history —
commands.register({
  id: 'edit.undo',
  label: t('cmd.edit.undo'),
  category: t('cat.edit'),
  keybinding: 'mod+z',
  isEnabled: () => EditorHistory.canUndo(),
  run: () => EditorHistory.undo(),
});
commands.register({
  id: 'edit.redo',
  label: t('cmd.edit.redo'),
  category: t('cat.edit'),
  keybinding: ['mod+shift+z', 'mod+y'],
  isEnabled: () => EditorHistory.canRedo(),
  run: () => EditorHistory.redo(),
});

// — Entity —
commands.register({
  id: 'entity.add',
  label: t('cmd.entity.add'),
  category: t('cat.entity'),
  run: () => {
    const e = SceneCommands.addEntity();
    if (e != null) sel().select(e);
  },
});
commands.register({
  id: 'tilemap.new',
  label: t('cmd.tilemap.new'),
  category: t('cat.entity'),
  isEnabled: () => !!ProjectStore.getSnapshot(),
  // A tilemap needs a tileset palette. Zero → guide the user to make one; otherwise
  // open the picker so they choose the orientation (orthogonal / iso / staggered /
  // hex) AND the tileset up front, like Tiled's New Map dialog. createTilemapFromTileset
  // does all the entity wiring; the picker just gathers the grid + palette choice.
  run: () => {
    const list = ProjectStore.listAssets('tileset');
    if (list.length === 0) {
      Toasts.push(t('toast.noTileset'), 'warn');
      return;
    }
    editor().setTilemapPickerOpen(true);
  },
});
commands.register({
  id: 'entity.duplicate',
  label: t('cmd.entity.duplicate'),
  category: t('cat.entity'),
  keybinding: 'mod+d',
  isEnabled: () => sel().selectedIds.size > 0,
  run: () => {
    const dups = SceneCommands.duplicateEntities([...sel().selectedIds]);
    if (dups.length > 0) sel().selectMany(dups, dups[dups.length - 1]);
  },
});
commands.register({
  id: 'entity.delete',
  label: t('cmd.entity.delete'),
  category: t('cat.entity'),
  keybinding: ['delete', 'backspace'],
  isEnabled: () => sel().selectedIds.size > 0,
  // Despawn self-heals the selection (SelectionStore) — no manual deselect.
  run: () => SceneCommands.deleteEntities([...sel().selectedIds]),
});
commands.register({
  id: 'entity.copy',
  label: t('cmd.entity.copy'),
  category: t('cat.entity'),
  keybinding: 'mod+c',
  isEnabled: () => sel().selectedIds.size > 0,
  run: () => { SceneCommands.copyEntities([...sel().selectedIds]); },
});
commands.register({
  id: 'entity.cut',
  label: t('cmd.entity.cut'),
  category: t('cat.entity'),
  keybinding: 'mod+x',
  isEnabled: () => sel().selectedIds.size > 0,
  run: () => { SceneCommands.cutEntities([...sel().selectedIds]); },
});
commands.register({
  id: 'entity.paste',
  label: t('cmd.entity.paste'),
  category: t('cat.entity'),
  keybinding: 'mod+v',
  isEnabled: () => hasEntityClipboard(),
  // Paste under the lone selection's parent (as a sibling), else at the scene root.
  run: () => {
    const ids = [...sel().selectedIds];
    const parent = ids.length === 1 ? (SceneModel.entityBySource(ids[0])?.parent ?? null) : null;
    const roots = SceneCommands.pasteEntities(parent);
    if (roots.length > 0) sel().selectMany(roots, roots[0]);
  },
});
commands.register({
  id: 'edit.selectAll',
  label: t('cmd.edit.selectAll'),
  category: t('cat.edit'),
  keybinding: 'mod+a',
  isEnabled: () => SceneModel.entityOrder().length > 0,
  run: () => {
    const ids = SceneModel.entityOrder();
    if (ids.length) sel().selectMany(ids, ids[ids.length - 1]);
  },
});
commands.register({
  id: 'entity.deselect',
  label: t('cmd.entity.deselect'),
  category: t('cat.entity'),
  keybinding: 'escape',
  // Escape clears the selection — but not while playing, where Escape stops Play
  // (play.stop shares the binding; guarding here lets forEvent fall through to it).
  isEnabled: () => !editor().isPlaying && sel().selectedId != null,
  run: () => sel().select(null),
});

// — Transform tools —
commands.register({ id: 'tool.select', label: t('cmd.tool.select'), category: t('cat.tools'), keybinding: 'q', run: tool('select') });
commands.register({ id: 'tool.move', label: t('cmd.tool.move'), category: t('cat.tools'), keybinding: 'w', run: tool('move') });
commands.register({ id: 'tool.rotate', label: t('cmd.tool.rotate'), category: t('cat.tools'), keybinding: 'e', run: tool('rotate') });
commands.register({ id: 'tool.scale', label: t('cmd.tool.scale'), category: t('cat.tools'), keybinding: 'r', run: tool('scale') });

// — Editor modes — pin an explicit editing context (Scene/UI/Tilemap) and reveal its
// companion panels. Without a pin the mode follows the selection; a pin holds until the
// selection implies another mode. Opening the panels here folds in the old dedicated
// Tilemap-painter launcher (clicking Tilemap mode reveals the painter).
for (const m of EDITOR_MODES) {
  commands.register({
    id: `mode.${m.id}`,
    label: t(`cmd.mode.${m.id}`),
    category: t('cat.tools'),
    isChecked: () => activeMode().id === m.id,
    run: () => {
      useEditorMode.getState().setMode(m.id);
      for (const p of m.panels ?? []) {
        dockApi.openSidePanel(p.id, p.component, p.title, p.side ?? 'left', p.width ?? 300);
      }
      // A mode with a design frame (UI) is entered to work against the authored screen;
      // the free editor camera never adopts the design aspect, so frame it on entry so
      // the design resolution (e.g. a portrait 750×1334) reads at once instead of hiding
      // as a thin outline. Only on this explicit entry — selection-suggested switches
      // must not steal the user's pan/zoom.
      if (m.overlays?.designFrame) ViewportController.frameCanvas();
    },
  });
}

// — Keyboard nudge — arrow keys move the selection by one grid step (Shift = ×10),
// world +Y is up so ArrowUp adds to Y. One undo step; the Outliner stops arrows from
// reaching here while it's focused (tree nav owns them there).
function nudgeSelection(ux: number, uy: number, big: boolean): void {
  const ids = [...sel().selectedIds];
  if (!ids.length) return;
  const step = editor().snapStep * (big ? 10 : 1);
  SceneCommands.transact('Nudge', () => {
    for (const sid of ids) {
      const rt = SceneModel.runtimeFor(sid);
      const pos = rt != null ? ViewportController.getEntityWorldXY(rt) : null;
      if (pos) SceneCommands.setEntityXY(sid, pos.x + ux * step, pos.y + uy * step);
    }
  });
}
const NUDGES: Array<{ id: string; key: string; ux: number; uy: number; big: boolean }> = [
  { id: 'entity.nudgeLeft', key: 'left', ux: -1, uy: 0, big: false },
  { id: 'entity.nudgeRight', key: 'right', ux: 1, uy: 0, big: false },
  { id: 'entity.nudgeUp', key: 'up', ux: 0, uy: 1, big: false },
  { id: 'entity.nudgeDown', key: 'down', ux: 0, uy: -1, big: false },
  { id: 'entity.nudgeLeftBig', key: 'shift+left', ux: -1, uy: 0, big: true },
  { id: 'entity.nudgeRightBig', key: 'shift+right', ux: 1, uy: 0, big: true },
  { id: 'entity.nudgeUpBig', key: 'shift+up', ux: 0, uy: 1, big: true },
  { id: 'entity.nudgeDownBig', key: 'shift+down', ux: 0, uy: -1, big: true },
];
for (const n of NUDGES) {
  commands.register({
    id: n.id,
    label: t('cmd.entity.nudge'),
    category: t('cat.entity'),
    keybinding: n.key,
    isEnabled: () => sel().selectedIds.size > 0,
    run: () => nudgeSelection(n.ux, n.uy, n.big),
  });
}

// — Viewport / view —
commands.register({
  id: 'view.frameSelected',
  label: t('cmd.view.frameSelected'),
  category: t('cat.view'),
  keybinding: 'f',
  isEnabled: () => sel().selectedId != null,
  run: () => {
    // Selection holds source ids; the viewport works on runtime entities.
    const ids = [...sel().selectedIds]
      .map((sid) => SceneModel.runtimeFor(sid))
      .filter((rt): rt is NonNullable<typeof rt> => rt != null);
    if (ids.length > 0) ViewportController.frameSelection(ids);
  },
});
commands.register({
  id: 'view.toggleGrid',
  label: t('cmd.view.toggleGrid'),
  category: t('cat.view'),
  isChecked: () => editor().showGrid,
  run: () => editor().toggleGrid(),
});
commands.register({
  id: 'view.toggleGizmos',
  label: t('cmd.view.toggleGizmos'),
  category: t('cat.view'),
  isChecked: () => editor().showGizmos,
  run: () => editor().toggleGizmos(),
});
commands.register({
  id: 'view.togglePreviewFx',
  label: t('cmd.view.togglePreviewFx'),
  category: t('cat.view'),
  isChecked: () => editor().previewFx,
  run: () => {
    editor().togglePreviewFx();
    applyFxPreview(editor().previewFx);
  },
});
commands.register({
  id: 'view.toggleColliders',
  label: t('cmd.view.toggleColliders'),
  category: t('cat.view'),
  isChecked: () => editor().showColliders,
  run: () => editor().toggleColliders(),
});
commands.register({
  id: 'view.toggleTileCollision',
  label: t('cmd.view.toggleTileCollision'),
  category: t('cat.view'),
  isChecked: () => editor().showTileCollision,
  run: () => editor().toggleTileCollision(),
});
commands.register({
  id: 'view.toggleCoordSpace',
  label: t('cmd.view.toggleCoordSpace'),
  category: t('cat.view'),
  isChecked: () => editor().coordSpace === 'local',
  run: () => editor().toggleCoordSpace(),
});
commands.register({
  id: 'view.togglePivotMode',
  label: t('cmd.view.togglePivotMode'),
  category: t('cat.view'),
  isChecked: () => editor().pivotMode === 'pivot',
  run: () => editor().togglePivotMode(),
});
commands.register({
  id: 'view.toggleSnapping',
  label: t('cmd.view.toggleSnapping'),
  category: t('cat.view'),
  isChecked: () => editor().snapping,
  run: () => editor().toggleSnapping(),
});
commands.register({
  id: 'view.toggleMinimap',
  label: t('cmd.view.toggleMinimap'),
  category: t('cat.view'),
  isChecked: () => editor().showMinimap,
  run: () => editor().toggleMinimap(),
});
commands.register({
  id: 'view.toggleStats',
  label: t('cmd.view.toggleStats'),
  category: t('cat.view'),
  isChecked: () => editor().showStats,
  run: () => editor().toggleStats(),
});
commands.register({
  id: 'view.toggleCoords',
  label: t('cmd.view.toggleCoords'),
  category: t('cat.view'),
  isChecked: () => editor().showCoords,
  run: () => editor().toggleCoords(),
});

// — Editor —
commands.register({
  id: 'settings.open',
  label: t('cmd.settings.open'),
  category: t('cat.editor'),
  keybinding: 'mod+,',
  run: () => editor().setSettingsOpen(true),
});
commands.register({
  id: 'palette.open',
  label: t('cmd.palette.open'),
  category: t('cat.editor'),
  keybinding: 'mod+shift+p',
  run: () => editor().setPaletteOpen(true),
});

// — Play —
commands.register({
  id: 'play.toggle',
  label: t('cmd.play.toggle'),
  category: t('cat.play'),
  keybinding: 'f5',
  run: () => editor().togglePlay(),
});
commands.register({
  id: 'play.stop',
  label: t('cmd.play.stop'),
  category: t('cat.play'),
  keybinding: 'escape',
  isEnabled: () => editor().isPlaying,
  run: () => editor().stop(),
});
commands.register({
  id: 'play.pause',
  label: t('cmd.play.pause'),
  category: t('cat.play'),
  keybinding: 'f6',
  // Only while playing — and as a command it reaches the palette and popped-out
  // windows, where the toolbar Pause button doesn't exist.
  isEnabled: () => editor().isPlaying,
  run: () => editor().togglePause(),
});

// — Build —
commands.register({
  id: 'build.scripts',
  label: t('cmd.build.scripts'),
  category: t('cat.build'),
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () =>
    void window.estella?.project
      ?.buildScripts?.()
      .then(() => Toasts.push(t('toast.builtScripts'), 'success'))
      .catch(() => Toasts.push(t('toast.buildFailed'), 'error')),
});

// — Assets —
commands.register({
  id: 'project.resavePrefabs',
  label: t('cmd.project.resavePrefabs'),
  category: t('cat.file'),
  isEnabled: () => !!ProjectStore.getSnapshot(),
  run: () => void ProjectStore.resaveAllPrefabs(),
});
