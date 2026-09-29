// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightmapPool.ts
 * @brief   A bake's passes split across worker threads. Every lumel is solved on
 *          its own, so the threads share one scene in shared memory and each takes
 *          ranges of lumels until a pass runs out.
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { BakeAlloc, BakeScene, BakeStep } from 'esengine';
import type { BakeExecutor } from './lightmapBake';

export const sharedAlloc: BakeAlloc = {
    f32: (n) => new Float32Array(new SharedArrayBuffer(n * 4)),
    i32: (n) => new Int32Array(new SharedArrayBuffer(n * 4)),
    u8: (n) => new Uint8Array(new SharedArrayBuffer(n)),
};

/** Ranges per thread per pass: enough that one slow range does not idle the rest. */
const RANGES_PER_THREAD = 16;

export class BakePool implements BakeExecutor {
    readonly alloc = sharedAlloc;
    private readonly workers: Worker[];
    private scene: BakeScene | null = null;

    /**
     * @param workerFile A module that runs `lightmapWorker.ts`: each host builds its
     *        own, since a thread cannot start from TypeScript source.
     */
    constructor(workerFile: string | URL, threads = Math.max(1, availableParallelism() - 1)) {
        this.workers = Array.from({ length: threads }, () => new Worker(workerFile));
    }

    get threads(): number { return this.workers.length; }

    async run({ scene, job }: BakeStep): Promise<void> {
        if (scene !== this.scene) {
            if (typeof scene.sky === 'function') {
                throw new Error('BakePool: a bake split across threads needs its sky as a SkySpec');
            }
            for (const w of this.workers) w.postMessage({ scene });
            this.scene = scene;
        }
        const count = scene.lumels.count;
        const range = Math.max(64, Math.ceil(count / (this.workers.length * RANGES_PER_THREAD)));
        let next = 0;
        await Promise.all(this.workers.map((w) => new Promise<void>((resolve, reject) => {
            const give = (): void => {
                if (next >= count) { w.off('message', give); w.off('error', reject); resolve(); return; }
                const from = next;
                next = Math.min(count, next + range);
                w.postMessage({ job, from, to: next });
            };
            w.on('message', give);
            w.on('error', reject);
            give();
        })));
    }

    async close(): Promise<void> {
        await Promise.all(this.workers.map((w) => w.terminate()));
    }
}
