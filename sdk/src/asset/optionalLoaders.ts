// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  optionalLoaders.ts — asset loaders an optional subsystem brings, held
 *        apart from the registry that installs them.
 *
 * `Assets` constructs every loader it knows, and a loader names its subsystem's
 * parser — so a project with no tilemap carried the tilemap parser because the
 * asset layer knew how to read one. The subsystem registers instead, when a
 * package imports its subpath.
 *
 * Keyed by subsystem, for the reason `entryPlugins` is: registration is a call
 * an entry and a subpath can both make.
 */
import type { AssetLoader } from './AssetLoader';

const makers = new Map<string, () => AssetLoader<unknown>>();

/** Called by an optional subsystem's support module. */
export function addAssetLoader(id: string, make: () => AssetLoader<unknown>): void {
  makers.set(id, make);
}

/** Fresh instances per registry: a loader may hold per-registry state. */
export function optionalAssetLoaders(): Array<AssetLoader<unknown>> {
  return [...makers.values()].map((make) => make());
}
