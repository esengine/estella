#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, zipTree } from '../build-tools/utils/zip.js';
import {
    REMOTE_EXAMPLES, EXAMPLE_INDEX_KIND, EXAMPLE_INDEX_FORMAT, EXAMPLES_INDEX, exampleArchiveName, exampleArchiveKept,
} from '../build-tools/utils/remoteExamples.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const out = path.resolve(outIdx >= 0 ? process.argv[outIdx + 1] : 'build/examples');
mkdirSync(out, { recursive: true });

const examples = [];
for (const name of REMOTE_EXAMPLES) {
    const dir = path.join(root, 'examples', name);
    if (!existsSync(path.join(dir, 'project.esproject'))) throw new Error(`pack-examples: examples/${name} is not a project`);
    const zip = makeZip(zipTree(dir, '', exampleArchiveKept));
    const sha256 = createHash('sha256').update(zip).digest('hex');
    const file = exampleArchiveName(name, sha256);
    writeFileSync(path.join(out, file), zip);
    examples.push({ name, file, sha256, bytes: zip.length });
    console.log(`${name}: ${(zip.length / 1048576).toFixed(1)} MB  ${file}`);
}
writeFileSync(path.join(out, EXAMPLES_INDEX), `${JSON.stringify({ kind: EXAMPLE_INDEX_KIND, formatVersion: EXAMPLE_INDEX_FORMAT, examples }, null, 2)}\n`);
