// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A `yes` in the build dialog names members the vendor's own typings declare.
 * The other half — that the table matches the adapter and profile a build will
 * install — is in `sdk/tests/service-support.test.ts`, beside its subject.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BUILTIN_PLATFORMS } from '../src/project/platforms';
import { GAME_SERVICES, builtinServiceSupport } from '../src/project/serviceSupport';

/** WeChat's own published API declaration, as depended on by the SDK. */
const wechatTypings = (): string => {
    const require_ = createRequire(import.meta.url);
    return readFileSync(require_.resolve('minigame-api-typings/types/wx/lib.wx.api.d.ts'), 'utf8');
};

describe('service support', () => {
    it('answers for every service on every built-in target', () => {
        for (const platform of BUILTIN_PLATFORMS) {
            const rows = builtinServiceSupport(platform);
            expect(rows.map((r) => r.service).sort()).toEqual([...GAME_SERVICES].sort());
            for (const row of rows) expect(row.note.length).toBeGreaterThan(20);
        }
    });

    it('leaves a project-authored platform to its own profile', () => {
        expect(builtinServiceSupport('acme-tv')).toEqual([]);
    });

    it('claims yes only for members WeChat itself declares', () => {
        const typings = wechatTypings();
        let checked = 0;
        for (const platform of BUILTIN_PLATFORMS) {
            for (const row of builtinServiceSupport(platform)) {
                if (row.support !== 'yes') continue;
                const members = [...row.note.matchAll(/\bwx\.(\w+)/g)].map((m) => m[1]);
                expect(members.length, `${platform}/${row.service} claims yes and cites nobody`)
                    .toBeGreaterThan(0);
                for (const member of members) {
                    expect(typings.includes(`${member}(`), `wx.${member} is not in minigame-api-typings`)
                        .toBe(true);
                    checked++;
                }
            }
        }
        // The scan must have had something to scan: a matcher that found no rows
        // at all would pass every assertion above and check nothing.
        expect(checked).toBeGreaterThanOrEqual(4);
    });
});
