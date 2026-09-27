// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A project file's settings that nothing reads are named, not dropped.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ignoredManifestKeys } from '../src/project/format';

const ROOT = path.resolve(__dirname, '../..');

describe('keys a project file carries that nothing reads', () => {
    it('names a features block written beside features instead of in it', () => {
        expect(ignoredManifestKeys({
            name: 'Bistro', formatVersion: '1',
            rendering: { colorSpace: 'linear', outputTransform: 'aces' },
        })).toEqual([{ key: 'rendering', under: 'features' }]);
    });

    it('names a misspelt key', () => {
        expect(ignoredManifestKeys({ name: 'x', desginResolution: { width: 1, height: 1 } }))
            .toEqual([{ key: 'desginResolution' }]);
    });

    it('finds nothing in any project the repository ships', () => {
        const found: Record<string, unknown> = {};
        for (const dir of ['examples', 'templates']) {
            for (const name of readdirSync(path.join(ROOT, dir))) {
                const file = path.join(ROOT, dir, name, 'project.esproject');
                if (!existsSync(file)) continue;
                const ignored = ignoredManifestKeys(JSON.parse(readFileSync(file, 'utf8')));
                if (ignored.length > 0) found[`${dir}/${name}`] = ignored;
            }
        }
        expect(found).toEqual({});
    });
});
