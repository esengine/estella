// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The contribution inventory the Plugins panel shows.
 *
 * The claim being tested is "complete by construction": a plugin cannot register
 * something without it appearing in the list, because listing happens at the same
 * single door the registration goes through. A kind that grows a new register()
 * path and forgets to list it is exactly the regression this catches — the panel
 * would keep answering "why isn't my panel showing up?" with a lie of omission.
 *
 * The other half is retraction. A disposed contribution has to leave the list, or
 * the panel advertises something the editor no longer has.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildPluginContext, type ContributionKind } from '@/plugins/context';
import type { PluginManifest } from '@/plugins/manifest';
import type { PluginContext } from '@estella/editor-api';

const MANIFEST: PluginManifest = {
  id: 'acme.tools',
  name: 'Acme Tools',
  version: '1.0.0',
  main: { editor: 'src/editor.ts' },
};

const OWNER = 'plugin:acme.tools' as const;

// The context's `guard` is PluginHost's policy; here it only has to call through.
const guard = <T,>(_what: string, fn: () => T): T => fn();

let built: ReturnType<typeof buildPluginContext> | null = null;

const build = () => {
  built = buildPluginContext(MANIFEST, '/tmp/acme.tools', OWNER, guard);
  return built;
};

afterEach(() => {
  built?.dispose();
  built = null;
});

/** Register one of every kind, and hand back the disposables by kind. */
function registerAll(ctx: PluginContext): Record<string, { dispose(): void }> {
  return {
    command: ctx.commands.register({ id: 'acme.tools.hello', title: 'Say hello', run() {} }),
    panel: ctx.panels.register({ id: 'acme.tools.panel', title: 'Acme', mount: () => () => {} }),
    setting: ctx.settings.register({ id: 'acme.warn', type: 'boolean', label: 'Warn', default: true }),
    tool: ctx.tools.register({
      id: 'acme.tools.measure',
      title: 'Measure',
      onPointerDown: () => true,
      onPointerMove: () => {},
      onPointerUp: () => {},
    }),
    overlay: ctx.overlays.register({ id: 'acme.tools.gizmo', render: () => {} }),
    inspector: ctx.inspector.register({
      kind: 'component',
      id: 'audit',
      component: 'Sprite',
      title: 'Audit',
      build: () => {},
    }),
    assetType: ctx.assets.registerType({ id: 'acme.tools.dialogue', extensions: ['dlg'] }),
    importer: ctx.assets.registerImporter({ id: 'ldtk', extensions: ['ldtk'], import: () => {} }),
    entityTemplate: ctx.entities.registerTemplate({ id: 'acme.tools.turret', label: 'Turret', components: [] }),
    contextMenu: ctx.contextMenus.register({
      id: 'acme.tools.reveal',
      location: 'outliner/item',
      label: 'Reveal',
      run: () => {},
    }),
  };
}

describe('contribution inventory', () => {
  it('starts empty — a plugin that registers nothing lists nothing', () => {
    const b = build();
    expect(b.contributions()).toEqual([]);
  });

  it('lists every contribution kind the context can register', () => {
    const b = build();
    registerAll(b.ctx);
    const kinds = b.contributions().map((c) => c.kind);
    const expected: ContributionKind[] = [
      'command', 'panel', 'setting', 'tool', 'overlay',
      'inspector', 'assetType', 'importer', 'entityTemplate', 'contextMenu',
    ];
    // Every kind present, and nothing registered twice.
    expect([...kinds].sort()).toEqual([...expected].sort());
  });

  it('carries the id and a localized label for each', () => {
    const b = build();
    registerAll(b.ctx);
    const byKind = new Map(b.contributions().map((c) => [c.kind, c]));
    expect(byKind.get('command')).toMatchObject({ id: 'acme.tools.hello', label: 'Say hello' });
    expect(byKind.get('panel')).toMatchObject({ id: 'acme.tools.panel', label: 'Acme' });
    expect(byKind.get('tool')).toMatchObject({ id: 'acme.tools.measure', label: 'Measure' });
    // Inspector ids are namespaced by the host, and the list must show the id that
    // actually landed in the registry — not the one the plugin asked for.
    expect(byKind.get('inspector')?.id).toBe('acme.tools.audit');
    // An asset type has no title of its own; its extensions are the useful label.
    expect(byKind.get('assetType')?.label).toBe('.dlg');
    // Same for an importer: what it converts is what identifies it in the list.
    expect(byKind.get('importer')).toMatchObject({ id: 'acme.tools.ldtk', label: '.ldtk' });
    // An overlay has neither — and must NOT fall back to its id, or the panel row
    // prints the same string in the label column and the id column.
    expect(byKind.get('overlay')).toMatchObject({ id: 'acme.tools.gizmo', label: '' });
  });

  it('puts a contribution under its plugin, however the author spelled the id', () => {
    // The convention was documented and unenforced, so a plugin registering
    // `details` could claim a built-in panel's id. Idempotent, so an id already
    // under the plugin is left exactly as written.
    const b = build();
    b.ctx.panels.register({ id: 'mixer', title: 'Mixer', mount: () => () => {} });
    b.ctx.commands.register({ id: 'acme.tools.already', title: 'Already', run() {} });
    expect(b.contributions().map((c) => c.id)).toEqual(['acme.tools.mixer', 'acme.tools.already']);
  });

  it('resolves a localized label rather than listing the object', () => {
    const b = build();
    b.ctx.commands.register({ id: 'acme.tools.l10n', title: { en: 'Bake', 'zh-CN': '烘焙' }, run() {} });
    expect(b.contributions()[0].label).toBe('Bake');
  });

  it('drops a contribution from the list when it is retracted', () => {
    const b = build();
    const handles = registerAll(b.ctx);
    expect(b.contributions()).toHaveLength(10);

    handles.panel.dispose();
    const after = b.contributions();
    expect(after).toHaveLength(9);
    expect(after.some((c) => c.kind === 'panel')).toBe(false);
    // The others are untouched — retraction is per contribution, not per plugin.
    expect(after.some((c) => c.kind === 'command')).toBe(true);
  });

  it('empties on dispose, so a reloaded plugin never inherits the old build`s list', () => {
    const b = build();
    registerAll(b.ctx);
    b.dispose();
    expect(b.contributions()).toEqual([]);
  });

  it('hands back a copy — a caller cannot mutate the live list', () => {
    const b = build();
    registerAll(b.ctx);
    b.contributions().length = 0;
    expect(b.contributions()).toHaveLength(10);
  });
});
