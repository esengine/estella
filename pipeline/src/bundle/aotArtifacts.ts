// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aotArtifacts.ts
 * @brief   What the AOT step's two files are called, for both ends of the wire.
 *
 * @details The export writes them and the game host fetches them, and a name
 *          written twice fails in the worst way available: the fetch 404s, no
 *          twin is installed, and the game runs the interpreter at full speed
 *          with nothing to say. NO IMPORTS — the host bundles this.
 */

/** The compiled systems, as a module importing the engine's memory. */
export const AOT_WASM = 'systems.wasm';
/** How to call them: symbols, query order, and what the module baked in. */
export const AOT_MANIFEST = 'systems.json';
