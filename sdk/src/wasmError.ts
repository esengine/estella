type WasmErrorHandler = (error: unknown, context: string) => void;

let errorHandler: WasmErrorHandler | null = null;

export function setWasmErrorHandler(handler: WasmErrorHandler | null): void {
    errorHandler = handler;
}

export function handleWasmError(error: unknown, context: string): void {
    console.error(`[ESEngine] WASM error in ${context}:`, error);
    if (errorHandler) {
        errorHandler(error, context);
    }
}
