// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hotReload.ts
 * @brief   State-preserving hot-reload support (RC10 P3): collect a project bundle's
 *          re-registrations in isolation so the editor can decide hot-swap vs reload.
 */
import { AppContext, getDefaultContext, setDefaultContext, type PendingSystemEntry } from './ecs/context';
import { getUserComponentFingerprint, seedEngineComponents } from './ecs/component';

export interface ProbedRegistrations {
    /** Digest of the user component schemas the bundle declared (shape, not values). */
    fingerprint: string;
    /** The systems the bundle queued, to feed to {@link App.hotSwapSystems}. */
    pending: PendingSystemEntry[];
}

/**
 * Run `register` (a project-bundle re-import) inside a throwaway {@link AppContext}, so
 * its `defineComponent` / `addSystem` populate an isolated registry instead of the live
 * one — and return what it registered. The live context is always restored, even on
 * throw. The caller compares `fingerprint` to the live one (`getUserComponentFingerprint`
 * before calling) to choose hot-swap (unchanged → keep the World) vs full-reload, and
 * feeds `pending` to `App.hotSwapSystems`. Component identity is interned by name (see
 * component.ts), so the probe's component defs share the live `_id`s — the re-imported
 * systems' queries resolve to the live storage. See docs/REARCH_HOT_RELOAD.md.
 */
export async function probeRegistrations(register: () => Promise<void>): Promise<ProbedRegistrations> {
    const live = getDefaultContext();
    const probe = new AppContext();
    // The re-imported bundle only re-runs the PROJECT's registrations (the cached
    // esengine module does not), so seed the engine baseline first — otherwise the
    // probe fingerprint would omit every SDK component and never match live, so the
    // hot-swap fast path could never engage.
    seedEngineComponents(probe.componentRegistry);
    setDefaultContext(probe);
    try {
        await register();
        return { fingerprint: getUserComponentFingerprint(), pending: probe.drainPendingSystems() };
    } finally {
        setDefaultContext(live);
    }
}
