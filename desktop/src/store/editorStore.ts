// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { create } from 'zustand';
import type { ToolMode } from '@/types';
import type { GizmoAxis } from '@/tools/gizmo';
import { toolRegistry } from '@/tools/toolRegistry';

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
  restart: () => void;
  // Where Play runs: in the Viewport (UE5 PIE, default) or a separate Game tab.
  playTarget: 'viewport' | 'window';
  setPlayTarget: (t: 'viewport' | 'window') => void;
  // Multiplayer preview: how many players the next Play session boots (1 = plain
  // single realm; N>1 = a listen-server realm + N-1 client realms, replicated).
  playPlayers: number;
  setPlayPlayers: (n: number) => void;
  // Maximize the viewport/game group when Play starts (Unity's "Maximize On Play"),
  // restored on Stop. Off by default so the live-inspect-while-playing workflow
  // (tweaking entities in the Outliner/Details) keeps its panels. Persisted.
  maximizeOnPlay: boolean;
  setMaximizeOnPlay: (v: boolean) => void;
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
  /** Draw the selected TilemapLayer's tile collision (slopes / circles / one-way /
   *  sensors) in the viewport, so tile collision is visible without entering Play. */
  showTileCollision: boolean;
  /** Simulate particle emitters live in edit mode (authoring preview). */
  previewFx: boolean;
  /** Corner performance HUD (FPS / frame time / entity count). Off by default — opt-in. */
  showStats: boolean;
  /** Bottom-left cursor / selection / zoom readout. */
  showCoords: boolean;
  /** The instructional line under it. Its own switch because it is not a readout:
   *  once you know the gizmo, it is a sentence that never stops being shown. */
  showHints: boolean;
  /** Bottom-right scene minimap overview. On by default; toggle to reclaim the corner. */
  showMinimap: boolean;
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
  /** Editor viewport projection: a perspective eye for authoring 2.5D. */
  viewPerspective: boolean;
  toggleViewPerspective: () => void;
  togglePivotMode: () => void;
  /** Axis of the gizmo handle currently being dragged (null = none) — drives the
   *  handle's active highlight. Set by the transform tool on grab, cleared on release. */
  activeGizmoAxis: GizmoAxis | null;
  setActiveGizmoAxis: (axis: GizmoAxis | null) => void;
  toggleGrid: () => void;
  toggleGizmos: () => void;
  toggleColliders: () => void;
  toggleTileCollision: () => void;
  togglePreviewFx: () => void;
  toggleStats: () => void;
  toggleCoords: () => void;
  toggleHints: () => void;
  toggleMinimap: () => void;
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
  /** Target to open the build dialog on; null = the one the project last packaged
   *  for. Set when something elsewhere means a SPECIFIC target's page — settings
   *  search landing on a row that is edited there. */
  buildPlatform: string | null;
  openBuild: (platform?: string | null) => void;

  // Settings window (the registry-driven preferences dialog).
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Section to open Settings on (e.g. 'shortcuts' from Help); null = the first. */
  settingsSection: string | null;
  openSettings: (section?: string | null) => void;

  // Command palette (Ctrl/Cmd+Shift+P) — run any registry command by name.
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // The built-in agent's conversation, SUMMONED over the right-hand panels. The
  // same panel also docks (layout/panels.ts) — the Content Browser arrangement:
  // one component, a tab you arrange and an overlay you call up without
  // rearranging anything. The conversation itself lives in AgentStore.
  agentDrawer: boolean;
  toggleAgentDrawer: () => void;
  setAgentDrawer: (open: boolean) => void;

  // "New Tilemap" tileset chooser (Entity → New Tilemap): picks the .estileset
  // palette for a fresh map, then createTilemapFromTileset does the rest.
  tilemapPickerOpen: boolean;
  setTilemapPickerOpen: (open: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'move',
  // Picking a built-in tool disarms any contributed one — otherwise choosing Move
  // would silently do nothing while a plugin tool held the strokes.
  setTool: (tool) => {
    toolRegistry.activate(null);
    set({ tool });
  },

  isPlaying: false,
  isPaused: false,
  togglePlay: () =>
    set((s) => ({ isPlaying: !s.isPlaying, isPaused: false })),
  togglePause: () => set((s) => ({ isPaused: !s.isPaused })),
  stop: () => set({ isPlaying: false, isPaused: false }),
  // A real restart: end the running session, then re-enter Play next frame so the
  // play effect sees a false→true transition and boots a FRESH game (warm re-play
  // is fast). The button labelled "Restart" used to just stop.
  restart: () => {
    set({ isPlaying: false, isPaused: false });
    requestAnimationFrame(() => set({ isPlaying: true, isPaused: false }));
  },
  // Guarded: this store is imported in pure-node tests where localStorage is absent.
  playTarget:
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('estella.playTarget') as 'viewport' | 'window' | null)
      : null) || 'viewport',
  setPlayTarget: (playTarget) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('estella.playTarget', playTarget);
    set({ playTarget });
  },
  playPlayers:
    (typeof localStorage !== 'undefined' ? Number(localStorage.getItem('estella.playPlayers')) : 0) || 1,
  setPlayPlayers: (playPlayers) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('estella.playPlayers', String(playPlayers));
    set({ playPlayers });
  },
  maximizeOnPlay:
    typeof localStorage !== 'undefined' && localStorage.getItem('estella.maximizeOnPlay') === '1',
  setMaximizeOnPlay: (maximizeOnPlay) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('estella.maximizeOnPlay', maximizeOnPlay ? '1' : '0');
    set({ maximizeOnPlay });
  },
  inspectWorld: 'editor',
  setInspectWorld: (inspectWorld) => set({ inspectWorld }),

  showLauncher: true,
  enterEditor: () => set({ showLauncher: false, isPlaying: false, isPaused: false }),
  openLauncher: () => set({ showLauncher: true, isPlaying: false, isPaused: false }),

  showGrid: true,
  showGizmos: true,
  showColliders: true,
  showTileCollision: true,
  previewFx: true,
  showStats: false,
  // On by default: this strip carries the active-tool hint line (Alt-duplicate,
  // brush flip/rotate, eyedropper…) + the cursor world coord / tile-cell readout —
  // the editor's cheapest self-teaching surface. FPS/entity stats stay opt-in.
  showCoords: true,
  showHints: true,
  showMinimap: true,
  snapping: false,
  snapStep: 32,
  snapAngle: 15,
  snapScale: 0.1,
  coordSpace: 'world',
  pivotMode: 'center',
  toggleCoordSpace: () => set((s) => ({ coordSpace: s.coordSpace === 'world' ? 'local' : 'world' })),
  viewPerspective: false,
  toggleViewPerspective: () => set((s) => ({ viewPerspective: !s.viewPerspective })),
  togglePivotMode: () => set((s) => ({ pivotMode: s.pivotMode === 'center' ? 'pivot' : 'center' })),
  activeGizmoAxis: null,
  setActiveGizmoAxis: (activeGizmoAxis) => set({ activeGizmoAxis }),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  toggleColliders: () => set((s) => ({ showColliders: !s.showColliders })),
  toggleTileCollision: () => set((s) => ({ showTileCollision: !s.showTileCollision })),
  togglePreviewFx: () => set((s) => ({ previewFx: !s.previewFx })),
  toggleStats: () => set((s) => ({ showStats: !s.showStats })),
  toggleCoords: () => set((s) => ({ showCoords: !s.showCoords })),
  toggleHints: () => set((s) => ({ showHints: !s.showHints })),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setSnapStep: (snapStep) => set({ snapStep, snapping: true }),
  setSnapAngle: (snapAngle) => set({ snapAngle }),
  setSnapScale: (snapScale) => set({ snapScale }),

  contentDrawer: false,
  toggleContentDrawer: () => set((s) => ({ contentDrawer: !s.contentDrawer })),
  setContentDrawer: (contentDrawer) => set({ contentDrawer }),

  buildOpen: false,
  setBuildOpen: (buildOpen) => set({ buildOpen }),
  buildPlatform: null,
  openBuild: (platform = null) => set({ buildOpen: true, buildPlatform: platform }),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  settingsSection: null,
  openSettings: (section = null) => set({ settingsOpen: true, settingsSection: section }),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  agentDrawer: false,
  toggleAgentDrawer: () => set((s) => ({ agentDrawer: !s.agentDrawer })),
  setAgentDrawer: (agentDrawer) => set({ agentDrawer }),

  tilemapPickerOpen: false,
  setTilemapPickerOpen: (tilemapPickerOpen) => set({ tilemapPickerOpen }),
}));
