// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * PNG/JPG/RGBA → KTX2 (Basis Universal) for the asset cook. The wasm is single-
 * threaded, so concurrent calls run on worker threads, one instance each: up to
 * the cores this process may use, while the heaps they report fit the budget.
 * `ESTELLA_ENCODER_WORKERS` sets the width; 0 encodes on the calling thread.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import * as core from './encoderCore.mjs';

export { ENCODER_WASM, ImageType } from './encoderCore.mjs';

// A path, not `new URL('./…', import.meta.url)`: bundlers rewrite that pattern as an
// asset (Vite made it an http URL), and a Worker given one never starts nor fails.
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'encoderWorker.mjs');

function workerLimit() {
  const set = process.env.ESTELLA_ENCODER_WORKERS;
  const n = set === undefined || set === '' ? os.availableParallelism() : Number(set);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** How many calls can run at once — what a caller sizes its own in-flight work by. */
export const ENCODER_PARALLELISM = Math.max(1, workerLimit());

/**
 * Half of physical memory, not `os.freemem()`: on macOS free memory leaves out
 * the reclaimable cache and reads a few hundred MB on a machine with gigabytes
 * to spare, which would hold the pool at one worker.
 */
const HEAP_BUDGET = os.totalmem() / 2;

class EncoderPool {
  /** @type {{ worker: Worker, job: object | null, heap: number }[]} */
  slots = [];
  queue = [];
  nextId = 0;
  /** Set once a worker cannot start; every call from then on runs in-thread. */
  broken = false;

  run(op, args) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, op, args, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.queue.length > 0) {
      if (this.broken) {
        const job = this.queue.shift();
        core[job.op](...job.args).then(job.resolve, job.reject);
        continue;
      }
      const slot = this.slots.find((s) => !s.job) ?? (this.canGrow() ? this.spawn() : null);
      if (!slot) return;
      this.start(slot, this.queue.shift());
    }
  }

  /**
   * A worker's heap is only known once it has encoded something, and it grows to
   * the largest image it has seen. So the second worker waits for the first
   * report, and every later one must fit beside the largest heap reported so far.
   */
  canGrow() {
    if (this.slots.length >= workerLimit()) return false;
    if (this.slots.length === 0) return true;
    const largest = Math.max(...this.slots.map((s) => s.heap));
    return largest > 0 && (this.slots.length + 1) * largest <= HEAP_BUDGET;
  }

  spawn() {
    let worker;
    try {
      worker = new Worker(WORKER);
    } catch {
      this.broken = true;
      return null;
    }
    const slot = { worker, job: null, heap: 0 };
    worker.on('message', ({ id, ok, result, heap, message }) => {
      const job = slot.job;
      if (!job || job.id !== id) return;
      slot.job = null;
      slot.heap = heap ?? slot.heap;
      worker.unref();
      if (ok) job.resolve(result);
      else job.reject(new Error(message));
      this.pump();
    });
    const lost = (err) => {
      if (!this.slots.includes(slot)) return;
      this.slots = this.slots.filter((s) => s !== slot);
      const job = slot.job;
      slot.job = null;
      // A worker that never answered says workers do not run here: its job, and
      // every one after it, runs on this thread instead of failing.
      if (slot.heap === 0 && this.slots.every((s) => s.heap === 0)) {
        this.broken = true;
        if (job) this.queue.unshift(job);
      } else {
        job?.reject(err);
      }
      this.pump();
    };
    worker.on('error', lost);
    worker.on('exit', (code) => lost(new Error(`encoder worker exited with code ${code}`)));
    this.slots.push(slot);
    return slot;
  }

  start(slot, job) {
    slot.job = job;
    // A busy worker keeps the process alive; an idle one must not, or a CLI
    // that has finished its export would never exit.
    slot.worker.ref();
    slot.worker.postMessage({ id: job.id, op: job.op, args: job.args });
  }
}

let pool = null;
function call(op, args) {
  if (workerLimit() === 0) return core[op](...args);
  pool ??= new EncoderPool();
  return pool.run(op, args);
}

/**
 * Encode a source image to KTX2 bytes; `source` and `opts` are typed in encoder.d.mts.
 * yFlip defaults on: uncompressed uploads are row-flipped at load, compressed
 * blocks cannot be, so the orientation is baked in here or the texture mirrors.
 */
export function encodeToKtx2(source, opts = {}) {
  return call('encodeToKtx2', [source, opts]);
}

/** Convenience: encode PNG bytes (dimensions read from the PNG header). */
export function encodePngToKtx2(png, opts) {
  return encodeToKtx2({ type: core.ImageType.PNG, data: png }, opts);
}

/**
 * Transcode a KTX2 back to RGBA8 (level 0) — validates encodes and round-trips
 * the pipeline. Returns { width, height, pixels: Uint8Array (w*h*4) }.
 */
export function transcodeKtx2ToRgba(ktx2) {
  return call('transcodeKtx2ToRgba', [ktx2]);
}
