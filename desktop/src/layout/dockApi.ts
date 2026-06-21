/**
 * @file  dockApi.ts
 * @brief A tiny holder for the live dockview api so non-dock chrome (the activity
 *        bar) can reveal/focus docked panels without threading the api through
 *        React. DockLayout sets it on ready; callers guard against null.
 */
import type { DockviewApi, DockviewGroupPanelApi } from 'dockview';

let api: DockviewApi | null = null;
// Remembered pre-collapse sizes, per panel id (so a re-expand restores them).
const sizes = new Map<string, number>();

// Per-panel header collapse (the design's `.pcol` accordion): a dock group is
// shrunk to its tab-bar height so only the header shows, then restored. dockview's
// native group.collapse() is edge-groups-only (ours are grid groups), so we drive
// it by locking the group's height constraint to the header height. Collapse is by
// HEIGHT — every collapsible panel sits in a vertically-split, horizontal-tab group.
const COLLAPSED_H = 32; // collapsed group height ≈ the tab strip (--h-tab)
const EXPAND_FALLBACK = 240; // restore height when the pre-collapse size is unknown
const collapsedPrev = new Map<string, number>();

export const dockApi = {
  set(next: DockviewApi | null) {
    api = next;
  },
  /** Bring a docked panel to the front of its group (no-op if absent). */
  reveal(id: string) {
    api?.getPanel(id)?.api.setActive();
  },
  /** Open (or reveal) the Game view as a tab beside the Viewport — used on Play. */
  openGame() {
    if (!api) return;
    if (!api.getPanel('game')) {
      api.addPanel({
        id: 'game',
        component: 'game',
        title: 'Game',
        position: api.getPanel('viewport') ? { referencePanel: 'viewport', direction: 'within' } : undefined,
      });
    }
    api.getPanel('game')?.api.setActive();
  },
  /** Close the Game view — used on Stop. */
  closeGame() {
    api?.getPanel('game')?.api.close();
  },
  /** Collapse a panel's group to its header / expand it back (click-to-toggle). */
  toggleCollapse(id: string, axis: 'width' | 'height') {
    const panel = api?.getPanel(id);
    if (!panel) return;
    const prev = sizes.get(id);
    if (prev != null) {
      panel.api.setSize(axis === 'width' ? { width: prev } : { height: prev });
      sizes.delete(id);
    } else {
      sizes.set(id, axis === 'width' ? panel.api.width : panel.api.height);
      panel.api.setSize(axis === 'width' ? { width: 0 } : { height: 0 });
    }
  },

  /** True when a dock group is shrunk to (around) its header/tab-bar height. */
  groupCollapsed(groupApi: DockviewGroupPanelApi): boolean {
    return groupApi.height <= COLLAPSED_H + 8;
  },

  /**
   * Collapse a dock group to its header bar (or expand it back), by height —
   * the per-panel accordion the header chevron drives. Locks the group's height
   * constraint while collapsed so the splitter can't drag it half-open; only the
   * chevron expands it (restoring the remembered pre-collapse height).
   */
  setGroupCollapsed(groupApi: DockviewGroupPanelApi, groupId: string, collapsed: boolean) {
    if (collapsed) {
      if (groupApi.height > COLLAPSED_H + 8) collapsedPrev.set(groupId, groupApi.height);
      groupApi.setConstraints({ minimumHeight: COLLAPSED_H, maximumHeight: COLLAPSED_H });
      groupApi.setSize({ height: COLLAPSED_H });
    } else {
      groupApi.setConstraints({ minimumHeight: 60, maximumHeight: Number.MAX_SAFE_INTEGER });
      groupApi.setSize({ height: collapsedPrev.get(groupId) ?? EXPAND_FALLBACK });
      collapsedPrev.delete(groupId);
    }
  },
};
