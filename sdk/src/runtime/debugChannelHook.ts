// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  debugChannelHook.ts — where the runtime starts a development build's
 *        channel, without carrying it: a shipping package never opens one, so
 *        the channel arrives only with `esengine/debug-channel`.
 */
import type { App } from '../app/app';
import { log } from '../util/logger';
import type { DebugChannelConfig } from './debugChannelProtocol';

export interface DebugChannelImpl {
    start(config: DebugChannelConfig): void;
    attach(app: App): void;
}

let impl: DebugChannelImpl | null = null;

/** @internal Installed by `esengine/debug-channel`. */
export function setDebugChannelImpl(next: DebugChannelImpl): void {
    impl = next;
}

/** Open this build's line to the editor, from a host as soon as it has read its
 *  config: what it prints while the engine boots is then heard too. */
export function startDebugChannel(config: DebugChannelConfig): void {
    if (!impl) {
        log.warn('debug', 'this build names an editor to connect to but was packaged without esengine/debug-channel');
        return;
    }
    impl.start(config);
}

/** @internal Give the channel the running game, once there is one. */
export function attachDebugChannel(app: App): void {
    impl?.attach(app);
}
