// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What the build dialog says a target can do has to stay true to the adapter
 * that target will install and to the vendor declaration it cites. Both are in
 * this checkout, so a `yes` names members the vendor's own typings declare, and
 * Douyin's "sells nothing" is read off the profile's empty `pay` slot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BUILTIN_PLATFORMS } from '../src/project/platforms';
import { GAME_SERVICES, builtinServiceSupport, type GameService } from '../src/project/serviceSupport';
import { douyinProfile } from '../../sdk/src/platform/douyin/profile';

const supportOf = (platform: string, service: GameService): string | undefined =>
    builtinServiceSupport(platform).find((s) => s.service === service)?.support;

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

    it('reports purchase on Douyin exactly as the profile decides it', () => {
        // The family's payment is WeChat's call with WeChat's rules, so a vendor
        // that has not filled `pay` sells nothing — fill it and this goes red,
        // which is the point: the dialog would still be saying "no".
        expect(douyinProfile.pay === undefined).toBe(supportOf('douyin', 'purchase') === 'no');
        expect(supportOf('douyin', 'purchase')).toBe('no');
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

    it('says no host above the game wherever the adapter declares no such method', async () => {
        const { webAdapter } = await import('../../sdk/src/platform/web');
        const declared = {
            ads: webAdapter.createRewardedAd !== undefined,
            share: webAdapter.share !== undefined,
            signIn: webAdapter.login !== undefined,
            purchase: webAdapter.requestPayment !== undefined,
        };
        for (const [service, present] of Object.entries(declared)) {
            expect(present, `the web adapter declares ${service}`).toBe(false);
            expect(supportOf('web', service as GameService)).toBe('no');
        }
    });
});
