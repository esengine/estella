// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { META_EXT } from './contentPolicy';

export async function readImportJson(file: string): Promise<Record<string, unknown> | null> {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Publish generated metadata as a whole, preserving the UUID and any authored settings. An identical import leaves the sidecar alone. */
export async function setImportMeta(absFile: string, patch: (meta: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const sidecar = absFile + META_EXT, before = await readImportJson(sidecar);
    if (!before) throw new Error('Missing asset sidecar: ' + sidecar);
    const after = patch(before);
    if (isDeepStrictEqual(before, after)) return;
    const temp = path.join(path.dirname(sidecar), '.' + path.basename(sidecar) + '.' + randomUUID() + '.tmp');
    try {
        await writeFile(temp, JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
        await rename(temp, sidecar);
    } finally { await rm(temp, { force: true }); }
}
