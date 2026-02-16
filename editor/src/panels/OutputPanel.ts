import type { PanelInstance } from './PanelRegistry';
import { icons } from '../utils/icons';

export class OutputPanel implements PanelInstance {
    private container_: HTMLElement;
    private contentEl_: HTMLElement | null = null;
    private lastText_: string = '';
    private lastType_: string = '';
    private lastLine_: HTMLElement | null = null;
    private repeatCount_ = 0;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.render();
    }

    appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        if (!this.contentEl_) return;

        const empty = this.contentEl_.querySelector('.es-output-empty');
        if (empty) empty.remove();

        if (text === this.lastText_ && type === this.lastType_ && this.lastLine_) {
            this.repeatCount_++;
            let badge = this.lastLine_.querySelector('.es-output-badge') as HTMLElement;
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'es-output-badge';
                this.lastLine_.prepend(badge);
            }
            badge.textContent = String(this.repeatCount_);
            this.contentEl_.scrollTop = this.contentEl_.scrollHeight;
            return;
        }

        this.lastText_ = text;
        this.lastType_ = type;
        this.repeatCount_ = 1;

        const line = document.createElement('div');
        line.className = `es-output-line es-output-${type}`;
        line.textContent = text;
        this.contentEl_.appendChild(line);
        this.lastLine_ = line;
        this.contentEl_.scrollTop = this.contentEl_.scrollHeight;
    }

    clear(): void {
        if (!this.contentEl_) return;
        this.contentEl_.innerHTML = '<div class="es-output-empty">No output messages</div>';
        this.lastText_ = '';
        this.lastType_ = '';
        this.lastLine_ = null;
        this.repeatCount_ = 0;
    }

    dispose(): void {
        this.container_.innerHTML = '';
    }

    private render(): void {
        this.container_.innerHTML = `
            <div class="es-output-panel">
                <div class="es-output-header">
                    <span class="es-output-title">${icons.list(14)} Output</span>
                    <div class="es-output-actions">
                        <button class="es-btn es-btn-icon" data-action="clear-output" title="Clear">${icons.trash(12)}</button>
                    </div>
                </div>
                <div class="es-output-content" role="log" aria-live="polite">
                    <div class="es-output-empty">No output messages</div>
                </div>
            </div>
        `;

        this.contentEl_ = this.container_.querySelector('.es-output-content');

        const clearBtn = this.container_.querySelector('[data-action="clear-output"]');
        clearBtn?.addEventListener('click', () => this.clear());
    }
}
