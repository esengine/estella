// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dockApi.ts
 * @brief A tiny holder for the live dockview api so non-dock chrome (the activity
 *        bar) can reveal/focus docked panels without threading the api through
 *        React. DockLayout sets it on ready; callers guard against null.
 */
import type { DockviewApi, DockviewGroupPanelApi } from 'dockview';
import { t } from '@/i18n';

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

// The Game view hosts the play-realm iframe, and re-parenting an iframe across
// documents reloads it (its wasm/GL would restart) — so it stays put. The Viewport
// CAN pop out: a same-origin canvas move preserves the live WebGL context, so its
// single engine canvas rides the move into the new window (EngineHost.rebindResize
// re-binds sizing). Everything else is model/store-driven and pops out cleanly.
const NON_POPPABLE = new Set(['game']);

// dockview's getDockviewTheme copies only the FIRST `dockview-theme-*` class onto
// the popout container (our root carries `dockview-theme-abyss dockview-theme-estella`,
// so only abyss makes it across). Re-add the estella override on the SAME element so
// the compound `.dockview-theme-abyss.dockview-theme-estella` variable block and every
// estella chrome selector match in the popped-out window — pixel-identical to the dock.
// The container only gains its `dv-dockview` class after the child window's load event,
// so poll a bounded number of that window's frames for it to appear.
export function applyPopoutTheme(popoutWindow: Window): void {
  let tries = 0;
  const add = () => {
    const el = popoutWindow.document.querySelector('.dv-dockview');
    if (el) el.classList.add('dockview-theme-estella');
    else if (tries++ < 60 && !popoutWindow.closed) popoutWindow.requestAnimationFrame(add);
  };
  add();
}

export const dockApi = {
  set(next: DockviewApi | null) {
    api = next;
  },
  /** The id of the active (focused) dock panel, or null. Drives context-aware
   *  Save: Ctrl+S targets the asset editor you're looking at, else the scene. */
  activePanelId(): string | null {
    return api?.activePanel?.id ?? null;
  },
  /** Bring a docked panel to the front of its group (no-op if absent). */
  reveal(id: string) {
    api?.getPanel(id)?.api.setActive();
  },
  /** Resize a docked panel's group (automation/shot tests: reproduce narrow docks). */
  setPanelSize(id: string, size: { width?: number; height?: number }) {
    api?.getPanel(id)?.api.setSize(size);
  },
  /** True when a panel may be popped out into its own OS window (see NON_POPPABLE). */
  canPopout(id: string): boolean {
    return !NON_POPPABLE.has(id) && !id.startsWith('game-client-');
  },
  /**
   * Move a docked panel into its own OS window (dockview addPopoutGroup → a real
   * child window on any monitor). Because the popout is a same-origin `window.open`,
   * the panel's React tree and every editor store stay in THIS window's JS realm —
   * only its DOM is re-parented — so a popped-out Inspector/Outliner shares live
   * selection and edits with the main window with no cross-window messaging. dockview
   * copies the stylesheets over; applyPopoutTheme re-adds our theme override class so
   * the popped-out chrome matches exactly. Layout persistence carries popout groups,
   * so a popped-out panel reopens where it was after a reload.
   */
  popout(id: string) {
    if (!api || !this.canPopout(id)) return;
    const panel = api.getPanel(id);
    if (!panel) return;
    void api.addPopoutGroup(panel, {
      popoutUrl: '/popout.html',
      onDidOpen: ({ window: popoutWindow }) => applyPopoutTheme(popoutWindow),
    });
  },
  /**
   * Open (or front) a large editor as a document tab in the CENTER stage beside
   * the Viewport — the modern unified-editor home for full editing canvases
   * (Material Graph, Tilemap, Tileset), opened on-demand and closeable. Creates
   * the panel on first open; subsequent calls just front it.
   */
  openDocument(id: string, component: string, title: string) {
    if (!api) return;
    if (!api.getPanel(id)) {
      api.addPanel({
        id,
        component,
        title,
        position: api.getPanel('viewport') ? { referencePanel: 'viewport', direction: 'within' } : undefined,
      });
    }
    api.getPanel(id)?.api.setActive();
  },
  /**
   * Open (or front) a companion tool panel docked beside the Viewport (default
   * left) so it stays visible WHILE you work in the Viewport — for palettes like
   * the Tilemap painter, where painting happens in the Viewport and a center
   * document tab would hide it. Opened on-demand and closeable.
   */
  openSidePanel(id: string, component: string, title: string, direction: 'left' | 'right' = 'left', width = 300) {
    if (!api) return;
    if (!api.getPanel(id)) {
      api.addPanel({
        id,
        component,
        title,
        position: api.getPanel('viewport') ? { referencePanel: 'viewport', direction } : undefined,
        initialWidth: width,
      });
    }
    api.getPanel(id)?.api.setActive();
  },
  /** Open (or reveal) the Game view as a tab beside the Viewport — used on Play. */
  openGame() {
    if (!api) return;
    if (!api.getPanel('game')) {
      api.addPanel({
        id: 'game',
        component: 'game',
        title: t('layout.panel.game'),
        position: api.getPanel('viewport') ? { referencePanel: 'viewport', direction: 'within' } : undefined,
      });
    }
    api.getPanel('game')?.api.setActive();
  },
  /** Close the Game view — used on Stop. */
  closeGame() {
    api?.getPanel('game')?.api.close();
  },
  /** Open the multiplayer client views ("Game P2..N") beside the primary Game
   *  view — used on multiplayer Play. Splits right so players sit side by side. */
  openGameClients(realmIds: number[]) {
    if (!api) return;
    for (const realmId of realmIds) {
      const id = `game-client-${realmId}`;
      if (!api.getPanel(id)) {
        const anchor = api.getPanel('game') ?? api.getPanel('viewport');
        api.addPanel({
          id,
          component: 'gameClient',
          title: t('layout.panel.gamePlayer', { n: realmId + 1 }),
          params: { realmId },
          position: anchor ? { referencePanel: anchor.id, direction: 'right' } : undefined,
        });
      }
    }
  },
  /** Close every multiplayer client view — used on Stop. */
  closeGameClients() {
    if (!api) return;
    for (const p of api.panels.filter((p) => p.id.startsWith('game-client-'))) {
      p.api.close();
    }
  },

  /** True while some dock group is maximized (the whole stage fills the workspace). */
  isMaximized(): boolean {
    return !!api?.hasMaximizedGroup();
  },
  /**
   * Maximize a panel's group to fill the workspace — dockview's native maximize,
   * which only HIDES the sibling groups (it does not remove/recreate any panel),
   * so the Viewport's live WebGL canvas survives untouched. Powers "Maximize On
   * Play" and the F11 focus toggle. No-op if the panel is popped out (a separate
   * OS window owns its own size). */
  maximizePanel(id: string) {
    const panel = api?.getPanel(id);
    if (api && panel && panel.api.location.type === 'grid') api.maximizeGroup(panel);
  },
  /** Restore from any maximized group (Stop / exit focus). */
  exitMaximized() {
    if (api?.hasMaximizedGroup()) api.exitMaximizedGroup();
  },
  /** Toggle a panel's group maximized/restored — the F11 focus command. */
  toggleMaximizePanel(id: string) {
    if (!api) return;
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
    else this.maximizePanel(id);
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
