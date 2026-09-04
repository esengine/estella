// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    globalSetup.ts — the native AOT build is compiled here, so the
 *          machine has to have a compiler before the run claims it built one.
 *
 * @details Same owner as the compiler suite's prerequisite: a capability proved
 *          in one place, so the `skipIf`s below it mean what they say.
 */
import { proveHostCC } from '../../compiler/src/hostCC';
import { proveEmcc } from '../../build-tools/utils/emscripten.js';

export default async function setup(): Promise<void> {
    proveHostCC('pipeline-tests');
    proveEmcc('pipeline-tests');
}
