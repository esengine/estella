// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    globalSetup.ts — a compiler has to be REACHABLE before a run claims
 *          to have compared the emitted C against the interpreter.
 *
 * @details The prerequisite belongs to one place, not to each `skipIf` that
 *          needs it: proved once here, a skip inside means what it says. Two of
 *          them: the differentials compile C for this machine, and the wasm
 *          suite compiles a module for the engine's own.
 */
import { proveHostCC } from '../src/hostCC';
import { proveEmcc } from '../../build-tools/utils/emscripten.js';

export default async function setup(): Promise<void> {
    proveHostCC('compiler-tests');
    proveEmcc('compiler-tests');
}
