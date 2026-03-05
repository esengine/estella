export interface IDisposable {
    dispose(): void;
}

export function toDisposable(fn: () => void): IDisposable {
    return { dispose: fn };
}

export class DisposableStore implements IDisposable {
    private disposables_: IDisposable[] = [];
    private disposed_ = false;

    add<T extends IDisposable>(d: T): T;
    add(fn: () => void): IDisposable;
    add(d: IDisposable | (() => void)): IDisposable {
        const disposable = typeof d === 'function' ? toDisposable(d) : d;
        if (this.disposed_) {
            disposable.dispose();
            return disposable;
        }
        this.disposables_.push(disposable);
        return disposable;
    }

    addListener(
        target: EventTarget,
        event: string,
        handler: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ): IDisposable {
        target.addEventListener(event, handler, options);
        return this.add(() => target.removeEventListener(event, handler, options));
    }

    dispose(): void {
        if (this.disposed_) {
            return;
        }
        this.disposed_ = true;
        const disposables = this.disposables_.splice(0);
        for (let i = disposables.length - 1; i >= 0; i--) {
            try {
                disposables[i].dispose();
            } catch (e) {
                console.error('Error during dispose:', e);
            }
        }
    }
}
