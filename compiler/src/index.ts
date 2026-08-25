// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Estella AOT compiler — public surface (docs/REARCH_AOT.md Stages 1-2).
 */
export * from './eir';
export { brokenPromises, lowerProgram, type Diagnostic, type LowerResult } from './frontend';
export { verifySystem, type VerifyError } from './verify';
export { runSystem, type EirWorld, type Fns, type Row } from './interp';
export { inlineModule, inlineSystem } from './inline';
export {
    AbiMemory, abiHash, abiHost, flushCommands, materialize, packLayout, planFor, runOnAbi,
    CMD_DESPAWN, CMD_REMOVE, CMD_WORDS, QUERYROWS_WORDS, SYSCTX_WORDS,
    type AbiCall, type AbiLayout, type FieldOffsets, type Leaf, type SysPlan,
} from './abi';
export { CFLAGS, RUNTIME_H, cSymbol, emitC, type CModule } from './codegen';
export { builtinShapes } from './builtins';
