// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { log } from './logger';
import { getDefaultContext, type WasmErrorHandler } from './context';
import { WasmModuleAborted } from './moduleHealth';

const THROTTLE_MS = 1000;

export function setWasmErrorHandler(handler: WasmErrorHandler | null): void {
    getDefaultContext().wasmError.handler = handler;
}

export function handleWasmError(error: unknown, context: string): void {
    // A module abort is terminal and unrecoverable — never swallow it into a
    // default value. Rethrow so it propagates out of every catch-and-continue
    // site (the module is dead; continuing would call into a corpse).
    if (error instanceof WasmModuleAborted) {
        throw error;
    }

    const state = getDefaultContext().wasmError;
    const now = Date.now();
    if (now - state.lastReportTime < THROTTLE_MS) {
        state.suppressedCount++;
        return;
    }

    if (state.suppressedCount > 0) {
        log.warn('wasm', `${state.suppressedCount} WASM error(s) suppressed`);
        state.suppressedCount = 0;
    }

    state.lastReportTime = now;
    log.error('wasm', `error in ${context}`, error);
    if (state.handler) {
        state.handler(error, context);
    }
}
