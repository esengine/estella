// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    censusRegistry.ts
 * @brief   Where probes are kept, apart from both the probes and the judge.
 *
 * @details Split out so `census.ts` can depend on the engine's own probes (it
 *          installs them before the first snapshot) while those probes depend
 *          only on this — no cycle. The bundler's tree-shaking makes the
 *          alternative unsafe: with every module but an entry marked
 *          side-effect free, registrations reached by a bare import or a
 *          top-level call are dropped from dist, and takeCensus ships blind.
 */
import type { Census, CensusEntry, CensusProbe, CensusContext, CensusTier } from './censusTypes';

const probes = new Map<string, CensusProbe>();

/**
 * Register a source of counters. Keyed by `probe.id`, so a plugin installed
 * twice replaces its probe rather than double-counting through it.
 */
export function registerCensusProbe(probe: CensusProbe): () => void {
    probes.set(probe.id, probe);
    return () => {
        if (probes.get(probe.id) === probe) probes.delete(probe.id);
    };
}

/** Registered probe ids, for diagnosing a census that came back thinner than expected. */
export function registeredProbeIds(): string[] {
    return [...probes.keys()].sort();
}

/**
 * Read every registered probe into one snapshot.
 *
 * A probe that throws is RECORDED as failed, not allowed to abort the census:
 * the other twenty counters still answer, and "this probe stopped" is itself a
 * finding — silently missing counters is how a leak hides.
 */
export function readProbes(ctx: CensusContext): Census {
    const entries = new Map<string, CensusEntry>();
    const failed: string[] = [];

    for (const probe of probes.values()) {
        let read: readonly CensusEntry[] | undefined;
        try {
            read = probe.read(ctx);
        } catch (e) {
            failed.push(`${probe.id}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }
        if (!read) continue;
        for (const entry of read) entries.set(entry.key, entry);
    }

    return {
        atMs: typeof performance !== 'undefined' ? performance.now() : 0,
        entries,
        failedProbes: failed,
    };
}

/** Build one counter. Sugar so a probe body reads as a list of facts. */
export function counter(key: string, value: number, tier: CensusTier, unit: CensusEntry['unit'] = 'count'): CensusEntry {
    return { key, value, tier, unit };
}
