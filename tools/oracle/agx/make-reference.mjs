// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  make-reference.mjs — ask Blender what its AgX view transform shows for the patches, and write reference.json beside this file.
 *
 *   node tools/oracle/agx/make-reference.mjs [look]     (look: None, or one of Blender's AgX looks, e.g. "AgX - Medium High Contrast")
 *
 * Needs Blender (BLENDER, or the default install path). The result is data in the repository, so the oracle scenes run without it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL } from './patches.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const blender = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const look = process.argv[2] ?? 'None';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'agx-'));
const input = path.join(tmp, 'patches.json'), output = path.join(tmp, 'out.json');
writeFileSync(input, JSON.stringify(ALL));
const run = spawnSync(blender, ['--background', '--python', path.join(here, 'blender_agx.py'), '--', input, output, look], { encoding: 'utf8' });
if (run.status !== 0 || !run.stdout.includes('AGX_DONE')) { console.error(run.stdout, run.stderr); process.exit(1); }
const result = JSON.parse(readFileSync(output, 'utf8'));
const version = /Blender (\d+\.\d+[^\s]*)/.exec(run.stdout)?.[1] ?? 'unknown';
const file = path.join(here, look === 'None' ? 'reference.json' : `reference-${look.replace(/[^A-Za-z0-9]+/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ source: `Blender ${version}, Workbench flat colour, view transform AgX, look ${look}, display sRGB, 8-bit`, patches: result.patches, codes: result.codes }, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}: ${result.codes.length} patches`);
