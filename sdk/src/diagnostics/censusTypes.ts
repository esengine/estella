// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    censusTypes.ts
 * @brief   The census vocabulary, apart from the registry that collects it.
 *
 * @details A probe lives in the subsystem it measures — the ECS one in ecs/, the
 *          renderer's next to the renderer — and each needs these types to
 *          declare itself. Were they in census.ts, every subsystem would take a
 *          value import of the registry to get a type, and the registry imports
 *          nothing on purpose so that anything can register with it.
 */
import type { App } from '../app/app';
import type { World } from '../ecs/world';
import type { ESEngineModule } from '../wasm';

/**
 * How a counter is allowed to behave over a long run. See census.ts for why the
 * distinction is the whole design and not bookkeeping.
 */
export type CensusTier = 'conserved' | 'bounded' | 'trend' | 'info';

export interface CensusEntry {
    /** Dotted namespace: `ecs.entities`, `render.gl.textures`, `physics.bodies`. */
    readonly key: string;
    readonly value: number;
    readonly tier: CensusTier;
    readonly unit: 'count' | 'bytes';
}

/**
 * What a probe is given to read. Every field is optional and a probe must cope
 * with any of them missing: a census is taken from a bare World in a unit test,
 * from a full App in the editor, and from a running game where the wasm module
 * is reachable but the App is behind a realm boundary.
 */
export interface CensusContext {
    readonly app?: App;
    readonly world?: World;
    readonly module?: ESEngineModule | null;
}

export interface CensusProbe {
    /** Stable identity; registering the same id twice replaces rather than duplicates. */
    readonly id: string;
    /** `undefined` when this probe cannot measure anything in the given context. */
    read(ctx: CensusContext): readonly CensusEntry[] | undefined;
}

export interface Census {
    readonly atMs: number;
    readonly entries: ReadonlyMap<string, CensusEntry>;
    /** Probes that threw. Their counters are ABSENT from `entries`, not zero. */
    readonly failedProbes: readonly string[];
}
