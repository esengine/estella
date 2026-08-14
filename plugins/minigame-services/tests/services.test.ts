// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the two services promise on top of the host's capability.
 *
 * Both are façades, so the claims are about the small amount they add: telling
 * a menu honestly whether the host can do this at all, and asking for the share
 * card at SHARE time rather than at set time — which is what lets a card carry
 * a live score.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const host = {
  canShare: true,
  canPay: true,
  shared: [] as unknown[],
  passive: null as null | (() => unknown),
  paid: [] as unknown[],
  payRejects: null as null | Error,
};

vi.mock('esengine', () => ({
  defineResource: (value: unknown, name: string) => ({ value, name }),
  platformCanShare: () => host.canShare,
  platformShare: (options: unknown) => {
    host.shared.push(options);
    return host.canShare;
  },
  platformOnShareRequest: (provide: () => unknown) => {
    host.passive = provide;
    return true;
  },
  platformCanPay: () => host.canPay,
  platformRequestPayment: (request: unknown) => {
    host.paid.push(request);
    return host.payRejects ? Promise.reject(host.payRejects) : Promise.resolve();
  },
}));

const { ShareAPI } = await import('../src/share');
const { PaymentAPI } = await import('../src/payment');

beforeEach(() => {
  host.canShare = true;
  host.canPay = true;
  host.shared = [];
  host.passive = null;
  host.paid = [];
  host.payRejects = null;
});

describe('the share sheet', () => {
  it('says whether the host has one, so a button can hide instead of failing', () => {
    expect(new ShareAPI().available).toBe(true);
    host.canShare = false;
    expect(new ShareAPI().available).toBe(false);
  });

  it('shares the default card when given none', () => {
    const share = new ShareAPI();
    share.setShareCard({ title: 'Beat my score' });
    share.share();
    expect(host.shared).toEqual([{ title: 'Beat my score' }]);
  });

  it('asks a function card at SHARE time, so it can carry live state', () => {
    let score = 0;
    const share = new ShareAPI();
    share.setShareCard(() => ({ title: `Score ${score}` }));
    score = 42;
    share.share();
    expect(host.shared).toEqual([{ title: 'Score 42' }]);
  });

  it('answers the host s own menu from the same card', () => {
    // The passive surface: the host asks, the game did not call anything.
    let score = 0;
    const share = new ShareAPI();
    share.setShareCard(() => ({ title: `Score ${score}` }));
    score = 7;
    expect(host.passive?.()).toEqual({ title: 'Score 7' });
  });

  it('registers with the host once, not on every card change', () => {
    const share = new ShareAPI();
    share.setShareCard({ title: 'a' });
    const first = host.passive;
    share.setShareCard({ title: 'b' });
    expect(host.passive).toBe(first);
    expect(host.passive?.()).toEqual({ title: 'b' });
  });
});

describe('in-game purchase', () => {
  it('answers for the DEVICE, so a shop stays closed rather than opening and failing', () => {
    expect(new PaymentAPI().available).toBe(true);
    host.canPay = false;
    expect(new PaymentAPI().available).toBe(false);
  });

  it('passes the request to the host untouched', async () => {
    await new PaymentAPI().request({ quantity: 3 } as never);
    expect(host.paid).toEqual([{ quantity: 3 }]);
  });

  it('rejects with the HOST s code, which it does not translate', async () => {
    // Vendors number their failures differently, and a mapping invented here is
    // a guess the game would then branch on.
    host.payRejects = Object.assign(new Error('user cancelled'), { code: 1001 });
    await expect(new PaymentAPI().request({ quantity: 1 } as never))
      .rejects.toMatchObject({ message: 'user cancelled', code: 1001 });
  });
});
