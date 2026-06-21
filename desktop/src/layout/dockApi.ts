/**
 * @file  dockApi.ts
 * @brief A tiny holder for the live dockview api so non-dock chrome (the activity
 *        bar) can reveal/focus docked panels without threading the api through
 *        React. DockLayout sets it on ready; callers guard against null.
 */
import type { DockviewApi } from 'dockview';

let api: DockviewApi | null = null;
// Remembered pre-collapse sizes, per panel id (so a re-expand restores them).
const sizes = new Map<string, number>();

export const dockApi = {
  set(next: DockviewApi | null) {
    api = next;
  },
  /** Bring a docked panel to the front of its group (no-op if absent). */
  reveal(id: string) {
    api?.getPanel(id)?.api.setActive();
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
};
