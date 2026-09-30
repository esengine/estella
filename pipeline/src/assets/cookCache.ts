// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  cookCache.ts — an encode the cook already did, read back instead of redone.
 *
 * Texture encoding is the cook's dearest step (seconds per large texture), and
 * its output depends only on the source bytes, the settings and the encoder.
 * So the output is kept under `.esengine/cache/cook/`, named by a hash of those,
 * and a later export of unchanged art costs a file read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = '.esengine/cache/cook';

/** Part of every key: an encode by a different encoder is a different result. */
export function encoderIdentity(encoderFile: string): string {
    try {
        const st = statSync(encoderFile);
        return createHash('sha256').update(readFileSync(encoderFile)).digest('hex').slice(0, 16) + `:${st.size}`;
    } catch {
        return 'unknown-encoder';
    }
}

/** Concurrent cooks in one process can produce the same key; each writes its own temp file. */
let tmpSerial = 0;

/** Where the cache keeps what these inputs cook to — whether or not it holds it yet. */
export function cookCacheFile(root: string, inputs: ReadonlyArray<Uint8Array | string>): string {
    const h = createHash('sha256');
    for (const part of inputs) {
        h.update(typeof part === 'string' ? `s${part.length}:${part}` : `b${part.byteLength}:`);
        if (typeof part !== 'string') h.update(part);
    }
    return path.join(root, CACHE_DIR, `${h.digest('hex')}.bin`);
}

/** What an earlier cook left at @p file, or null — never produces. */
export async function cookCacheHitAt(file: string): Promise<Uint8Array | null> {
    return existsSync(file) ? await readFile(file) : null;
}

/**
 * The bytes `produce` makes for the inputs @p file was named by, from the cache
 * when an earlier cook made them. A cache that cannot be written is only slower,
 * never wrong.
 */
export async function cookCachedAt(
    file: string, produce: () => Promise<Uint8Array>,
): Promise<{ bytes: Uint8Array; hit: boolean }> {
    if (existsSync(file)) return { bytes: await readFile(file), hit: true };
    const bytes = await produce();
    try {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${tmpSerial++}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, file);
    } catch { /* a read-only project cooks every time */ }
    return { bytes, hit: false };
}

export function cookCached(
    root: string, inputs: ReadonlyArray<Uint8Array | string>, produce: () => Promise<Uint8Array>,
): Promise<{ bytes: Uint8Array; hit: boolean }> {
    return cookCachedAt(cookCacheFile(root, inputs), produce);
}
