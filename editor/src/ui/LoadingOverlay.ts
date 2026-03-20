import { icons } from '../utils/icons';

export class LoadingOverlay {
    private el_: HTMLElement;
    private statusEl_: HTMLElement;

    constructor(container: HTMLElement) {
        this.el_ = document.createElement('div');
        this.el_.className = 'es-loading-overlay';
        this.el_.innerHTML = `
            <div class="es-loading-logo">${icons.logo(56)}</div>
            <div class="es-loading-progress">
                <div class="es-loading-bar-track">
                    <div class="es-loading-bar-fill"></div>
                </div>
                <div class="es-loading-status">Loading...</div>
            </div>
        `;
        this.statusEl_ = this.el_.querySelector('.es-loading-status')!;
        container.appendChild(this.el_);
    }

    setStatus(text: string): void {
        this.statusEl_.textContent = text;
    }

    dismiss(): void {
        this.el_.classList.add('es-loading-overlay--fade-out');
        this.el_.addEventListener('transitionend', () => {
            this.el_.remove();
        }, { once: true });
    }
}
