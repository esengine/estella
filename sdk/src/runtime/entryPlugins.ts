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

let make: () => Plugin[] = () => [];

/** Called once, by `runtime/optionalPlugins`, for its side effect. */
export function setEntryPlugins(fn: () => Plugin[]): void {
    make = fn;
}

/** Fresh instances per app: a plugin carries per-app state once built. */
export function entryPlugins(): Plugin[] {
    return make();
}
