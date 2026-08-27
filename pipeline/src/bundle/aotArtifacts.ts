// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aotArtifacts.ts
 * @brief   What the AOT step's two files are called where it writes them.
 *
 * @details These are BUILD names, not a wire: a package carries the module at
 *          the path `game.config.json` records and the manifest inlined beside
 *          it, so the host never fetches either by name. It said otherwise for
 *          two releases, and the one checker that believed it looked for
 *          `systems.json` in a package that has not carried one since.
 */

/** The compiled systems, as a module importing the engine's memory. */
export const AOT_WASM = 'systems.wasm';
/** How to call them: symbols, query order, and what the module baked in. */
export const AOT_MANIFEST = 'systems.json';
