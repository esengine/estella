// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import { estellaDataDir } from './nativeTemplate.js';

export const REMOTE_EXAMPLES = ['bistro', 'dusk-fort', 'terrain-water', 'cyber-rooftop'];

export const EXAMPLE_INDEX_KIND = 'estella-examples';
export const EXAMPLE_INDEX_FORMAT = 1;
export const EXAMPLES_PREFIX = 'examples';
export const EXAMPLES_INDEX = 'index.json';

export const REMOTE_EXAMPLE_STUB_FILES = ['project.esproject', 'thumbnail.png'];

export const isRemoteExample = (name) => REMOTE_EXAMPLES.includes(name);

export const exampleArchiveName = (name, sha256) => `${name}-${sha256.slice(0, 12)}.zip`;

export function exampleArchiveKept(name, isDirectory) {
    const parts = name.split('/');
    if (parts.some((p) => p === 'node_modules' || p === '.esengine' || p === 'dist' || p.startsWith('dist-'))) return false;
    return isDirectory || !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name);
}

export function parseExampleIndex(doc) {
    if (doc?.kind !== EXAMPLE_INDEX_KIND || doc.formatVersion !== EXAMPLE_INDEX_FORMAT) return null;
    if (!Array.isArray(doc.examples)) return null;
    const entries = doc.examples.filter((e) => typeof e?.name === 'string' && isRemoteExample(e.name)
        && typeof e.file === 'string' && /^[\w.-]+$/.test(e.file)
        && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)
        && Number.isInteger(e.bytes) && e.bytes > 0);
    return entries.length > 0 ? entries : null;
}

export function exampleBases(mirrors) {
    return mirrors.map((m) => `${m}/${EXAMPLES_PREFIX}`);
}

export function exampleStoreDir() {
    return process.env.ESTELLA_EXAMPLES || path.join(estellaDataDir(), 'examples');
}

export function installedExampleDir(name, storeDir = exampleStoreDir()) {
    return path.join(storeDir, name);
}
