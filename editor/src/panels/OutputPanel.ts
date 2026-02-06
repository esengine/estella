import type { PanelInstance } from './PanelRegistry';
import { icons } from '../utils/icons';

export class OutputPanel implements PanelInstance {
    private container_: HTMLElement;
    private contentEl_: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.render();
    }

    appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        if (!this.contentEl_) return;

        const empty = this.contentEl_.querySelector('.es-output-empty');
        if (empty) empty.remove();

        const line = document.createElement('div');
        line.className = `es-output-line es-output-${type}`;
        line.textContent = text;
        this.contentEl_.appendChild(line);
        this.contentEl_.scrollTop = this.contentEl_.scrollHeight;
    }

    clear(): void {
        if (!this.contentEl_) return;
        this.contentEl_.innerHTML = '<div class="es-output-empty">No output messages</div>';
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
                <div class="es-output-content">
                    <div class="es-output-empty">No output messages</div>
                </div>
            </div>
        `;

        this.contentEl_ = this.container_.querySelector('.es-output-content');

        const clearBtn = this.container_.querySelector('[data-action="clear-output"]');
        clearBtn?.addEventListener('click', () => this.clear());
    }
}
