// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { WorldStreamer } from '../src/residency/WorldStreamer';
import type { ResidencySource, WorldCell } from '../src/residency/cells';

// Time reconciliation after publication has settled. Scene I/O and status reporting are outside the timed loop.
async function settledWorld(side: number, radius: number, centers: readonly number[], farDistance?: number) {
    const cells: WorldCell[] = Array.from({ length: side * side }, (_, i) => {
        const x = i % side, z = Math.floor(i / side);
        return {
            name: `cell_${x}_${z}`, path: `world/${x}_${z}.json`, x, z, minX: 600 * x, minZ: 600 * z,
            maxX: 600 * (x + 1), maxZ: 600 * (z + 1), entityCount: 1, rootCount: 1,
            ...(farDistance === undefined ? {} : { proxy: `world/${x}_${z}.far.json` }),
        };
    });
    const loaded = new Set<string>();
    const streamer = new WorldStreamer({
        register() {}, async prepare() {}, discardPrepared: () => 0,
        async loadAdditive(name) { loaded.add(name); }, async unload(name) { loaded.delete(name); },
        isLoaded: name => loaded.has(name),
    });
    await streamer.loadManifest({ version: 1, scene: 'main', cellSize: 600, persistentRefs: [], cells, farDistance });
    const poses: ResidencySource[][] = [-12, -6, 6, 12].map(dx => centers.map(index => {
        const center = (index + 0.5) * 600;
        return { x: center + dx, z: center - dx, loadRadius: radius, unloadRadius: radius * 1.05, prefetchRadius: radius };
    }));
    streamer.update(poses[0]!);
    await new Promise(resolve => setTimeout(resolve, 0));
    streamer.update(poses[0]!);
    const status = streamer.status();
    if (!loaded.size || status.residentCells.length !== status.desiredCells.length
        || loaded.size !== status.residentCells.length + status.proxyCells.length
        || (farDistance !== undefined && status.proxyCells.length === 0)) {
        throw new Error('Residency fixture did not settle');
    }
    return { streamer, poses };
}

for (const centers of [[64], [2, 125]]) {
    describe(`far proxy residency / 16384 cells / ${centers.length} source(s)`, async () => {
        const { streamer, poses } = await settledWorld(128, 500, centers, 1200);
        let position = 0;
        bench('move inside the settled view', () => {
            position = (position + 1) % poses.length;
            streamer.update(poses[position]!);
        }, { time: 600, warmupTime: 100 });
    });
}

const workloads = [
    [4, 500, [2]], [10, 500, [5]], [32, 500, [16]],
    [10, Infinity, [5]], [32, 500, [2, 29]],
] as const;
for (const [side, radius, centers] of workloads) {
    describe(`world residency / ${side * side} cells / radius ${radius} / ${centers.length} source(s)`, async () => {
        const { streamer, poses } = await settledWorld(side, radius, centers);
        let position = 0;
        bench('stationary source', () => { streamer.update(poses[0]!); });
        bench('moving within the resident neighbourhood', () => {
            position = (position + 1) % poses.length;
            streamer.update(poses[position]!);
        });
    });
}
