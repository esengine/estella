// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  installDrift.mjs — whether the installed dependencies are the ones pnpm-lock.yaml asks for.
 *
 * A checkout whose install is older than its lockfile (or a worktree whose node_modules is a junction into another
 * checkout's) type-checks against the wrong TypeScript and @types, and a workspace package that was never installed
 * cannot resolve its imports at all. The gates that compile or test then go red on code that is fine, and CI, which
 * installs from the lockfile every run, never agrees. Said up front, such a red reads as the install it is.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const text = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** The workspace's package directories, from pnpm-workspace.yaml (a `dir/*` entry is every directory under `dir`). */
function workspaceDirs(root) {
  const yaml = text(path.join(root, 'pnpm-workspace.yaml'));
  const block = /^packages:\n((?:\s+- .+\n)+)/m.exec(yaml)?.[1] ?? '';
  const out = [];
  for (const raw of block.split('\n')) {
    const entry = raw.replace(/^\s+- /, '').replace(/['"]/g, '').trim();
    if (!entry) continue;
    if (entry.endsWith('/*')) {
      const parent = path.join(root, entry.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const d of readdirSync(parent, { withFileTypes: true })) if (d.isDirectory()) out.push(`${entry.slice(0, -2)}/${d.name}`);
    } else {
      out.push(entry);
    }
  }
  return out.filter((dir) => existsSync(path.join(root, dir, 'package.json')));
}

/**
 * What is wrong with the install, as lines to print; empty when it matches the lockfile. Checks the copy of the lockfile
 * pnpm keeps from the last install against the one in the tree, and that each workspace package can see every dependency
 * it declares.
 */
export function installDrift(root) {
  const problems = [];
  const installed = path.join(root, 'node_modules', '.pnpm', 'lock.yaml');
  if (!existsSync(path.join(root, 'node_modules'))) {
    return ['nothing is installed (no node_modules): run `pnpm install`'];
  }
  if (!existsSync(installed)) {
    problems.push('node_modules was not installed by pnpm from this lockfile (no node_modules/.pnpm/lock.yaml)');
  } else if (text(installed) !== text(path.join(root, 'pnpm-lock.yaml'))) {
    problems.push('the installed dependencies are from another pnpm-lock.yaml than this one');
  }
  const missing = [];
  for (const dir of workspaceDirs(root)) {
    const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const absent = deps.filter((d) => !existsSync(path.join(root, dir, 'node_modules', d)));
    if (absent.length) missing.push(`${dir} (${absent.slice(0, 3).join(', ')}${absent.length > 3 ? `, +${absent.length - 3}` : ''})`);
  }
  if (missing.length) problems.push(`not installed for: ${missing.join('; ')}`);
  return problems;
}
