/**
 * @file    Dialog.ts
 * @brief   Core Dialog class
 */

import type { DialogOptions, DialogResult, DialogRole } from './types';

export class Dialog {
    private overlay_: HTMLElement;
    private dialog_: HTMLElement;
    private body_: HTMLElement;
    private buttons_: HTMLButtonElement[] = [];
    private resolvePromise_: ((result: DialogResult) => void) | null = null;
    private options_: DialogOptions;

    constructor(options: DialogOptions) {
        this.options_ = {
            width: 480,
            closeOnOverlay: false,
            closeOnEscape: true,
            showCloseButton: true,
            ...options,
        };

        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-dialog-overlay';

        this.dialog_ = document.createElement('div');
        this.dialog_.className = 'es-dialog';
        if (this.options_.className) {
            this.dialog_.classList.add(this.options_.className);
        }

        const width = this.options_.width;
        if (typeof width === 'number') {
            this.dialog_.style.maxWidth = `${width}px`;
        } else if (width) {
            this.dialog_.style.maxWidth = width;
        }

        const header = document.createElement('div');
        header.className = 'es-dialog-header';

        const title = document.createElement('div');
        title.className = 'es-dialog-title';
        title.textContent = this.options_.title;
        header.appendChild(title);

        if (this.options_.showCloseButton) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'es-dialog-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.addEventListener('click', () => this.close({ action: 'cancel' }));
            header.appendChild(closeBtn);
        }

        this.body_ = document.createElement('div');
        this.body_.className = 'es-dialog-body';

        if (this.options_.content) {
            if (typeof this.options_.content === 'string') {
                const message = document.createElement('p');
                message.className = 'es-dialog-message';
                message.textContent = this.options_.content;
                this.body_.appendChild(message);
            } else {
                this.body_.appendChild(this.options_.content);
            }
        }

        this.dialog_.appendChild(header);
        this.dialog_.appendChild(this.body_);

        if (this.options_.buttons && this.options_.buttons.length > 0) {
            const footer = document.createElement('div');
            footer.className = 'es-dialog-footer';

            for (const btnConfig of this.options_.buttons) {
                const btn = document.createElement('button');
                btn.className = 'es-dialog-btn';
                if (btnConfig.primary) {
                    btn.classList.add('es-dialog-btn-primary');
                }
                if (btnConfig.disabled) {
                    btn.disabled = true;
                }
                btn.textContent = btnConfig.label;

                btn.addEventListener('click', async () => {
                    if (btnConfig.onClick) {
                        const result = await btnConfig.onClick();
                        if (result === false) return;
                    }
                    this.close({ action: btnConfig.role ?? 'custom' });
                });

                this.buttons_.push(btn);
                footer.appendChild(btn);
            }

            this.dialog_.appendChild(footer);
        }

        this.overlay_.appendChild(this.dialog_);

        if (this.options_.closeOnOverlay) {
            this.overlay_.addEventListener('click', (e) => {
                if (e.target === this.overlay_) {
                    this.close({ action: 'cancel' });
                }
            });
        }

        if (this.options_.closeOnEscape) {
            this.overlay_.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.close({ action: 'cancel' });
                }
            });
        }
    }

    open(): Promise<DialogResult> {
        return new Promise((resolve) => {
            this.resolvePromise_ = resolve;
            document.body.appendChild(this.overlay_);
            this.overlay_.focus();
        });
    }

    close(result: DialogResult): void {
        this.overlay_.remove();
        if (this.resolvePromise_) {
            this.resolvePromise_(result);
            this.resolvePromise_ = null;
        }
    }

    getElement(): HTMLElement {
        return this.dialog_;
    }

    getBody(): HTMLElement {
        return this.body_;
    }

    getButton(index: number): HTMLButtonElement | null {
        return this.buttons_[index] ?? null;
    }

    setButtonEnabled(index: number, enabled: boolean): void {
        const btn = this.buttons_[index];
        if (btn) {
            btn.disabled = !enabled;
        }
    }
}
