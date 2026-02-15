export interface ErrorBoundaryOptions {
  fallback: (error: Error) => HTMLElement;
  onError?: (error: Error, errorInfo: string) => void;
  isolate?: boolean;
}

export class ErrorBoundary {
  private element_: HTMLElement;
  private contentContainer_: HTMLElement;
  private hasError_ = false;

  constructor(
    private container_: HTMLElement,
    private options_: ErrorBoundaryOptions
  ) {
    this.element_ = document.createElement('div');
    this.element_.className = 'es-error-boundary';

    this.contentContainer_ = document.createElement('div');
    this.contentContainer_.className = 'es-error-boundary-content';
    this.element_.appendChild(this.contentContainer_);

    this.container_.appendChild(this.element_);
  }

  wrap<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      try {
        const result = fn(...args);

        if (result instanceof Promise) {
          return result.catch((error) => this.handleError(error));
        }

        return result;
      } catch (error) {
        this.handleError(error as Error);
      }
    }) as T;
  }

  private handleError(error: Error): void {
    if (this.hasError_) return;

    this.hasError_ = true;

    this.options_.onError?.(error, this.getErrorInfo());

    this.contentContainer_.innerHTML = '';
    const fallback = this.options_.fallback(error);
    this.contentContainer_.appendChild(fallback);

    if (!this.options_.isolate) {
      throw error;
    }
  }

  private getErrorInfo(): string {
    return new Error().stack ?? 'No stack trace available';
  }

  reset(): void {
    this.hasError_ = false;
    this.contentContainer_.innerHTML = '';
  }

  render(renderFn: () => void): void {
    this.wrap(renderFn)();
  }

  getContainer(): HTMLElement {
    return this.contentContainer_;
  }
}
