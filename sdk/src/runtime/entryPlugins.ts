// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entryPlugins.ts — what an entry point installs, held apart from the
 *        factory that reads it.
 *
 * Its own module because `webAppFactory` is re-exported wholesale by every SDK
 * entry: a setter living there would be public API, and this is a seam between
 * an entry and the factory, not something a game calls.
 */
import type { Plugin } from '../app/app';

// Additive, not a single setter: each optional subsystem installs itself when
// its subpath is imported, and a setter would mean the last one imported was the
// only one installed. ESM runs a module once, so a double import adds nothing.
const makers: Array<() => Plugin> = [];

/** Called by an optional subsystem's entry, for its side effect. */
export function addEntryPlugin(make: () => Plugin): void {
    makers.push(make);
}

/** Fresh instances per app: a plugin carries per-app state once built. */
export function entryPlugins(): Plugin[] {
    return makers.map((make) => make());
}
