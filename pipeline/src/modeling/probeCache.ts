// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { probeIdentity, type BakeProbes } from './normalBake';

const KEY_BYTES = 32;

type Numbers = Int32Array | Float32Array | Float64Array;

const bytesOf = (array: Numbers): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function keyOf(parts: ReadonlyArray<string | number | Numbers>): Buffer {
    const hash = createHash('sha256');
    for (const part of parts) {
        if (typeof part === 'object') {
            hash.update(`b${part.byteLength}:`);
            hash.update(bytesOf(part));
        } else {
            const text = String(part);
            hash.update(`s${text.length}:${text}`);
        }
    }
    return hash.digest();
}

function held(file: string, key: Buffer, into: Numbers): boolean {
    try {
        if (!existsSync(file)) return false;
        const bytes = readFileSync(file);
        if (bytes.byteLength < KEY_BYTES || !bytes.subarray(0, KEY_BYTES).equals(key)) return false;
        const values = inflateSync(bytes.subarray(KEY_BYTES));
        if (values.byteLength !== into.byteLength) return false;
        bytesOf(into).set(values);
        return true;
    } catch {
        return false;
    }
}

function keep(file: string, key: Buffer, values: Numbers): void {
    try {
        mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        const fd = openSync(tmp, 'w');
        try {
            writeSync(fd, key);
            writeSync(fd, deflateSync(bytesOf(values), { level: 1 }));
        } finally {
            closeSync(fd);
        }
        renameSync(tmp, file);
    } catch {
        return;
    }
}

export interface ProbeCache {
    reused: number;
    save(): void;
}

export function openProbeCache(dir: string, stem: string, size: number, probes: BakeProbes): ProbeCache {
    const surface = keyOf([probeIdentity(), probes.corners, probes.normals]).toString('hex');
    const pending: Array<() => void> = [];
    let reused = 0;
    probes.reliefs.forEach((relief, index) => {
        const file = path.join(dir, `${stem}.${size}.relief-${index}.bin`);
        const key = keyOf(['relief', surface, relief.reach, probes.triangles, probes.places]);
        const known = new Float64Array(relief.values.length);
        if (held(file, key, known)) {
            relief.values.set(known);
            const before = relief.todo.length;
            relief.todo = relief.todo.filter((slot) => Number.isNaN(known[slot]!));
            reused += before - relief.todo.length;
        }
        if (relief.todo.length) pending.push(() => keep(file, key, relief.values));
    });
    const occlusion = probes.occlusion;
    if (occlusion) {
        const file = path.join(dir, `${stem}.${size}.occlusion.bin`);
        const key = keyOf(['occlusion', surface, occlusion.reach, occlusion.samples, occlusion.bias, occlusion.texels, occlusion.triangles, occlusion.places]);
        if (held(file, key, occlusion.values)) {
            reused += occlusion.todo.length;
            occlusion.todo = new Int32Array(0);
        } else {
            pending.push(() => keep(file, key, occlusion.values));
        }
    }
    return { reused, save: () => pending.forEach((write) => write()) };
}
