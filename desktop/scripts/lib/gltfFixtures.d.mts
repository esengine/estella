// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** One triangle as a `.gltf`, its bytes stored plainly. */
export function plainTriangle(): Uint8Array;

/** The same triangle with every bufferView meshopt-compressed. */
export function meshoptTriangle(): Promise<Uint8Array>;

/** The same triangle with its geometry in a Draco blob. */
export function dracoTriangle(): Promise<Uint8Array>;
