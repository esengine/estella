import { showErrorToast } from '../ui/Toast';

export type ErrorCategory = 'asset_missing' | 'invalid_schema' | 'wasm_crash' | 'unknown';

export function installGlobalErrorHandler(): void {
  window.addEventListener('error', (event) => {
    handleError(event.error || new Error(event.message));
    event.preventDefault();
  });

  window.addEventListener('unhandledrejection', (event) => {
    handleError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    event.preventDefault();
  });
}

function categorizeError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase();

  if (msg.includes('failed to load') || msg.includes('not found') ||
      msg.includes('not embedded') || msg.includes('404') ||
      msg.includes('failed to fetch')) {
    return 'asset_missing';
  }

  if (msg.includes('invalid') && (msg.includes('schema') || msg.includes('format') || msg.includes('json')) ||
      msg.includes('unexpected token') || msg.includes('parse error')) {
    return 'invalid_schema';
  }

  if (msg.includes('wasm') || msg.includes('unreachable') ||
      msg.includes('RuntimeError') || msg.includes('memory access') ||
      error.name === 'RuntimeError') {
    return 'wasm_crash';
  }

  return 'unknown';
}

const CATEGORY_MESSAGES: Record<ErrorCategory, string> = {
  asset_missing: 'An asset file could not be found. Check that the file path is correct and the asset exists in the project.',
  invalid_schema: 'A file has an invalid format. It may be corrupted or use an unsupported schema version.',
  wasm_crash: 'The engine runtime encountered a fatal error. Try reloading the editor.',
  unknown: 'An unexpected error occurred. Check the console for details.',
};

function handleError(error: Error): void {
  const category = categorizeError(error);

  console.error(`[ESEngine:${category}]`, {
    message: error.message,
    stack: error.stack,
    category,
  });

  showErrorToast(CATEGORY_MESSAGES[category], error.message);
}
