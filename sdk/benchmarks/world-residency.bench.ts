// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { WorldStreamer } from '../src/residency/WorldStreamer';
import type { ResidencySource, WorldCell } from '../src/residency/cells';

// Time reconciliation after publication has settled. Scene I/O and status reporting are outside the timed loop.
async function settledWorld(side: number, radius: number) {
    const cells: WorldCell[] = Array.from({ length: side * side }, (_, i) => {
        const x = i % side, z = Math.floor(i / side);
        return {
            name: `cell_${x}_${z}`, path: `world/${x}_${z}.json`, x, z, minX: 600 * x, minZ: 600 * z,
            maxX: 600 * (x + 1), maxZ: 600 * (z + 1), entityCount: 1, rootCount: 1,
        };
    });
    const loaded = new Set<string>();
    const streamer = new WorldStreamer({
        register() {}, async prepare() {}, discardPrepared: () => 0,
        async loadAdditive(name) { loaded.add(name); }, async unload(name) { loaded.delete(name); },
        isLoaded: name => loaded.has(name),
    });
    await streamer.loadManifest({ version: 1, scene: 'main', cellSize: 600, persistentRefs: [], cells });
    const center = (Math.floor(side / 2) + 0.5) * 600;
    const poses: ResidencySource[][] = [-12, -6, 6, 12].map(dx => [{
        x: center + dx, z: center - dx, loadRadius: radius, unloadRadius: radius * 1.05, prefetchRadius: radius,
    }]);
    streamer.update(poses[0]!);
    await new Promise(resolve => setTimeout(resolve, 0));
    streamer.update(poses[0]!);
    const status = streamer.status();
    if (!loaded.size || loaded.size !== status.desiredCells.length || loaded.size !== status.residentCells.length) {
        throw new Error('Residency fixture did not settle');
    }
    return { streamer, poses };
}

for (const [side, radius] of [[4, 500], [10, 500], [32, 500], [10, Infinity]] as const) {
    describe(`world residency / ${side * side} cells / radius ${radius}`, async () => {
        const { streamer, poses } = await settledWorld(side, radius);
        let position = 0;
        bench('stationary source', () => { streamer.update(poses[0]!); });
        bench('moving within the resident neighbourhood', () => {
            position = (position + 1) % poses.length;
            streamer.update(poses[position]!);
        });
    });
}
