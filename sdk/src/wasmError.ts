import { log } from './logger';
import { getDefaultContext, type WasmErrorHandler } from './context';

const THROTTLE_MS = 1000;

export function setWasmErrorHandler(handler: WasmErrorHandler | null): void {
    getDefaultContext().wasmError.handler = handler;
}

export function handleWasmError(error: unknown, context: string): void {
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
