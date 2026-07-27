// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pluginScaffold.ts — write a new editor plugin, ready to run.
 *
 * The shape of a plugin (a folder whose name need not be its id, a manifest whose
 * `engines.editor` range must match THIS editor, a tsconfig pointing at generated
 * typings one directory up) is exactly the part that is hard to know before you
 * have seen one. So the editor writes it, the same way it writes a project
 * platform's two halves — see platformCatalog.ts, whose posture this mirrors:
 * validate first, never clobber, and hand back paths rather than throwing.
 *
 * One rule worth stating: the generated `engines.editor` pins to the RUNNING
 * editor's minor. Below 1.0 the minor is the breaking-change axis, so a template
 * carrying a hard-coded range goes stale the moment the editor's minor moves — and
 * a plugin scaffolded from it would be born `incompatible`.
 *
 * Pure Node: the caller resolves which folder a scope means.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginIdProblem } from '../src/plugins/manifest';
import { PLUGIN_TYPES_DIR } from '../src/plugins/paths';

/** Sample contributions the scaffold can write into the entry file. */
export type ScaffoldContribution = 'command' | 'panel' | 'inspector' | 'overlay' | 'tool';

export const SCAFFOLD_CONTRIBUTIONS: readonly ScaffoldContribution[] = [
  'command',
  'panel',
  'inspector',
  'overlay',
  'tool',
];

export interface ScaffoldPluginOptions {
  /** Dotted, lowercase — also the folder name. */
  id: string;
  /** Display name, written into the manifest as-is. */
  name: string;
  /** Which samples to write. An empty list still produces a valid, loadable plugin. */
  contributions?: readonly ScaffoldContribution[];
  /** The running editor's version — what `engines.editor` is pinned to. */
  editorVersion: string;
  /**
   * Text of the plugin API typings (`src/plugins/types.ts`). Written as the scope's
   * `.types/editor-api.d.ts` sidecar so the generated tsconfig resolves on the first
   * open — including for a user-scoped plugin, which lives outside the project the
   * renderer's type sync can reach.
   */
  apiTypes?: string;
}

export interface ScaffoldPluginResult {
  ok: boolean;
  error?: string;
  /** Absolute plugin folder — what "Reveal" opens. */
  dir?: string;
  /** Files written, relative to the plugin folder. */
  files?: string[];
}

/** `0.34.1` → `^0.34`: the range that means "this editor's line". */
export function editorRangeFor(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  return m ? `^${m[1]}.${m[2]}` : '*';
}

// =============================================================================
// Templates
// =============================================================================

function manifestTemplate(id: string, name: string, editorVersion: string): string {
  // No `description` key: the manifest reader requires a non-empty string when the
  // field is PRESENT, so scaffolding an empty one would write a plugin that fails
  // its own validation. An absent optional field is the honest spelling.
  return `${JSON.stringify(
    {
      id,
      name,
      version: '0.1.0',
      engines: { editor: editorRangeFor(editorVersion) },
      main: { editor: 'src/editor.ts' },
    },
    null,
    2,
  )}\n`;
}

/** Points `@estella/editor-api` at the typings the editor regenerates on open. */
function tsconfigTemplate(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        noEmit: true,
        skipLibCheck: true,
        paths: { '@estella/editor-api': [`../${PLUGIN_TYPES_DIR}/editor-api.d.ts`] },
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`;
}

/** Type-only imports each sample needs, so the entry file compiles as written. */
const SAMPLE_TYPES: Record<ScaffoldContribution, readonly string[]> = {
  command: [],
  panel: [],
  inspector: ['EntityId', 'InspectorSectionBuilder'],
  overlay: ['OverlayGraphics'],
  tool: ['PointerInput'],
};

function sampleBody(kind: ScaffoldContribution, id: string, name: string): string {
  switch (kind) {
    case 'command':
      return `    // A command. It appears in the command palette and — because \`menu\` is set —
    // under Tools in the menu bar. Every register() returns a disposable that is
    // retracted automatically when the plugin unloads, so you rarely keep it.
    ctx.commands.register({
      id: '${id}.hello',
      title: { en: 'Say hello', 'zh-CN': '打个招呼' },
      menu: 'tools',
      run() {
        ctx.ui.toast(\`Hello from ${name}! \${ctx.scene.getSelectionIds().length} selected.\`);
      },
    });`;

    case 'panel':
      return `    // A dock panel. The host element sits inside the editor's own frame, so the
    // theme variables are in scope — style against those and it matches the editor
    // in both light and dark. Open it with ctx.panels.open('${id}.panel').
    ctx.panels.register({
      id: '${id}.panel',
      title: { en: '${name}', 'zh-CN': '${name}' },
      placement: 'side-right',
      width: 260,
      mount(host) {
        const body = document.createElement('div');
        body.style.cssText = 'padding:8px;color:var(--text);font:12px var(--font-ui,sans-serif)';
        const paint = () => {
          body.textContent = \`\${ctx.scene.getSelectionIds().length} entity(ies) selected\`;
        };
        paint();
        host.appendChild(body);
        const sub = ctx.events.on('selectionChanged', paint);
        // Return teardown: called when the panel closes OR the plugin unloads.
        return () => {
          sub.dispose();
          body.remove();
        };
      },
    });`;

    case 'inspector':
      return `    // An extra Inspector section, shown for any entity carrying a Sprite. The host
    // renders these rows as the editor's own property UI, so there is nothing to
    // style — and \`write\` receives edits back by row key.
    ctx.inspector.register({
      kind: 'component',
      id: 'notes',
      component: 'Sprite',
      title: { en: '${name}', 'zh-CN': '${name}' },
      build(entity: EntityId, ui: InspectorSectionBuilder) {
        ui.info({ en: 'Entity', 'zh-CN': '实体' }, String(entity));
        ui.bool('flagged', { en: 'Needs art pass', 'zh-CN': '需要美术检查' },
          ctx.state.get(\`flagged.\${entity}\`, false));
      },
      write(entity: EntityId, key, value) {
        if (key === 'flagged') ctx.state.set(\`flagged.\${entity}\`, value);
      },
    });`;

    case 'overlay':
      return `    // A viewport gizmo, redrawn every frame. Primitives take WORLD coordinates and
    // the host projects them, so this tracks the scene through pan and zoom with no
    // camera math. Keep it cheap — it runs on every frame.
    ctx.overlays.register({
      id: '${id}.gizmo',
      render(g: OverlayGraphics) {
        for (const entity of ctx.scene.getSelectionIds()) {
          const p = ctx.scene.getFieldValue(entity, 'Transform', 'position');
          if (!Array.isArray(p)) continue;
          const at = { x: p[0] as number, y: p[1] as number };
          // Radius is in world units; stroke width is in screen pixels.
          g.circle(at, 48, { color: 'var(--acc)', width: 1, dashed: true });
        }
      },
    });`;

    case 'tool':
      return `    // A viewport tool. Arm it with ctx.tools.activate('${id}.measure'); it then gets
    // first refusal on every pointer-down. Returning true claims the stroke (and its
    // move/up); false lets the click fall through. Choosing any built-in tool
    // disarms it, so the user can never get stuck in here.
    let from: { x: number; y: number } | null = null;
    ctx.tools.register({
      id: '${id}.measure',
      title: { en: 'Measure', 'zh-CN': '测距' },
      onPointerDown(p: PointerInput, tool) {
        from = ctx.viewport.viewportToWorld(p.x, p.y);
        tool.capture(p.pointerId);
        return true;
      },
      onPointerMove() {},
      onPointerUp(p: PointerInput, tool) {
        tool.release(p.pointerId);
        const to = ctx.viewport.viewportToWorld(p.x, p.y);
        if (from && to) {
          const d = Math.hypot(to.x - from.x, to.y - from.y);
          ctx.ui.toast(\`\${d.toFixed(1)} units\`);
        }
        from = null;
      },
      cancel() {
        from = null;
      },
    });`;
  }
}

function entryTemplate(id: string, name: string, contributions: readonly ScaffoldContribution[]): string {
  const typeImports = [...new Set(contributions.flatMap((c) => SAMPLE_TYPES[c]))].sort();
  const imports = ['definePlugin', 'type PluginContext', ...typeImports.map((t) => `type ${t}`)];
  const bodies = contributions.map((c) => sampleBody(c, id, name));
  const body =
    bodies.length > 0
      ? bodies.join('\n\n')
      : `    // Nothing contributed yet. Reach for ctx.commands / panels / inspector /
    // overlays / tools / assets / entities / contextMenus — each register() is
    // retracted for you when this plugin unloads.
    ctx.log.info('${name} activated');`;

  return `// ${name} — an Estella editor plugin.
//
// This runs in the editor's own realm, with the editor's access. Saving any file in
// this folder recompiles and re-activates the plugin, and everything it registered
// is retracted first — so the edit loop is just "save".
import { ${imports.join(', ')} } from '@estella/editor-api';

export default definePlugin({
  activate(ctx: PluginContext) {
${body}
  },

  // Optional. Contributions retract themselves; this is for anything else you own
  // (a timer, a socket, a file watcher).
  deactivate() {},
});
`;
}

// =============================================================================
// Scaffolding
// =============================================================================

/**
 * Write a new plugin into `pluginsRoot` (the scope's folder — a project's
 * `.esengine/plugins/` or the per-user one). Never clobbers: an existing folder is
 * an error, because the alternative is overwriting work with a template.
 */
export async function scaffoldPlugin(
  pluginsRoot: string,
  opts: ScaffoldPluginOptions,
): Promise<ScaffoldPluginResult> {
  const bad = pluginIdProblem(opts.id);
  if (bad) return { ok: false, error: bad };
  const name = opts.name.trim();
  if (!name) return { ok: false, error: 'plugin needs a name' };

  const dir = path.join(pluginsRoot, opts.id);
  if (existsSync(dir)) return { ok: false, error: `${opts.id} already exists here` };

  const contributions = opts.contributions ?? ['command'];
  const files: Record<string, string> = {
    'plugin.json': manifestTemplate(opts.id, name, opts.editorVersion),
    'tsconfig.json': tsconfigTemplate(),
    [path.join('src', 'editor.ts')]: entryTemplate(opts.id, name, contributions),
  };

  try {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      await writeFile(path.join(dir, rel), content, 'utf8');
    }
    // The typings sidecar the generated tsconfig points at. Overwritten rather than
    // preserved: it is generated, and matching the RUNNING editor is its whole job —
    // the same posture init.ts takes when it rewrites this on every project open.
    if (opts.apiTypes) {
      const typesDir = path.join(pluginsRoot, PLUGIN_TYPES_DIR);
      await mkdir(typesDir, { recursive: true });
      await writeFile(path.join(typesDir, 'editor-api.d.ts'), opts.apiTypes, 'utf8');
    }
    return { ok: true, dir, files: Object.keys(files).map((f) => f.split(path.sep).join('/')) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
