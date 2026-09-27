// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @see fbxFixtures.mjs */

/** A red-tinted triangle under a moved node, sampling an image beside the file;
 *  `specular` adds a second image as its specular map. */
export declare function texturedTriangle(options?: { specular?: string }): Uint8Array;

/** Two bones and a quad bound to them, the upper bone turning 90° about Z. */
export declare function skinnedBar(): Uint8Array;

/** A quad with two blend shapes — one slides its top edge, one lifts it — the
 *  first left at 40% by the file. */
export declare function morphedQuad(): Uint8Array;
