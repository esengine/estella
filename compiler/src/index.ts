// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Estella AOT compiler — public surface (docs/REARCH_AOT.md Stage 1).
 */
export * from './eir';
export { lowerProgram, type Diagnostic, type LowerResult } from './frontend';
export { verifySystem, type VerifyError } from './verify';
export { runSystem, type EirWorld, type Fns, type Row } from './interp';
export { inlineModule, inlineSystem } from './inline';
export { builtinShapes } from './builtins';
