// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Alipay's `my`, as the family reads it. The profile renames rather than
 *        forks: each claim is that a family call reaches the Alipay call its docs
 *        name, with the argument shape that call takes, and is absent where the
 *        host lacks it — which is how the family decides a capability exists.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { alipayProfile } from '../src/platform/alipay/profile';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';

const host: Record<string, unknown> = {
  createRewardedAd: vi.fn(() => ({ tag: 'rewarded' })),
  getAuthCode: vi.fn((o: { scopes: string[]; success: (r: { authCode: string }) => void }) => o.success({ authCode: 'AUTH-123' })),
  showSharePanel: vi.fn((o: { complete?: () => void }) => { host.panelSaw = (host.onShareAppMessage as () => unknown)(); o.complete?.(); }),
  getSystemInfoSync: () => ({ platform: 'android' }),
};

beforeAll(() => { (globalThis as { my?: unknown }).my = host; });

describe('Alipay, in the family\'s words', () => {
  it('reaches a rewarded unit through createRewardedAd', () => {
    const g = alipayProfile.global as unknown as { createRewardedVideoAd(o: unknown): unknown };
    expect(g.createRewardedVideoAd({ adUnitId: 'unit' })).toEqual({ tag: 'rewarded' });
    expect(host.createRewardedAd).toHaveBeenCalledWith({ adUnitId: 'unit' });
  });

  it('signs in through getAuthCode and hands over its authCode as the code', async () => {
    const adapter = new MiniGamePlatformAdapter(alipayProfile);
    expect(adapter.canSignIn()).toBe(true);
    await expect(adapter.login()).resolves.toBe('AUTH-123');
    expect(host.getAuthCode).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['auth_base'] }));
  });

  it('shares by setting the card the host reads when its panel opens, and answers the passive menu', () => {
    const adapter = new MiniGamePlatformAdapter(alipayProfile);
    adapter.onShareRequest(() => ({ title: 'passive' }));
    adapter.share({ title: 'my run', query: 'from=share' });
    expect(host.panelSaw).toEqual({ title: 'my run', query: 'from=share' });
    // Once the panel closes, the host's own menu shares the passive card again.
    expect((host.onShareAppMessage as () => unknown)()).toEqual({ title: 'passive' });
  });

  it('offers nothing the host lacks, so the family reports it absent', () => {
    const g = alipayProfile.global as unknown as Record<string, unknown>;
    expect(g.createInterstitialAd).toBeUndefined();
    expect(g.requestMidasPayment).toBeUndefined();
    expect(new MiniGamePlatformAdapter(alipayProfile).canPay()).toBe(false);
  });

  it('instantiates through MYWebAssembly with an absolute package path, and says what is missing', async () => {
    await expect(alipayProfile.instantiateWasm!('wasm/esengine.wxgame.wasm', {})).rejects.toThrow('MYWebAssembly is not available');
    const instantiate = vi.fn(async () => ({ instance: { exports: {} }, module: {} }));
    (globalThis as { MYWebAssembly?: unknown }).MYWebAssembly = { instantiate };
    await alipayProfile.instantiateWasm!('wasm/esengine.wxgame.wasm', {});
    expect(instantiate).toHaveBeenCalledWith('/wasm/esengine.wxgame.wasm', {});
    delete (globalThis as { MYWebAssembly?: unknown }).MYWebAssembly;
  });
});
