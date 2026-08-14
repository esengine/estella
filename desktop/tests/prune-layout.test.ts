// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A saved dock layout outliving the panels in it.
 *
 * dockview refuses a whole layout over one component it cannot resolve, so
 * "this panel went away" and "your arrangement is gone" were the same event.
 * These are the claims that separate them: the panel leaves, the layout stays,
 * and a group emptied by the removal does not linger as a blank frame.
 */
import { describe, it, expect } from 'vitest';
import { pruneLayout } from '@/layout/pruneLayout';

const leaf = (id: string, views: string[], activeView?: string) =>
  ({ type: 'leaf', size: 100, data: { id, views, ...(activeView ? { activeView } : {}) } });

const layout = (root: unknown, panels: Record<string, string>) => ({
  grid: { root, width: 1000, height: 800, orientation: 'HORIZONTAL' },
  panels: Object.fromEntries(
    Object.entries(panels).map(([id, component]) => [id, { id, contentComponent: component, title: id }]),
  ),
  activeGroup: 'g1',
});

const known = (...keys: string[]) => new Set(keys);

describe('a saved layout meeting a build that lost a panel', () => {
  it('keeps everything when every component is still there', () => {
    const l = layout(leaf('g1', ['viewport', 'mixer']), { viewport: 'viewport', mixer: 'mixer' });
    // Same object back: nothing to rewrite is the common case, every launch.
    expect(pruneLayout(l, known('viewport', 'mixer'))).toBe(l);
  });

  it('drops only the panel whose component is gone', () => {
    const l = layout(leaf('g1', ['viewport', 'mixer'], 'viewport'), { viewport: 'viewport', mixer: 'mixer' });
    const out = pruneLayout(l, known('viewport')) as typeof l;
    expect(Object.keys(out.panels)).toEqual(['viewport']);
    expect((out.grid.root as ReturnType<typeof leaf>).data.views).toEqual(['viewport']);
  });

  it('re-points the active tab when it was the one that went', () => {
    const l = layout(leaf('g1', ['viewport', 'mixer'], 'mixer'), { viewport: 'viewport', mixer: 'mixer' });
    const out = pruneLayout(l, known('viewport')) as typeof l;
    expect((out.grid.root as ReturnType<typeof leaf>).data.activeView).toBe('viewport');
  });

  it('removes a group the loss emptied, rather than leaving a blank frame', () => {
    const root = {
      type: 'branch',
      size: 800,
      data: [leaf('g1', ['viewport']), leaf('g2', ['mixer'])],
    };
    const out = pruneLayout(layout(root, { viewport: 'viewport', mixer: 'mixer' }), known('viewport')) as {
      grid: { root: { data: Array<{ data: { id: string } }> } };
    };
    expect(out.grid.root.data).toHaveLength(1);
    expect(out.grid.root.data[0].data.id).toBe('g1');
  });

  it('gives up when nothing is left, so the caller builds the default', () => {
    // Not an empty layout — dockview would render a blank editor and call it
    // restored.
    expect(pruneLayout(layout(leaf('g1', ['mixer']), { mixer: 'mixer' }), known('viewport'))).toBeNull();
  });

  it('forgets an active group that the pruning removed', () => {
    const root = { type: 'branch', size: 800, data: [leaf('g0', ['viewport']), leaf('g1', ['mixer'])] };
    const out = pruneLayout(layout(root, { viewport: 'viewport', mixer: 'mixer' }), known('viewport')) as {
      activeGroup?: string;
    };
    expect(out.activeGroup).toBeUndefined();
  });

  it('prunes a floating group the same way', () => {
    const l = {
      ...layout(leaf('g1', ['viewport']), { viewport: 'viewport', mixer: 'mixer' }),
      floatingGroups: [{ data: { id: 'f1', views: ['mixer'], activeView: 'mixer' }, position: {} }],
    };
    const out = pruneLayout(l, known('viewport')) as typeof l;
    expect(out.floatingGroups).toEqual([]);
  });

  it('refuses junk rather than handing dockview something shaped wrong', () => {
    expect(pruneLayout(null, known('viewport'))).toBeNull();
    expect(pruneLayout('{}', known('viewport'))).toBeNull();
  });
});
