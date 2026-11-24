// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aotArtifacts.ts
 * @brief   Names of generated system modules and their build manifest.
 */
import { nativeModuleExt } from '../../../compiler/src/hostCC';

/** The compiled systems, as a module importing the engine's memory. */
export const AOT_WASM = 'systems.wasm';
/** The same systems linked for the threaded Web engine's shared memory. */
export const AOT_SHARED_WASM = 'systems-shared.wasm';
/** How to call them: symbols, query order, and what the module baked in. */
export const AOT_MANIFEST = 'systems.json';

/** Filename of a desktop system library for the selected OS. */
export const nativeAotModule = (platform?: string): string => `systems${nativeModuleExt(platform)}`;
