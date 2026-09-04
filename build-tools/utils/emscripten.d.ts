// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Types for the part of emscripten.js a TypeScript gate consumes.

/** The `emcc` to run, or null where no activated emsdk was found. */
export function emccPath(): string | null;

export const NO_EMCC: string;
export function proveEmcc(suite: string): void;
