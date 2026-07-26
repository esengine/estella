// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The panel registry that DockLayout's component map, restore-time re-title
 *        pass, bottom utility tabs, and closable/poppable rules all derive from.
 *        These assertions pin the values the four hardcoded tables used to carry, so
 *        the migration to a registry is provably behavior-preserving — and lock the
 *        two rules that are easy to get wrong: an iframe host must never be
 *        poppable, and the essential editing panels must never gain an X.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BUILTIN_PANELS, panelDef, panelDefs, panelComponent, panelDefForInstance, panelTitle,
  ensuredPanels, isPanelClosable, isPanelPoppable, panelRegistry, registerPanel,
} from '@/layout/panels';

describe('panel registry', () => {
  it('has unique ids and a title for every panel', () => {
    const ids = BUILTIN_PANELS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of BUILTIN_PANELS) expect(def.title()).toBeTruthy();
  });

  it('reproduces the non-closable set (the panels with no reopen path)', () => {
    const nonClosable = panelDefs().filter((d) => !isPanelClosable(d.id)).map((d) => d.id);
    expect(new Set(nonClosable)).toEqual(new Set(['viewport', 'outliner', 'details', 'content', 'log']));
  });

  it('withholds pop-out from the iframe hosts only', () => {
    const nonPoppable = panelDefs().filter((d) => !isPanelPoppable(d.id)).map((d) => d.id);
    expect(new Set(nonPoppable)).toEqual(new Set(['game', 'gameClient']));
    // The Viewport CAN pop out — a same-origin canvas move keeps its live GL context.
    expect(isPanelPoppable('viewport')).toBe(true);
  });

  it('resolves a dynamic panel instance to its component def', () => {
    // Multiplayer client views are created as game-client-<realmId>; their rules must
    // still resolve, which is what kept the old hardcoded prefix check in dockApi.
    expect(panelDefForInstance('game-client-2')?.id).toBe('gameClient');
    expect(isPanelPoppable('game-client-2')).toBe(false);
    expect(isPanelClosable('game-client-2')).toBe(true);
    // A session-scoped instance has no static title, so a layout restore skips it.
    expect(panelTitle('game-client-2')).toBeNull();
  });

  it('ensures exactly the bottom utility tabs, each with dock references', () => {
    expect(ensuredPanels().map((d) => d.id)).toEqual(['sequencer', 'profiler', 'audiomixer']);
    for (const def of ensuredPanels()) {
      expect(def.placement).toBe('bottom');
      expect(def.refs?.length).toBeGreaterThan(0);
      // Each reference must itself be a real panel, or the tab silently floats.
      for (const ref of def.refs ?? []) expect(panelDef(ref)).toBeDefined();
    }
  });

  it('keeps the one panel whose component key differs from its id', () => {
    // The UI widget palette docks as `ui-widgets` but renders `uiWidgets`; conflating
    // the two is what the separate component field exists to prevent.
    expect(panelComponent(panelDef('ui-widgets')!)).toBe('uiWidgets');
    expect(panelComponent(panelDef('details')!)).toBe('details');
  });

  it('exempts only the profiler from the Perf wrapper', () => {
    expect(panelDefs().filter((d) => d.noPerf).map((d) => d.id)).toEqual(['profiler']);
  });

  it('a contributed panel joins the registry and is retracted with its owner', () => {
    const d = registerPanel(
      { id: 'acme.budget', title: () => 'Level Budget', placement: 'bottom', refs: ['log'] },
      'plugin:acme',
    );
    expect(panelDef('acme.budget')?.placement).toBe('bottom');
    expect(panelTitle('acme.budget')).toBe('Level Budget');
    expect(isPanelClosable('acme.budget')).toBe(true); // contributed panels close by default
    expect(isPanelPoppable('acme.budget')).toBe(true);

    d.dispose();
    expect(panelDef('acme.budget')).toBeUndefined();
  });

  it('a contributed panel cannot take over a built-in panel id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    panelRegistry.register('plugin:evil', { id: 'viewport', title: () => 'Hijacked', placement: 'document' });
    expect(panelTitle('viewport')).not.toBe('Hijacked');
    expect(isPanelClosable('viewport')).toBe(false); // the built-in rule survives
    warn.mockRestore();
  });
});
