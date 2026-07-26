// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Scene Report — a worked example of an Estella editor plugin.
 *
 * It shows the three contribution kinds a plugin usually needs, and the two rules
 * that matter:
 *
 *   - Register through `ctx`, never through a global. Every registration is
 *     attributed to this plugin, which is what lets the editor unload or reload it
 *     cleanly (try editing this file — the editor recompiles and re-activates it).
 *
 *   - Mutate the scene through `ctx.scene`. Those writes go through the editor's
 *     command layer, so they land in the undo history and survive Play → Stop.
 *     Reaching around it to the live engine would lose both.
 *
 * Written in TypeScript with no build step: the editor compiles it, and the typings
 * come from `.esengine/plugins/.types/editor-api.d.ts`, which the editor keeps in
 * sync with itself (see tsconfig.json next to this file).
 */
import { definePlugin, type PluginContext } from '@estella/editor-api';

/** Count entities and how often each component type appears. */
function summarize(ctx: PluginContext): { entities: number; components: Map<string, number> } {
  const components = new Map<string, number>();
  let entities = 0;
  const walk = (nodes: ReturnType<PluginContext['scene']['getSceneTree']>): void => {
    for (const node of nodes) {
      entities++;
      for (const type of ctx.scene.getEntity(node.id)?.components ?? []) {
        components.set(type, (components.get(type) ?? 0) + 1);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(ctx.scene.getSceneTree());
  return { entities, components };
}

export default definePlugin({
  activate(ctx: PluginContext) {
    // — A command. Lands in the command palette and in the Tools menu; its label,
    //   shortcut, and enablement all come from this one declaration. —
    ctx.commands.register({
      id: 'estella.scene-report.logSummary',
      title: { en: 'Log Scene Summary', 'zh-CN': '输出场景摘要' },
      category: { en: 'Scene Report', 'zh-CN': '场景报告' },
      menu: 'tools',
      run: () => {
        const { entities, components } = summarize(ctx);
        ctx.log.info(`${entities} entities, ${components.size} distinct component types`);
        ctx.ui.toast(`Scene has ${entities} entities`, 'info');
      },
    });

    // — A command that WRITES. One transact() call is one undo step, however many
    //   edits it makes: ⌘Z takes all of it back together. —
    ctx.commands.register({
      id: 'estella.scene-report.nameUnnamed',
      title: { en: 'Name Unnamed Entities', 'zh-CN': '命名未命名实体' },
      category: { en: 'Scene Report', 'zh-CN': '场景报告' },
      menu: 'tools',
      isEnabled: () => ctx.scene.getSceneTree().length > 0,
      run: () => {
        ctx.scene.transact('Name Unnamed Entities', () => {
          let n = 0;
          for (const node of ctx.scene.getSceneTree()) {
            if (/^entity$/i.test(node.name)) ctx.scene.renameEntity(node.id, `Entity ${++n}`);
          }
        });
      },
    });

    // — A setting. Appears under Settings ▸ Plugins ▸ Scene Report. —
    ctx.settings.register({
      id: 'estella.scene-report.showComponents',
      type: 'boolean',
      default: true,
      label: { en: 'Show component breakdown', 'zh-CN': '显示组件明细' },
      description: {
        en: 'List component counts in the Scene Report panel.',
        'zh-CN': '在场景报告面板中列出组件数量。',
      },
    });

    // — A panel. `mount` gets a plain host element and returns its teardown; the
    //   editor owns the tab, the dirty dot, the error boundary, and pop-out. Style
    //   against the editor's CSS variables and it matches the surrounding chrome. —
    ctx.panels.register({
      id: 'estella.scene-report.panel',
      title: { en: 'Scene Report', 'zh-CN': '场景报告' },
      placement: 'bottom',
      mount: (host) => {
        const root = document.createElement('div');
        root.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;font-size:11px;color:var(--text)';
        host.append(root);

        const render = (): void => {
          const { entities, components } = summarize(ctx);
          const showComponents = ctx.settings.get<boolean>('estella.scene-report.showComponents') ?? true;
          const selection = ctx.scene.getSelection();
          const selected = selection != null ? ctx.scene.getEntity(selection) : null;

          root.replaceChildren();
          const line = (label: string, value: string): void => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px';
            const k = document.createElement('span');
            k.style.cssText = 'color:var(--text-dim);min-width:110px';
            k.textContent = label;
            const v = document.createElement('span');
            v.style.cssText = 'color:var(--text-hi);font-weight:600';
            v.textContent = value;
            row.append(k, v);
            root.append(row);
          };

          line('Entities', String(entities));
          line('Scene', ctx.project.currentScene() ?? '—');
          line('Selected', selected ? `${selected.name} (${selected.components.length} components)` : '—');
          if (showComponents) {
            const list = [...components].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            for (const [type, count] of list) line(`  ${type}`, String(count));
          }
        };

        render();
        // Re-render on the events that change what's displayed. Both handlers are
        // retracted when the plugin unloads, so no listener outlives it.
        const offSelection = ctx.events.on('selectionChanged', render);
        const offScene = ctx.events.on('sceneChanged', render);
        return () => {
          offSelection.dispose();
          offScene.dispose();
        };
      },
    });

    ctx.log.info('scene report ready');
  },
});
