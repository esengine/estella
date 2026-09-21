// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which engine subsystems the shipped content actually reaches.
 *
 * Two questions read the same answer: what a target cannot render (a warning),
 * and which subpaths a package has to import to get what it uses. Asking twice
 * would be two walks of the same documents that could disagree about a scene.
 *
 * `targetSupport` owns the component→subsystem table and is deliberately free
 * of node imports, so the walk lives here rather than beside it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectSubsystems, type Subsystem } from '../project/targetSupport';

/** Subsystem → the shipped documents that use it, for a message that names one. */
export async function contentSubsystems(
  root: string, includedPaths: readonly string[],
): Promise<Map<Subsystem, string[]>> {
  const usage = new Map<Subsystem, string[]>();
  for (const rel of includedPaths) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.esscene' && ext !== '.esprefab') continue;
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(path.join(root, rel), 'utf8'));
    } catch {
      continue;  // unreadable/!JSON — the cook already staged (and warned about) it
    }
    for (const subsystem of collectSubsystems(doc)) {
      const files = usage.get(subsystem);
      if (files) files.push(rel);
      else usage.set(subsystem, [rel]);
    }
  }
  return usage;
}
