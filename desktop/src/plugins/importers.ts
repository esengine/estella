// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  importers.ts — contributed converters from a file the engine cannot read
 *        into assets it can.
 *
 * What they produce is ordinary project files, so nothing downstream — the
 * registry, the inspector, cooking, the shipped build — learns a second format.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import { Toasts } from '@/store/Toasts';

/** An importer as the host holds it: the declaration, plus the already-guarded
 *  call, so a failure is attributed to its plugin wherever it is run from. */
export interface RegisteredImporter {
  id: string;
  extensions: readonly string[];
  run(path: string): Promise<void>;
}

const contrib = new ContributionRegistry<RegisteredImporter>('asset importer');

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
};

export const importerRegistry = {
  register: (owner: Owner, importer: RegisteredImporter): Disposable => contrib.register(owner, importer),
  disposeOwner: (owner: Owner): void => contrib.disposeOwner(owner),
  all: (): readonly RegisteredImporter[] => contrib.all(),

  /** The importers claiming this path's extension, in registration order. */
  forPath(path: string): RegisteredImporter[] {
    const ext = extensionOf(path);
    return ext === '' ? [] : contrib.all().filter((i) => i.extensions.some((e) => e.toLowerCase() === ext));
  },
};

/** Whether any importer claims this path — the watcher's cheap pre-filter. */
export const hasImporter = (path: string): boolean => importerRegistry.forPath(path).length > 0;

// An importer writes files, and those writes come back through the same watcher.
// A converter that produced its own source extension would otherwise re-enter
// forever; one run per path at a time ends that without forbidding anything.
const running = new Set<string>();

/** Run every importer claiming each path. Failures are reported against their
 *  plugin and never stop the others. */
export async function runImporters(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    for (const importer of importerRegistry.forPath(path)) {
      const key = `${importer.id} -> ${path}`;
      if (running.has(key)) continue;
      running.add(key);
      try {
        await importer.run(path);
      } finally {
        running.delete(key);
      }
    }
  }
}

// The model import is the editor's own, but it is an importer like any other and
// is registered rather than special-cased — Reimport and the source watcher then
// reach it by the one rule, not by a second test for model extensions.
importerRegistry.register('core', {
  id: 'core:model',
  extensions: ['gltf', 'glb'],
  run: async (path: string): Promise<void> => {
    const result = await window.estella.project.reimportModel(path);
    // The same notes a first import shows: what the source says that the engine
    // cannot draw, and how big it arrived.
    for (const warning of result.warnings) Toasts.push(`${path}: ${warning}`, 'warn');
  },
});
