// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sourceCensus.mjs — the files a repository-wide scan is entitled to say
 *        it looked at.
 *
 * `git ls-files` from the root sees NOTHING inside a submodule, and an empty
 * corpus reads exactly like a clean one. The editor is a submodule, so every
 * scan that judged "the repository" judged the engine half of it and reported
 * green about the other half without ever opening a file there.
 *
 * The roots come from `.gitmodules`, which is where submodules are declared, and
 * each one has to say which corpus it belongs to — `source` is ours and is
 * scanned, `vendored` is somebody else's and is not. A submodule that says
 * neither is a finding: a new one must not join the tree unscanned by silence.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The key every submodule in `.gitmodules` owes, and the value that means ours. */
const CORPUS_KEY = 'estella-corpus';
const OURS = 'source';

/**
 * The environment a git command must run in to be ABOUT the directory it is run
 * in. A hook exports GIT_DIR and friends, and they outrank `cwd`: unscrubbed, a
 * submodule corpus comes back as the root's file list wearing the submodule's
 * prefix — worse than the empty one this file exists to prevent.
 */
function unpinnedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

const git = (dir, args, max = 256 * 1024 * 1024) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: max, env: unpinnedEnv() });

/**
 * Every submodule `.gitmodules` declares, with the corpus it claims.
 *
 * Read with `git config -f`, so the parse is git's own rather than a second one
 * that could disagree with it about the file it is looking at.
 */
function declaredSubmodules() {
  let out = '';
  try {
    out = git(ROOT, ['config', '-f', '.gitmodules', '--list']);
  } catch { /* no submodules at all — reported by the caller as an empty census */ }
  const byName = new Map();
  for (const line of out.split('\n')) {
    const m = /^submodule\.(.+)\.([^.=]+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, name, key, value] = m;
    if (!byName.has(name)) byName.set(name, { name });
    if (key === 'path') byName.get(name).path = value;
    if (key === CORPUS_KEY) byName.get(name).corpus = value;
  }
  return [...byName.values()];
}

/**
 * The repositories a scan spans: this one, then every submodule that says it
 * holds our source. `present` is false for one that is declared and not checked
 * out — an optional product, which a scan must name rather than quietly omit.
 */
export function corpusRoots() {
  const roots = [{ prefix: '', dir: ROOT, present: true }];
  for (const sub of declaredSubmodules()) {
    if (sub.corpus !== OURS || !sub.path) continue;
    const dir = path.join(ROOT, sub.path);
    roots.push({ prefix: sub.path, dir, present: existsSync(path.join(dir, '.git')) });
  }
  return roots;
}

/**
 * What is wrong with the census itself, before anything it holds is judged.
 *
 * A declared submodule with no `estella-corpus`, and a present root that yields
 * no files, are the two ways this reports green having read nothing.
 */
export function censusFindings(roots) {
  const findings = [];
  for (const sub of declaredSubmodules()) {
    if (!sub.corpus) {
      findings.push(`.gitmodules declares "${sub.name}" without ${CORPUS_KEY} — `
        + `say \`${CORPUS_KEY} = ${OURS}\` to have it scanned, or \`= vendored\` to say why not`);
    }
  }
  for (const root of roots) {
    if (root.present && trackedFiles(root).length === 0) {
      findings.push(`the corpus at "${root.prefix || '.'}" is checked out and holds no tracked `
        + 'file — the scan below would have judged nothing and said so as green');
    }
  }
  return findings;
}

/** Every tracked path in `root`, prefixed so it names a file from the repo root. */
export function trackedFiles(root) {
  if (!root.present) return [];
  let out = '';
  try { out = git(root.dir, ['ls-files']); } catch { return []; }
  return out.split('\n').filter(Boolean).map((f) => (root.prefix ? `${root.prefix}/${f}` : f));
}

/** Untracked, un-ignored paths in `root`, prefixed the same way. */
export function untrackedFiles(root) {
  if (!root.present) return [];
  let out = '';
  try { out = git(root.dir, ['ls-files', '--others', '--exclude-standard'], 64 * 1024 * 1024); }
  catch { return []; }
  return out.split('\n').filter(Boolean).map((f) => (root.prefix ? `${root.prefix}/${f}` : f));
}

/**
 * Every file in `root` a scan is entitled to say it looked at: tracked and
 * untracked-but-not-ignored, in one list. A scan that lists only tracked files
 * answers "clean" about the file most likely to be wrong — the one just written,
 * which is why both halves live here rather than in each caller.
 */
export function sourceFiles(root, match = null) {
  const all = [...trackedFiles(root), ...untrackedFiles(root)];
  const seen = new Set();
  return all.filter((f) => (match && !match.test(f) ? false : !seen.has(f) && seen.add(f)));
}

/** `git diff` output for what `root` has added since it left the remote. */
export function addedDiff(root, args) {
  if (!root.present) return '';
  let base = '';
  for (const ref of ['origin/master', 'master']) {
    try { base = git(root.dir, ['merge-base', 'HEAD', ref]).trim(); break; } catch { /* next */ }
  }
  try { return git(root.dir, ['diff', ...args, ...(base ? [base] : ['HEAD']), '--']); }
  catch { return ''; }
}
