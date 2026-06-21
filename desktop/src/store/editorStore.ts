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

  // Content Drawer — a quick-access overlay: the Content Browser slides up over
  // the workspace (Ctrl+Space), dismissing on outside click / Esc. It sits ON
  // TOP of the docked Content Browser tab, not a replacement.
  contentDrawer: boolean;
  toggleContentDrawer: () => void;
  setContentDrawer: (open: boolean) => void;
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

  showLauncher: true,
  enterEditor: () => set({ showLauncher: false }),
  openLauncher: () => set({ showLauncher: true }),

  showGrid: true,
  showGizmos: true,
  snapping: false,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),

  contentDrawer: false,
  toggleContentDrawer: () => set((s) => ({ contentDrawer: !s.contentDrawer })),
  setContentDrawer: (contentDrawer) => set({ contentDrawer }),
}));
