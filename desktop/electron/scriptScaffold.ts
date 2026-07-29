// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scriptScaffold.ts — write a new project script, already wired in.
 *
 * A project has exactly two script entries (format.ts `resolveScripts`): the
 * DECLARATION entry the editor reads to build inspectors, and the STARTUP entry
 * the play realm bundles. A `.ts` file neither of them reaches is dead — never
 * bundled, never extracted, its component never in Add Component. That is the
 * part nobody can be expected to know before they have seen a project laid out,
 * so the editor writes it: the module AND the one line in the entry that pulls
 * it in. Which entry depends on what the script IS, and the vocabulary for that
 * lives in ../src/project/scripts.ts, shared with the dialog that asks for it.
 *
 * The entries come from the caller, resolved from the manifest, so a project that
 * renamed them is wired at ITS entries and not at the defaults.
 *
 * Posture mirrors pluginScaffold.ts: validate first, never clobber a file that
 * exists, hand back paths rather than throwing.
 *
 * Pure Node → unit-testable; the IPC wiring lives in main.ts.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  scriptNameProblem, scriptTargetDir, scriptModulePath, scriptWiring,
  type ScriptEntries, type ScriptKind,
} from '../src/project/scripts';

export type { ScriptEntries, ScriptKind };

export interface ScaffoldScriptOptions {
  kind: ScriptKind;
  /** Identifier for the component/system AND the file stem (see `scriptNameProblem`). */
  name: string;
  /** Project-relative folder the user asked for; redirected into the source root
   *  when it lies outside (see `scriptTargetDir`). */
  dir?: string;
  entries: ScriptEntries;
}

export interface ScaffoldScriptResult {
  ok: boolean;
  error?: string;
  /** Project-relative path of the new module. */
  path?: string;
  /** Project-relative path of the entry that now pulls it in. */
  wiredInto?: string;
  /** The line appended there — surfaced so the editor can say what it did. */
  wiredLine?: string;
}

// =============================================================================
// Templates
// =============================================================================

function componentTemplate(name: string, entries: ScriptEntries): string {
  return `// ${name} — a project component: data an entity carries, and a row in its inspector.
//
// Re-exported from ${entries.register}, the ONE module the editor reads to learn a
// project's components. It reads it WITHOUT running the game, so keep startup code
// out of the declaration graph — behaviour belongs in a system (${entries.main}).
import { defineComponent } from 'esengine';

export const ${name} = defineComponent('${name}', {
    // Each field's inspector control comes from the TYPE of its default: a number
    // is a number box, a boolean a checkbox, a string a text field, and an
    // { r, g, b, a } object a color picker.
    speed: 100,
});
`;
}

function systemTemplate(name: string, entries: ScriptEntries): string {
  const fn = `${name.charAt(0).toLowerCase()}${name.slice(1)}System`;
  return `// ${name} — a project system: behaviour that runs every frame while the scene plays.
//
// It registers itself at the bottom of this file, so the one \`import\` line in
// ${entries.main} is the whole of its wiring. Move that call into ${entries.main}
// instead if you would rather read every registration in one list.
import {
    addSystemToSchedule, defineSystem, Mut, Query, Res, Schedule, Time, Transform,
} from 'esengine';

export const ${fn} = defineSystem(
    // The query decides which entities this runs for. Add your own component to
    // narrow it — \`Query(Mut(Transform), MyComponent)\` — and read it from the same
    // tuple below. Mut() is what makes a component writable.
    [Query(Mut(Transform)), Res(Time)],
    (query, time) => {
        for (const [entity, transform] of query) {
            // Scale movement by time.delta (seconds since the last frame) so speed
            // does not depend on frame rate:
            //
            //   transform.position.x += 120 * time.delta;
        }
    },
    { name: '${name}System' },
);

addSystemToSchedule(Schedule.Update, ${fn});
`;
}

// =============================================================================
// Scaffolding
// =============================================================================

/**
 * Append `line` to `entryRel`, creating the file if it is absent. Idempotent: an
 * entry that already carries the line is left byte-identical, so scaffolding over
 * a hand-wired module cannot duplicate its import.
 */
async function appendWiring(root: string, entryRel: string, line: string): Promise<void> {
  const abs = path.join(root, entryRel);
  const existing = existsSync(abs) ? await readFile(abs, 'utf8') : '';
  if (existing.split('\n').some((l) => l.trim() === line)) return;
  const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${existing}${gap}${line}\n`, 'utf8');
}

/**
 * Write `<dir>/<name>.ts` under `root` and wire it into the entry its kind
 * belongs to. Never clobbers: an existing module is an error, because the
 * alternative is overwriting someone's work with a template.
 */
export async function scaffoldScript(
  root: string,
  opts: ScaffoldScriptOptions,
): Promise<ScaffoldScriptResult> {
  const bad = scriptNameProblem(opts.name);
  if (bad) return { ok: false, error: bad };
  const name = opts.name.trim();

  const moduleRel = scriptModulePath(scriptTargetDir(opts.dir, opts.entries), name);
  const abs = path.join(root, moduleRel);
  if (existsSync(abs)) return { ok: false, error: `${moduleRel} already exists` };

  const { entry, line } = scriptWiring(opts.kind, opts.entries, moduleRel);
  const source = opts.kind === 'component'
    ? componentTemplate(name, opts.entries)
    : systemTemplate(name, opts.entries);

  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, source, 'utf8');
    await appendWiring(root, entry, line);
    return { ok: true, path: moduleRel, wiredInto: entry, wiredLine: line };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
