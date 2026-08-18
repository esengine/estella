// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @see reader.mjs */

/**
 * Parse one FBX file into the scene blob defined by tools/ufbx-wasm/bridge.c.
 *
 * @param bytes    the `.fbx`, binary or ASCII
 * @param filename what it is called, so relative texture paths resolve
 */
export declare function readFbxScene(bytes: Uint8Array, filename?: string): Promise<Uint8Array>;
