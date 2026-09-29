// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightmapWorker.ts
 * @brief   One thread of a {@link BakePool}: holds the scene it was handed, solves
 *          the ranges it is sent, and says when each is done.
 */

import { parentPort } from 'node:worker_threads';
import { bakeRunner, type BakeJob, type BakeScene } from 'esengine';

let run: ReturnType<typeof bakeRunner> | null = null;

parentPort?.on('message', (m: { scene?: BakeScene; job?: BakeJob; from?: number; to?: number }) => {
    if (m.scene) { run = bakeRunner(m.scene); return; }
    run!(m.job!, m.from!, m.to!);
    parentPort!.postMessage(0);
});
