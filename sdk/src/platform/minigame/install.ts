// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    install.ts
 * @brief   Bring up a mini-game platform from a profile: the boot polyfills the
 *          family needs, then the adapter.
 *
 *          This is the whole cost of a vendor the engine does not ship. A host
 *          whose global matches {@link MiniGameProfile.global} and that uses
 *          standard `WebAssembly` needs no code at all beyond the profile
 *          literal — WeChat's own binding (../wechat/index.ts) is this call plus
 *          its WXWebAssembly polyfill.
 */
import { setPlatform } from '../base';
import { MiniGamePlatformAdapter } from './adapter';
import { polyfillFetch } from './fetch';
import { polyfillPerformance, polyfillTextEncoder } from './polyfills';
import type { MiniGameProfile } from './api';
import { log } from '../../logger';

let installed: string | null = null;

/**
 * Install `profile`'s platform as the process-wide one and return its adapter.
 *
 * `adapter` lets a vendor that already built one (to export it by name) install
 * THAT instance — the adapter holds per-host state (the filesystem manager, the
 * input bindings), so a second instance would split it.
 *
 * Polyfills are applied once per vendor: a game that boots twice (a devtools
 * reload) does not re-polyfill, but re-installs the platform.
 */
export function installMiniGamePlatform(
    profile: MiniGameProfile,
    adapter: MiniGamePlatformAdapter = new MiniGamePlatformAdapter(profile),
): MiniGamePlatformAdapter {
    if (installed === profile.id) {
        setPlatform(adapter);
        return adapter;
    }
    installed = profile.id;

    // Mini-game hosts have no `performance`, no `fetch` and (on some vendors) no
    // TextEncoder. The engine and emscripten glue expect all three.
    polyfillPerformance();
    polyfillFetch(profile.global);
    polyfillTextEncoder();

    setPlatform(adapter);
    log.info(profile.id, `${profile.hostLabel} platform initialized`);
    return adapter;
}
