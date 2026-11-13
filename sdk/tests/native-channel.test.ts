// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The channel to an app's own native code, from the host's two entry
 *        points up to what a game calls. The host carries a name and JSON; these
 *        hold what the SDK makes of that: a call that is answered, one that is
 *        refused, one that fails, an event, and ads as the first thing said over it.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createHostBridge, NativePlatformAdapter, NATIVE_ADS_PRELOAD, NATIVE_ADS_SHOW } from '../src/platform/native';
import type { NativeBridge } from '../src/platform/native';
import { platformCanCreateAds, platformNativeChannel, setPlatform } from '../src/platform';
import { NativeChannel } from '../src/services';

type Push = { kind: 'reply'; id: number; ok: boolean; payload: string } | { kind: 'event'; name: string; payload: string };

/** A host whose native side answers the methods given, each with JSON or by throwing a reason. */
function host(handlers: Record<string, (args: unknown) => unknown> = {}) {
    const calls: Array<{ id: number; method: string; args: string }> = [];
    const scope: Record<string, unknown> = {
        console: { log: () => {}, error: () => {}, warn: () => {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        performance: { now: () => 0 },
        TextDecoder,
        es_readAsset: () => new ArrayBuffer(4),
        es_loadImagePixels: () => ({ width: 1, height: 1, pixels: new ArrayBuffer(4) }),
        es_native_has: (method: string) => method in handlers,
        es_native_call: (id: number, method: string, args: string) => {
            if (!(method in handlers)) return false;
            calls.push({ id, method, args });
            return true;
        },
    };
    const bridge = createHostBridge(scope);
    const push = (message: Push): void => (scope.es_onNativeMessage as (m: Push) => void)(message);
    /** Answer every call made so far, the way the frame loop drains a queue. */
    const drain = (): void => {
        for (const call of calls.splice(0)) {
            try {
                const result = handlers[call.method]!(JSON.parse(call.args));
                push({ kind: 'reply', id: call.id, ok: true, payload: result === undefined ? 'null' : JSON.stringify(result) });
            } catch (error) {
                push({ kind: 'reply', id: call.id, ok: false, payload: (error as Error).message });
            }
        }
    };
    return { scope, bridge, calls, push, drain };
}

afterEach(() => {
    setPlatform(null as never);
});

describe('the host side of the channel', () => {
    it('is absent on a host that bound neither entry point', () => {
        const scope: Record<string, unknown> = {
            console: { log: () => {}, error: () => {}, warn: () => {} }, setTimeout: () => 0, clearTimeout: () => {},
            performance: { now: () => 0 }, TextDecoder,
            es_readAsset: () => new ArrayBuffer(4),
            es_loadImagePixels: () => ({ width: 1, height: 1, pixels: new ArrayBuffer(4) }),
        };
        expect(createHostBridge(scope).channel).toBeUndefined();
        expect(new NativePlatformAdapter(createHostBridge(scope)).nativeChannel()).toBeNull();
    });

    it('resolves a call with what the native side answered', async () => {
        const h = host({ 'store.buy': (args) => ({ bought: (args as { sku: string }).sku }) });
        const answer = h.bridge.channel!.call('store.buy', '{"sku":"gems"}');
        expect(h.calls).toEqual([{ id: 1, method: 'store.buy', args: '{"sku":"gems"}' }]);
        h.drain();
        await expect(answer).resolves.toBe('{"bought":"gems"}');
    });

    it('rejects at once when nothing answers to the name', async () => {
        const h = host();
        await expect(h.bridge.channel!.call('nobody.home', 'null')).rejects.toThrow(/nobody\.home.*nothing in this app answers/);
        expect(h.calls).toEqual([]);
    });

    it('rejects with the reason the native side gave, naming the call', async () => {
        const h = host({ 'store.buy': () => { throw new Error('user cancelled'); } });
        const answer = h.bridge.channel!.call('store.buy', 'null');
        h.drain();
        await expect(answer).rejects.toThrow('native "store.buy" failed: user cancelled');
    });

    it('answers concurrent calls each with its own reply, in any order', async () => {
        const h = host({ echo: (args) => args });
        const first = h.bridge.channel!.call('echo', '1');
        const second = h.bridge.channel!.call('echo', '2');
        const [a, b] = h.calls.splice(0);
        h.push({ kind: 'reply', id: b!.id, ok: true, payload: 'two' });
        h.push({ kind: 'reply', id: a!.id, ok: true, payload: 'one' });
        await expect(first).resolves.toBe('one');
        await expect(second).resolves.toBe('two');
    });

    it('ignores a second answer to a call, and an answer to no call', async () => {
        const h = host({ echo: (args) => args });
        const answer = h.bridge.channel!.call('echo', '1');
        h.push({ kind: 'reply', id: 1, ok: true, payload: 'first' });
        expect(() => h.push({ kind: 'reply', id: 1, ok: false, payload: 'again' })).not.toThrow();
        expect(() => h.push({ kind: 'reply', id: 99, ok: true, payload: 'stray' })).not.toThrow();
        await expect(answer).resolves.toBe('first');
    });
});

describe('NativeChannel', () => {
    it('is unavailable where there is no native code, and says so in the rejection', async () => {
        expect(NativeChannel.available).toBe(false);
        expect(NativeChannel.has('ads.show')).toBe(false);
        await expect(NativeChannel.call('ads.show')).rejects.toThrow(/ads\.show.*no native code/);
        expect(() => NativeChannel.on('anything', () => {})()).not.toThrow();
    });

    it('carries values, not text', async () => {
        const h = host({ sum: (args) => ({ total: (args as number[]).reduce((a, b) => a + b, 0) }), nothing: () => undefined });
        setPlatform(new NativePlatformAdapter(h.bridge));
        expect(NativeChannel.available).toBe(true);
        expect(NativeChannel.has('sum')).toBe(true);
        expect(NativeChannel.has('difference')).toBe(false);
        const total = NativeChannel.call<{ total: number }>('sum', [1, 2, 3]);
        const nothing = NativeChannel.call('nothing');
        expect(h.calls.map((c) => c.args)).toEqual(['[1,2,3]', 'null']);
        h.drain();
        await expect(total).resolves.toEqual({ total: 6 });
        await expect(nothing).resolves.toBeNull();
    });

    it('rejects an answer that is not JSON, naming the method', async () => {
        const h = host({ broken: () => 0 });
        setPlatform(new NativePlatformAdapter(h.bridge));
        const answer = NativeChannel.call('broken');
        h.push({ kind: 'reply', id: h.calls[0]!.id, ok: true, payload: '{not json' });
        await expect(answer).rejects.toThrow(/native "broken" answered with something that is not JSON/);
    });

    it('delivers an event to its listeners and to no others, until they leave', () => {
        const h = host();
        setPlatform(new NativePlatformAdapter(h.bridge));
        const restored: unknown[] = [];
        const other: unknown[] = [];
        const off = NativeChannel.on('store.restored', (data) => restored.push(data));
        NativeChannel.on('push.received', (data) => other.push(data));
        h.push({ kind: 'event', name: 'store.restored', payload: '{"sku":"gems"}' });
        expect(restored).toEqual([{ sku: 'gems' }]);
        expect(other).toEqual([]);
        off();
        h.push({ kind: 'event', name: 'store.restored', payload: '{"sku":"again"}' });
        expect(restored).toEqual([{ sku: 'gems' }]);
    });

    it('lets a listener remove itself while it is being told', () => {
        const h = host();
        setPlatform(new NativePlatformAdapter(h.bridge));
        const heard: string[] = [];
        const off = NativeChannel.on('tick', () => { heard.push('once'); off(); });
        NativeChannel.on('tick', () => heard.push('always'));
        h.push({ kind: 'event', name: 'tick', payload: 'null' });
        h.push({ kind: 'event', name: 'tick', payload: 'null' });
        expect(heard).toEqual(['once', 'always', 'always']);
    });
});

describe('ads over the channel', () => {
    it('has no ad source when the app answers for none', () => {
        const h = host({ 'store.buy': () => null });
        const adapter = new NativePlatformAdapter(h.bridge);
        setPlatform(adapter);
        expect(platformNativeChannel()).not.toBeNull();
        expect(adapter.createRewardedAd).toBeUndefined();
        expect(platformCanCreateAds()).toBe(false);
    });

    it('shows a rewarded ad and grants only what the app says was earned', async () => {
        const seen: unknown[] = [];
        let verdict: unknown = { completed: true };
        const h = host({ [NATIVE_ADS_SHOW]: (args) => { seen.push(args); return verdict; } });
        const adapter = new NativePlatformAdapter(h.bridge);
        setPlatform(adapter);
        expect(platformCanCreateAds()).toBe(true);

        const ad = adapter.createRewardedAd!('unit-1')!;
        const earned = ad.show();
        h.drain();
        await expect(earned).resolves.toEqual({ completed: true });
        expect(seen).toEqual([{ kind: 'rewarded', unitId: 'unit-1' }]);

        for (verdict of [{ completed: false }, {}, null, { completed: 'yes' }]) {
            const result = ad.show();
            h.drain();
            await expect(result).resolves.toEqual({ completed: false });
        }
    });

    it('shows an interstitial and resolves when the app says it closed', async () => {
        const seen: unknown[] = [];
        const h = host({ [NATIVE_ADS_SHOW]: (args) => { seen.push(args); return null; } });
        const adapter = new NativePlatformAdapter(h.bridge);
        const shown = adapter.createInterstitialAd!('unit-2')!.show();
        h.drain();
        await expect(shown).resolves.toBeUndefined();
        expect(seen).toEqual([{ kind: 'interstitial', unitId: 'unit-2' }]);
    });

    it('preloads through the app when it answers, and is a no-op when it does not', async () => {
        const loaded: unknown[] = [];
        const withPreload = host({ [NATIVE_ADS_SHOW]: () => null, [NATIVE_ADS_PRELOAD]: (args) => { loaded.push(args); return null; } });
        const warm = new NativePlatformAdapter(withPreload.bridge).createRewardedAd!('unit-3')!.preload();
        withPreload.drain();
        await expect(warm).resolves.toBeUndefined();
        expect(loaded).toEqual([{ kind: 'rewarded', unitId: 'unit-3' }]);

        const without = host({ [NATIVE_ADS_SHOW]: () => null });
        await expect(new NativePlatformAdapter(without.bridge).createRewardedAd!('unit-3')!.preload()).resolves.toBeUndefined();
        expect(without.calls).toEqual([]);
    });

    it('passes a no-fill on as the rejection it is', async () => {
        const h = host({ [NATIVE_ADS_SHOW]: () => { throw new Error('no fill'); } });
        const shown = new NativePlatformAdapter(h.bridge).createRewardedAd!('unit-4')!.show();
        h.drain();
        await expect(shown).rejects.toThrow('native "ads.show" failed: no fill');
    });
});
