import { create } from 'zustand';
import type { EntityId, ToolMode } from '@/types';

// Global editor state. Intentionally small for the static shell — it grows as
// real selection/scene/asset operations are wired to the engine bridge.
interface EditorState {
  // Active manipulation tool (select / move / rotate / scale).
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;

  // Currently selected entity (drives Details panel + viewport gizmo).
  selectedId: EntityId | null;
  select: (id: EntityId | null) => void;

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

  // Launcher (project browser) vs editor shell. The editor opens on the
  // launcher until a project is opened/created; `enterEditor` dismisses it.
  showLauncher: boolean;
  enterEditor: () => void;
  openLauncher: () => void;

  // Viewport overlays.
  showGrid: boolean;
  showGizmos: boolean;
  snapping: boolean;
  toggleGrid: () => void;
  toggleGizmos: () => void;
  toggleSnapping: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: 'move',
  setTool: (tool) => set({ tool }),

  selectedId: null,
  select: (selectedId) => set({ selectedId }),

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

  showLauncher: true,
  enterEditor: () => set({ showLauncher: false }),
  openLauncher: () => set({ showLauncher: true }),

  showGrid: true,
  showGizmos: true,
  snapping: false,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
}));
