// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playableLoader.ts — inflate the game bundle, then run it.
 *
 * The engine's glue and its wasm travel deflated; the game's own bundle is the
 * largest span in the page and travelled as source, which on a 5MB cap is the
 * difference between fitting and not. It arrives as `__GAME_BUNDLE__` and runs
 * from the same blob script the engine module already needs, so a page that can
 * boot a playable at all can boot this one — no eval, nothing new to allow.
 */
import { inflateRaw } from './inflate';

interface PackedBytes { z: string; n: number }
declare const __GAME_BUNDLE__: PackedBytes;

const packed = atob(__GAME_BUNDLE__.z);
const bytes = new Uint8Array(packed.length);
for (let i = 0; i < packed.length; i++) bytes[i] = packed.charCodeAt(i);

const script = document.createElement('script');
script.src = URL.createObjectURL(new Blob(
  [new TextDecoder().decode(inflateRaw(bytes, __GAME_BUNDLE__.n))],
  { type: 'text/javascript' },
));
document.body.appendChild(script);
