// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
const COLLAPSE_MS = 200; // collapse/expand tween duration (UE5 is snappy)
const EXPANDED_MIN_H = 60; // sane floor once expanded
const collapsedPrev = new Map<string, number>();
// In-flight collapse animations, per group id — so a re-click cancels the tween.
const collapseAnims = new Map<string, number>();

// cubic-bezier(0.2, 0, 0, 1) ≈ easeOutCubic — the design's `--e-out` pane curve.
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /** Toggle a panel's whole group collapsed/expanded (the activity-bar toggles). */
  togglePanelCollapse(panelId: string) {
    const panel = api?.getPanel(panelId);
    const groupApi = panel?.group?.api;
    if (!panel || !groupApi) return;
    this.setGroupCollapsed(groupApi, panel.group.id, !this.groupCollapsed(groupApi));
  },

  /** Bring a panel's tab to front and expand its group if it was collapsed. */
  revealAndExpand(panelId: string) {
    const panel = api?.getPanel(panelId);
    if (!panel) return;
    panel.api.setActive();
    const groupApi = panel.group?.api;
    if (groupApi && this.groupCollapsed(groupApi)) {
      this.setGroupCollapsed(groupApi, panel.group.id, false);
    }
  },

  /**
   * Collapse a dock group to its header bar (or expand it back), by height —
   * the per-panel accordion the header chevron drives, animated (UE5 ease-out;
   * `setSize` per frame so dockview re-lays-out smoothly). Locks the group's
   * height constraint once collapsed so the splitter can't drag it half-open;
   * only the chevron expands it (restoring the remembered pre-collapse height).
   */
  setGroupCollapsed(groupApi: DockviewGroupPanelApi, groupId: string, collapsed: boolean) {
    const running = collapseAnims.get(groupId);
    if (running != null) {
      cancelAnimationFrame(running);
      collapseAnims.delete(groupId);
    }

    const from = groupApi.height;
    const to = collapsed ? COLLAPSED_H : collapsedPrev.get(groupId) ?? EXPAND_FALLBACK;
    // Remember the expanded height only on the FIRST collapse (a mid-tween
    // re-click must not overwrite it with an intermediate height).
    if (collapsed && from > COLLAPSED_H + 8 && !collapsedPrev.has(groupId)) {
      collapsedPrev.set(groupId, from);
    }

    // Settle constraints to the final state — lock when collapsed, floor when
    // expanded. During the tween, constraints stay open (set below) so the
    // intermediate setSize values aren't clamped.
    const settle = () => {
      if (collapsed) {
        groupApi.setConstraints({ minimumHeight: COLLAPSED_H, maximumHeight: COLLAPSED_H });
      } else {
        groupApi.setConstraints({ minimumHeight: EXPANDED_MIN_H, maximumHeight: Number.MAX_SAFE_INTEGER });
        collapsedPrev.delete(groupId);
      }
    };

    // Open the constraint range so the tween can move freely either direction.
    groupApi.setConstraints({ minimumHeight: COLLAPSED_H, maximumHeight: Number.MAX_SAFE_INTEGER });

    if (prefersReducedMotion() || from === to) {
      groupApi.setSize({ height: to });
      settle();
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COLLAPSE_MS);
      groupApi.setSize({ height: from + (to - from) * easeOut(t) });
      if (t < 1) {
        collapseAnims.set(groupId, requestAnimationFrame(tick));
      } else {
        collapseAnims.delete(groupId);
        settle();
      }
    };
    collapseAnims.set(groupId, requestAnimationFrame(tick));
  },
};
