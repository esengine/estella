// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nativeChannel.ts
 * @brief   Call the app's own native code by name, and hear what it raises.
 *
 * A packaged Android or iOS game is an ordinary app: it can link an ad SDK, a
 * store, a sign-in or an analytics library, and that code is Java, Kotlin,
 * Objective-C or Swift. This is how a script reaches it. The native side answers
 * a method name (`NativeChannel.register` in Java, `EstellaNativeChannel` in
 * Objective-C); the script calls the name:
 *
 * ```ts
 * if (NativeChannel.has('store.buy')) {
 *     const receipt = await NativeChannel.call<{ token: string }>('store.buy', { sku: 'gems_100' });
 * }
 * const off = NativeChannel.on<{ sku: string }>('store.restored', (p) => grant(p.sku));
 * ```
 *
 * Arguments, results and event data are anything JSON carries.
 *
 * Elsewhere (the web, a mini-game, the editor's play mode) there is no native
 * code to reach: `available` is false, `has` answers false, `call` rejects
 * naming the method, and `on` never fires. A game that asks `has` first runs
 * unchanged on every platform.
 */
import { platformNativeChannel } from '../platform';

/** @public */
export interface NativeChannelApi {
    /** Whether this platform has native code to reach at all. */
    readonly available: boolean;
    /** Whether a call to `method` would be answered. Cheap; ask before offering a feature. */
    has(method: string): boolean;
    /**
     * Call `method` in the app's native code. Resolves with what it answered;
     * rejects when nothing answers to the name, or with the reason the native
     * side gave. `args` is anything JSON carries.
     */
    call<T = unknown>(method: string, args?: unknown): Promise<T>;
    /** Hear every `event` the native side raises from now on. Returns the unsubscribe. */
    on<T = unknown>(event: string, handler: (data: T) => void): () => void;
}

/** @public */
export const NativeChannel: NativeChannelApi = {
    get available(): boolean {
        return platformNativeChannel() !== null;
    },
    has(method: string): boolean {
        return platformNativeChannel()?.has(method) ?? false;
    },
    call<T = unknown>(method: string, args?: unknown): Promise<T> {
        const channel = platformNativeChannel();
        if (!channel) {
            return Promise.reject(new Error(`native "${method}": this platform has no native code to call (check NativeChannel.has first)`));
        }
        return channel.call(method, args) as Promise<T>;
    },
    on<T = unknown>(event: string, handler: (data: T) => void): () => void {
        return platformNativeChannel()?.on(event, handler as (data: unknown) => void) ?? (() => {});
    },
};
