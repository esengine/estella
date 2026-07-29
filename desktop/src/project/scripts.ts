// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  scripts.ts
 * @brief What a project SCRIPT is, in the terms both sides of the editor need:
 *        the two kinds, the rule for naming one, where a new one goes, and how an
 *        entry imports it. Pure string work, no fs and no node imports — so the
 *        main process (electron/scriptScaffold.ts, which writes the file) and the
 *        renderer (the New Script dialog, which validates before asking it to)
 *        answer from ONE source and cannot disagree about a name.
 *
 *        The same direction pluginScaffold.ts takes with `pluginIdProblem`: the
 *        rule lives with the UI that must not accept what the writer would reject.
 *
 *        Script ENTRIES (which module is the declaration one, which the startup
 *        one) are a manifest fact and stay in format.ts — `resolveScripts`.
 */

/**
 * What a new module IS, which decides both its template and which entry pulls it
 * in. The distinction is the project's own architecture, not a menu convenience:
 * a component is a DECLARATION the editor reads without running the game, a
 * system is BEHAVIOUR the play realm bundles and runs.
 */
export type ScriptKind = 'component' | 'system';

export const SCRIPT_KINDS: readonly ScriptKind[] = ['component', 'system'];

/** The project's script entries (project-relative), as `resolveScripts` returns them. */
export interface ScriptEntries {
  /** Declaration entry — the module the editor extracts component schemas from. */
  register: string;
  /** Startup entry — the module the play realm bundles. */
  main: string;
}

// Reserved words a declaration cannot be named. Not the full ECMAScript list:
// only the ones that are otherwise legal-looking identifiers someone might type.
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'let', 'static', 'yield', 'await',
  'implements', 'interface', 'package', 'private', 'protected', 'public',
]);

/**
 * Why `name` cannot be used, or null when it can.
 *
 * One name plays three parts at once — the exported identifier, the module's file
 * stem, and (for a component) the string every scene serializes — so the
 * strictest of the three governs: a plain JS identifier.
 */
export function scriptNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'name is required';
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) {
    return 'use letters, digits, _ and $ only, and do not start with a digit';
  }
  if (RESERVED.has(n)) return `"${n}" is a reserved word`;
  return null;
}

/** Project-relative, forward-slashed, no leading `./` or trailing slash. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** The project's source root — where its declaration entry lives. */
export function scriptSourceRoot(entries: ScriptEntries): string {
  return dirOf(norm(entries.register));
}

/**
 * Where a new module goes: the folder the user is browsing when it is inside the
 * source root, else the source root itself.
 *
 * A module outside the source tree is reached by neither entry's import graph nor
 * the watcher's schema re-extract, so honouring "create it here" for a folder
 * under `assets/` would hand back a file that silently does nothing. Derived from
 * the declaration entry rather than hard-coded, so a project that keeps its
 * scripts elsewhere gets them there.
 */
export function scriptTargetDir(dir: string | undefined, entries: ScriptEntries): string {
  const root = scriptSourceRoot(entries);
  const asked = norm(dir ?? '');
  if (!root) return asked;
  return asked === root || asked.startsWith(`${root}/`) ? asked : root;
}

/** The project-relative path a script of `name` gets under `dir`. */
export function scriptModulePath(dir: string, name: string): string {
  const d = norm(dir);
  return d ? `${d}/${name.trim()}.ts` : `${name.trim()}.ts`;
}

/** The specifier `entryRel` would import `moduleRel` by (relative, extensionless). */
export function importSpecifier(entryRel: string, moduleRel: string): string {
  const from = dirOf(norm(entryRel)).split('/').filter(Boolean);
  const to = norm(moduleRel).replace(/\.tsx?$/, '').split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * The entry a kind wires into, and the line appended there. A component is
 * RE-EXPORTED (naming what the project declares is the declaration entry's whole
 * job); a system is IMPORTED for the registration side effect its module performs.
 */
export function scriptWiring(
  kind: ScriptKind,
  entries: ScriptEntries,
  moduleRel: string,
): { entry: string; line: string } {
  const entry = norm(kind === 'component' ? entries.register : entries.main);
  const spec = importSpecifier(entry, moduleRel);
  return { entry, line: kind === 'component' ? `export * from '${spec}';` : `import '${spec}';` };
}
