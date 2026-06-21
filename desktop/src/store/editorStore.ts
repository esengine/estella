import { create } from 'zustand';
import type { EntityId, ToolMode } from '@/types';

// Global editor UI state (tools, viewport toggles, play state, launcher gate).
// Entity selection lives in its own engine-anchored store — see selectionStore.ts.
interface EditorState {
  // Active manipulation tool (select / move / rotate / scale).
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;

  // Expanded nodes in the outliner tree.
  expanded: Set<EntityId>;
  toggleExpanded: (id: EntityId) => void;
  setExpanded: (ids: EntityId[]) => void;

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
  snapping: boolean;
  // Grid-snap increment (world units) applied to Move while `snapping` is on. The
  // viewport snap dropdown picks from a fixed set (16 / 32 / 64); "off" flips
  // `snapping` rather than changing the step, so the last step survives a re-enable.
  snapStep: number;
  toggleGrid: () => void;
  toggleGizmos: () => void;
  toggleSnapping: () => void;
  setSnapStep: (step: number) => void;

  // Content Drawer — a quick-access overlay: the Content Browser slides up over
  // the workspace (Ctrl+Space), dismissing on outside click / Esc. It sits ON
  // TOP of the docked Content Browser tab, not a replacement.
  contentDrawer: boolean;
  toggleContentDrawer: () => void;
  setContentDrawer: (open: boolean) => void;

  // Package/Build dialog (File → Build) — the UE5-style export modal.
  buildOpen: boolean;
  setBuildOpen: (open: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'move',
  setTool: (tool) => set({ tool }),

  expanded: new Set<EntityId>(),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      next.has(id) ? next.delete(id) : next.add(id);
      return { expanded: next };
    }),
  setExpanded: (ids) => set({ expanded: new Set(ids) }),

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
  snapping: false,
  snapStep: 32,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setSnapStep: (snapStep) => set({ snapStep, snapping: true }),

  contentDrawer: false,
  toggleContentDrawer: () => set((s) => ({ contentDrawer: !s.contentDrawer })),
  setContentDrawer: (contentDrawer) => set({ contentDrawer }),

  buildOpen: false,
  setBuildOpen: (buildOpen) => set({ buildOpen }),
}));
