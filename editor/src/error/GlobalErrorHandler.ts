import { showErrorToast } from '../ui/Toast';

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

function handleError(error: Error): void {
  showErrorToast('An unexpected error occurred. Check console for details.');
}
