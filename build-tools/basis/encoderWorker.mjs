// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * One thread of the encoder pool (encoder.mjs): runs encoderCore on its own wasm
 * instance and answers each job with its result and the heap it now holds.
 */
import { parentPort } from 'node:worker_threads';
import * as core from './encoderCore.mjs';

parentPort.on('message', async ({ id, op, args }) => {
  try {
    const result = await core[op](...args);
    const bytes = result instanceof Uint8Array ? result : result.pixels;
    parentPort.postMessage({ id, ok: true, result, heap: await core.heapBytes() }, [bytes.buffer]);
  } catch (err) {
    parentPort.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});
