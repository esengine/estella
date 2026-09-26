// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which CDN root a package's hot-update config carries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packagedHotUpdate } from '../src/export/hotUpdateConfig';

let legacy: string;
beforeAll(() => {
    legacy = mkdtempSync(path.join(tmpdir(), 'hot-update-'));
    mkdirSync(path.join(legacy, '.esengine'));
    writeFileSync(path.join(legacy, '.esengine', 'asset-groups.json'), JSON.stringify({
        version: '1.0', activeProfile: 'prod', profiles: { prod: { remoteRoot: 'https://old.example.com/game/' } },
    }));
});
afterAll(() => rmSync(legacy, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('the CDN root a package carries', () => {
    it('is the one the project or its profile names', async () => {
        expect(await packagedHotUpdate(legacy, { remoteRoot: 'https://cdn.example.com/game' }))
            .toEqual({ remoteRoot: 'https://cdn.example.com/game', persistUpdateKey: 'esengine:hotupdate' });
    });

    it('is none when the project says same-origin, even where an older profile named one', async () => {
        expect(await packagedHotUpdate(legacy, { remoteRoot: '' })).toBeUndefined();
    });

    it('falls back to the older asset-groups profile for a project that names none', async () => {
        expect((await packagedHotUpdate(legacy))?.remoteRoot).toBe('https://old.example.com/game');
    });
});
