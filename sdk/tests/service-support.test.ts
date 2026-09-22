// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// Here rather than beside the table it checks: the subject is the adapter and
// the profile a build installs, and reaching them from the pipeline drags the
// whole platform layer into the pipeline's type program.
import { describe, it, expect } from 'vitest';
import { builtinServiceSupport, type GameService } from '../../pipeline/src/project/serviceSupport';
import { douyinProfile } from '../src/platform/douyin/profile';
import { webAdapter } from '../src/platform/web';
import type { PlatformAdapter } from '../src/platform/types';

const supportOf = (platform: string, service: GameService): string | undefined =>
    builtinServiceSupport(platform).find((s) => s.service === service)?.support;

describe('what the build dialog promises matches what will be installed', () => {
    it('reports purchase on Douyin exactly as the profile decides it', () => {
        // The family's payment is WeChat's call with WeChat's rules, so a vendor
        // that has not filled `pay` sells nothing — fill it and this goes red,
        // which is the point: the dialog would still be saying "no".
        expect(douyinProfile.pay === undefined).toBe(supportOf('douyin', 'purchase') === 'no');
        expect(supportOf('douyin', 'purchase')).toBe('no');
    });

    it('says no host above the game wherever the adapter declares no such method', () => {
        // Read through `PlatformAdapter`, where these are DECLARED optional:
        // asking the concrete class is a question the compiler answers for us,
        // and the names would stop being the interface's.
        const adapter: PlatformAdapter = webAdapter;
        const declared: Record<GameService | string, boolean> = {
            ads: adapter.createRewardedAd !== undefined,
            share: adapter.share !== undefined,
            signIn: adapter.login !== undefined,
            purchase: adapter.requestPayment !== undefined,
        };
        for (const [service, present] of Object.entries(declared)) {
            expect(present, `the web adapter declares ${service}`).toBe(false);
            expect(supportOf('web', service as GameService)).toBe('no');
        }
    });
});
