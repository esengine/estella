// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    profile.ts
 * @brief   Douyin as a profile of the mini-game platform family.
 *
 * Three facts and no override: fs, fetch, canvas, image, input, storage,
 * subpackages, audio, video and sockets are the family's, written once in
 * ../minigame/ against the normalized host global, and `tt` answers the same
 * shape `wx` does.
 *
 * UNVERIFIED on a device: that Douyin instantiates wasm through the standard
 * `WebAssembly.instantiate` the family falls back to, rather than a host call of
 * its own the way WeChat's WXWebAssembly does. If it does not, this profile
 * gains an `instantiateWasm` exactly as WeChat's has one. RM-032's acceptance is
 * a real device for that reason.
 */
import type { MiniGameGlobal, MiniGameProfile } from '../minigame';

/** Douyin's host global. Ambient at runtime and absent while bundling, so it is
 *  read lazily — importing this module outside Douyin must not touch it. */
declare const tt: unknown;

export const douyinProfile: MiniGameProfile = {
    id: 'douyin',
    hostLabel: '抖音',

    get global(): MiniGameGlobal {
        return tt as MiniGameGlobal;
    },
};
