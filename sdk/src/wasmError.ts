import { log } from './logger';

type WasmErrorHandler = (error: unknown, context: string) => void;

let errorHandler: WasmErrorHandler | null = null;
let lastReportTime = 0;
let suppressedCount = 0;

const THROTTLE_MS = 1000;

export function setWasmErrorHandler(handler: WasmErrorHandler | null): void {
    errorHandler = handler;
}

export function handleWasmError(error: unknown, context: string): void {
    const now = Date.now();
    if (now - lastReportTime < THROTTLE_MS) {
        suppressedCount++;
        return;
    }

    if (suppressedCount > 0) {
        log.warn('wasm', `${suppressedCount} WASM error(s) suppressed`);
        suppressedCount = 0;
    }

    lastReportTime = now;
    log.error('wasm', `error in ${context}`, error);
    if (errorHandler) {
        errorHandler(error, context);
    }
}
