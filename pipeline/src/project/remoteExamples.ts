// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import {
    EXAMPLES_INDEX, exampleBases, exampleStoreDir, installedExampleDir, isRemoteExample, parseExampleIndex,
    type ExampleIndexEntry,
} from '../../../build-tools/utils/remoteExamples.js';
import { releaseMirrors } from '../../../build-tools/utils/nativeTemplate.js';
import { extractZip } from '../../../build-tools/utils/zip.js';
import { PROJECT_MANIFEST_FILE } from './format';

export interface ExampleDownloadProgress {
    received: number;
    total: number;
}

export interface ExampleInstallResult {
    ok: boolean;
    dir?: string;
    error?: string;
}

export function installedExample(name: string, storeDir = exampleStoreDir()): string | null {
    if (!isRemoteExample(name)) return null;
    const dir = installedExampleDir(name, storeDir);
    return existsSync(path.join(dir, PROJECT_MANIFEST_FILE)) ? dir : null;
}

export async function fetchExampleIndex(
    fetchImpl: typeof fetch = fetch,
    bases: readonly string[] = exampleBases(releaseMirrors()),
): Promise<{ base: string; entries: ExampleIndexEntry[] } | null> {
    for (const base of bases) {
        try {
            const res = await fetchImpl(`${base}/${EXAMPLES_INDEX}`);
            if (!res.ok) continue;
            const entries = parseExampleIndex(await res.json());
            if (entries) return { base, entries };
        } catch {
            continue;
        }
    }
    return null;
}

export async function downloadExample(
    name: string,
    options: {
        onProgress?: (progress: ExampleDownloadProgress) => void;
        fetchImpl?: typeof fetch;
        bases?: readonly string[];
        storeDir?: string;
    } = {},
): Promise<ExampleInstallResult> {
    if (!isRemoteExample(name)) return { ok: false, error: `${name} is not a downloadable example` };
    const fetchImpl = options.fetchImpl ?? fetch;
    const bases = options.bases ?? exampleBases(releaseMirrors());
    const storeDir = options.storeDir ?? exampleStoreDir();

    let lastError = 'no source for the examples';
    for (const base of bases) {
        const attempt = await downloadFrom(base, name, fetchImpl, storeDir, options.onProgress);
        if (attempt.ok) return attempt;
        lastError = attempt.error ?? lastError;
    }
    return { ok: false, error: lastError };
}

async function downloadFrom(
    base: string,
    name: string,
    fetchImpl: typeof fetch,
    storeDir: string,
    onProgress?: (progress: ExampleDownloadProgress) => void,
): Promise<ExampleInstallResult> {
    const staging = path.join(storeDir, `.incoming-${randomUUID()}`);
    try {
        const index = await fetchExampleIndex(fetchImpl, [base]);
        if (!index) return { ok: false, error: `no example index at ${base}` };
        const entry = index.entries.find((e) => e.name === name);
        if (!entry) return { ok: false, error: `the index lists no ${name}` };

        const res = await fetchImpl(`${base}/${entry.file}`);
        if (!res.ok || !res.body) return { ok: false, error: `download failed (HTTP ${res.status})` };

        mkdirSync(staging, { recursive: true });
        const file = path.join(staging, entry.file);
        const digest = createHash('sha256');
        let received = 0;
        const sink = createWriteStream(file);
        for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
            digest.update(chunk);
            received += chunk.byteLength;
            onProgress?.({ received, total: entry.bytes });
            if (!sink.write(chunk)) await once(sink, 'drain');
        }
        await new Promise<void>((resolve, reject) => sink.end((err?: Error) => (err ? reject(err) : resolve())));

        if (received !== entry.bytes) return { ok: false, error: `download is ${received} bytes, the index says ${entry.bytes}` };
        if (digest.digest('hex') !== entry.sha256) return { ok: false, error: 'checksum mismatch' };

        const unpacked = path.join(staging, 'project');
        mkdirSync(unpacked);
        extractZip(readFileSync(file), unpacked);
        if (!existsSync(path.join(unpacked, PROJECT_MANIFEST_FILE))) return { ok: false, error: 'the archive holds no project' };

        const dest = installedExampleDir(name, storeDir);
        rmSync(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        renameSync(unpacked, dest);
        return { ok: true, dir: dest };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}
