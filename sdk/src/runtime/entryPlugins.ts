// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entryPlugins.ts — what an entry point installs, held apart from the
 *        factory that reads it.
 *
 * Its own module because `webAppFactory` is re-exported wholesale by every SDK
 * entry: a setter living there would be public API, and this is a seam between
 * an entry and the factory, not something a game calls.
 *
 * Keyed, not appended. The list was an array, safe because the only caller was a
 * module's top-level side effect and ESM runs a module once. Registration is a
 * CALL now — `esengine/spine` makes it and so does an entry's
 * `installOptionalPlugins()` — and the editor does both, so every app it built
 * carried two SpinePlugins. One subsystem, one maker, held here rather than in
 * each caller's memory of whether it has run.
 */
import type { Plugin } from '../app/app';

const makers = new Map<string, () => Plugin>();

/**
 * Called by an optional subsystem's support module. `id` is the subsystem, so a
 * second registration of the same one replaces rather than adds.
 */
export function addEntryPlugin(id: string, make: () => Plugin): void {
    makers.set(id, make);
}

/** Fresh instances per app: a plugin carries per-app state once built. */
export function entryPlugins(): Plugin[] {
    return [...makers.values()].map((make) => make());
}
