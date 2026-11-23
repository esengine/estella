// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zoneBakeWorker.ts
 * @brief   The worker that bakes a water zone (zoneBake.ts): a job in, the field's parts out, its arrays transferred.
 */
import { bakeZone, type ZoneBakeJob } from './zoneBake';
import { fieldPartsTransfer } from './zoneField';

interface WorkerScope {
    document?: unknown;
    onmessage: ((e: { data: ZoneBakeJob & { id: number } }) => void) | null;
    postMessage(m: unknown, transfer?: ArrayBuffer[]): void;
}
declare const self: WorkerScope | undefined;

if (typeof self !== 'undefined' && typeof self.document === 'undefined') {
    const scope = self;
    scope.onmessage = (e) => {
        const job = e.data;
        try {
            const parts = bakeZone(job);
            scope.postMessage({ id: job.id, result: parts }, fieldPartsTransfer(parts));
        } catch (err) {
            scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
        }
    };
}
