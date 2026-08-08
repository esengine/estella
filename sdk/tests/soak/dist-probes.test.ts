// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The census survives bundling — asserted against dist, not src.
 *
 * Every other soak test imports `../../src`, so all of them passed while the
 * SHIPPED engine carried a takeCensus with zero probes: the bundler treats every
 * non-entry module as side-effect free, and the registrations were reached by a
 * bare import. The editor asked for a census and got an empty one. A green suite
 * and a blind instrument, at the same time.
 *
 * So this one reads what actually ships. It skips when dist is absent rather
 * than failing, because a source-only checkout has nothing to say here — but CI
 * builds the SDK before running tests, so there it is the real gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve(__dirname, '../../dist/index.js');
const HAS_DIST = existsSync(DIST);

describe.skipIf(!HAS_DIST)('the built SDK', () => {
    it('ships a census with its probes attached', async () => {
        const sdk = await import(DIST) as {
            takeCensus: (ctx?: unknown) => { entries: Map<string, unknown>; failedProbes: string[] };
            censusProbeIds: () => string[];
        };

        expect(typeof sdk.takeCensus).toBe('function');
        const ids = sdk.censusProbeIds();
        // Named explicitly: a bundler that drops one probe module leaves the
        // others answering, and a count check would still pass.
        expect(ids).toEqual(expect.arrayContaining(['ecs', 'events', 'heap', 'render', 'asset', 'physics']));

        // With no App the subsystem probes report nothing, but the ones that read
        // process-wide state must still answer — that is the difference between
        // "nothing to measure here" and "no instrument at all".
        const census = sdk.takeCensus();
        expect(census.failedProbes).toEqual([]);
        expect([...census.entries.keys()]).toEqual(
            expect.arrayContaining(['events.emitterHandlers', 'events.domListeners']),
        );
    });
});
