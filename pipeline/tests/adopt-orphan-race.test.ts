// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  adopt-orphan-race.test.ts
 * @brief Adopting a file never replaces the sidecar its creator wrote.
 *
 * A scan that saw a new file before its `.meta` minted one of its own; when the
 * creator's `.meta` landed in between, the scan's overwrote it, and the uuid the
 * creator had handed back referred to nothing on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { adoptOrphan } from '../src/assets/assetMeta';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'es-adopt-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('adopting an orphan', () => {
  it('leaves a sidecar that appeared after it looked', async () => {
    const file = path.join(dir, 'Enemy.esprefab');
    await writeFile(file, '{}');
    const adopting = adoptOrphan(file);
    const creators = JSON.stringify({ uuid: 'c0ffee00-0000-4000-8000-000000000000', version: '2.0', type: 'prefab', importer: {} });
    writeFileSync(`${file}.meta`, creators);
    expect(await adopting).toBe('has-meta');
    expect(await readFile(`${file}.meta`, 'utf8')).toBe(creators);
  });

  it('still mints one for a file that has none', async () => {
    const file = path.join(dir, 'Enemy.esprefab');
    await writeFile(file, '{}');
    expect(await adoptOrphan(file)).toBe('adopted');
    expect(JSON.parse(await readFile(`${file}.meta`, 'utf8')).type).toBe('prefab');
  });
});
