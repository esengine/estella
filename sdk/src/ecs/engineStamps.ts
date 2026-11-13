// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Where a world's batched engine stamps are handed over before the engine reads them.
 *
 * A script's writes to engine components are stamped in the engine (Registry::markChanged), batched in the World and handed
 * over in one call (World.flushEngineStamps). Whatever in the engine reads changes has to come after that hand-over: the render
 * pipeline asks for it, by the registry it draws, before the frame's transforms are composed.
 */

const flushers = new WeakMap<object, () => void>();

/** @internal A world says how its stamps for @p registry are handed over. */
export function registerEngineStampFlush(registry: object, flush: () => void): void {
    flushers.set(registry, flush);
}

/** @internal Hands over the stamps a world holds for @p registry, if any: call before the engine reads what changed. */
export function flushEngineStamps(registry: object | null | undefined): void {
    if (registry) flushers.get(registry)?.();
}
