// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * The Draco glTF decoder ships no types. Only the factory is named here; what it
 * returns is described where it is used (gltfImport.ts), so the shape and the
 * calls that rely on it stay in one place.
 */
declare module 'draco3dgltf' {
  export function createDecoderModule(): Promise<unknown>;
  export function createEncoderModule(): Promise<unknown>;
}
