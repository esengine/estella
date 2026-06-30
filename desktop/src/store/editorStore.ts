// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';
import type { ToolMode } from '@/types';
import type { GizmoAxis } from '@/tools/gizmo';

// Global editor UI state (tools, viewport toggles, play state, launcher gate).
// Entity selection lives in its own engine-anchored store — see selectionStore.ts;
// outliner tree state (expansion / search) lives in the OutlinerController.
interface EditorState {
  // Active manipulation tool (select / move / rotate / scale).
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;

  // Play-in-editor state.
  isPlaying: boolean;
  isPaused: boolean;
  togglePlay: () => void;
  togglePause: () => void;
  stop: () => void;
  // Where Play runs: in the Viewport (UE5 PIE, default) or a separate Game tab.
  playTarget: 'viewport' | 'window';
  setPlayTarget: (t: 'viewport' | 'window') => void;
  // Which world the Outliner/Details inspect: the edit scene or the live game
  // (UE5 world picker). Auto-flips to 'game' on Play, 'editor' on Stop.
  inspectWorld: 'editor' | 'game';
  setInspectWorld: (w: 'editor' | 'game') => void;

  // Launcher (project browser) vs editor shell. The editor opens on the
  // launcher until a project is opened/created; `enterEditor` dismisses it.
  showLauncher: boolean;
  enterEditor: () => void;
  openLauncher: () => void;

  // Viewport overlays.
  showGrid: boolean;
  showGizmos: boolean;
  /** Draw collider outlines in the viewport (off declutters a physics-heavy scene). */
  showColliders: boolean;
  snapping: boolean;
  // Grid-snap increment (world units) applied to Move while `snapping` is on. The
  // viewport snap dropdown picks from a fixed set (16 / 32 / 64); "off" flips
  // `snapping` rather than changing the step, so the last step survives a re-enable.
  snapStep: number;
  // Rotate / scale snap increments, gated by the same `snapping` master toggle as
  // grid move-snap (degrees, and a uniform scale step). Replaces the old hardcoded
  // 15° / 0.1 constants so they're user-tunable from the viewport snap menu.
  snapAngle: number;
  snapScale: number;
  /** Gizmo axis frame: world-aligned, or rotated to the active entity's local axes. */
  coordSpace: 'world' | 'local';
  /** Gizmo pivot: the selection's centroid (center), or the active entity's own pivot. */
  pivotMode: 'center' | 'pivot';
  toggleCoordSpace: () => void;
  togglePivotMode: () => void;
  /** Axis of the gizmo handle currently being dragged (null = none) — drives the
   *  handle's active highlight. Set by the transform tool on grab, cleared on release. */
  activeGizmoAxis: GizmoAxis | null;
  setActiveGizmoAxis: (axis: GizmoAxis | null) => void;
  toggleGrid: () => void;
  toggleGizmos: () => void;
  toggleColliders: () => void;
  toggleSnapping: () => void;
  setSnapStep: (step: number) => void;
  setSnapAngle: (deg: number) => void;
  setSnapScale: (step: number) => void;

  // Content Drawer — a quick-access overlay: the Content Browser slides up over
  // the workspace (Ctrl+Space), dismissing on outside click / Esc. It sits ON
  // TOP of the docked Content Browser tab, not a replacement.
  contentDrawer: boolean;
  toggleContentDrawer: () => void;
  setContentDrawer: (open: boolean) => void;

  // Package/Build dialog (File → Build) — the UE5-style export modal.
  buildOpen: boolean;
  setBuildOpen: (open: boolean) => void;

  // Settings window (the registry-driven preferences dialog).
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'move',
  setTool: (tool) => set({ tool }),

  isPlaying: false,
  isPaused: false,
  togglePlay: () =>
    set((s) => ({ isPlaying: !s.isPlaying, isPaused: false })),
  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  stop: () => set({ isPlaying: false, isPaused: false }),
  // Guarded: this store is imported in pure-node tests where localStorage is absent.
  playTarget:
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('estella.playTarget') as 'viewport' | 'window' | null)
      : null) || 'viewport',
  setPlayTarget: (playTarget) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('estella.playTarget', playTarget);
    set({ playTarget });
  },
  inspectWorld: 'editor',
  setInspectWorld: (inspectWorld) => set({ inspectWorld }),

  showLauncher: true,
  enterEditor: () => set({ showLauncher: false }),
  openLauncher: () => set({ showLauncher: true }),

  showGrid: true,
  showGizmos: true,
  showColliders: true,
  snapping: false,
  snapStep: 32,
  snapAngle: 15,
  snapScale: 0.1,
  coordSpace: 'world',
  pivotMode: 'center',
  toggleCoordSpace: () => set((s) => ({ coordSpace: s.coordSpace === 'world' ? 'local' : 'world' })),
  togglePivotMode: () => set((s) => ({ pivotMode: s.pivotMode === 'center' ? 'pivot' : 'center' })),
  activeGizmoAxis: null,
  setActiveGizmoAxis: (activeGizmoAxis) => set({ activeGizmoAxis }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  toggleColliders: () => set((s) => ({ showColliders: !s.showColliders })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setSnapStep: (snapStep) => set({ snapStep, snapping: true }),
  setSnapAngle: (snapAngle) => set({ snapAngle }),
  setSnapScale: (snapScale) => set({ snapScale }),

  contentDrawer: false,
  toggleContentDrawer: () => set((s) => ({ contentDrawer: !s.contentDrawer })),
  setContentDrawer: (contentDrawer) => set({ contentDrawer }),

  buildOpen: false,
  setBuildOpen: (buildOpen) => set({ buildOpen }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
