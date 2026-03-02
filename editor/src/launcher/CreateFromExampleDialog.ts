/**
 * @file    CreateFromExampleDialog.ts
 * @brief   Simplified dialog for creating a project from an example (name + location only)
 */

import type { ExampleProjectInfo } from '../types/ProjectTypes';
import { createFromExample, selectProjectLocation } from './ProjectService';

// =============================================================================
// Types
// =============================================================================

export interface CreateFromExampleDialogOptions {
    example: ExampleProjectInfo;
    onClose: () => void;
    onProjectCreated: (projectPath: string) => void;
}

// =============================================================================
// CreateFromExampleDialog
// =============================================================================

export class CreateFromExampleDialog {
    private overlay_: HTMLElement;
    private options_: CreateFromExampleDialogOptions;
    private projectLocation_ = '';

    constructor(options: CreateFromExampleDialogOptions) {
        this.options_ = options;

        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-dialog-overlay';
        document.body.appendChild(this.overlay_);

        this.render();
        this.setupEvents();
    }

    dispose(): void {
        this.overlay_.remove();
    }

    private render(): void {
        const { example } = this.options_;
        const defaultName = example.name.replace(/\s+/g, '');

        this.overlay_.innerHTML = `
            <div class="es-dialog">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">Create from Example</span>
                    <button class="es-dialog-close" data-action="close">&times;</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Example</label>
                        <div class="es-dialog-example-info">
                            <span class="es-dialog-example-name">${this.escapeHtml(example.name)}</span>
                            <span class="es-dialog-example-desc">${this.escapeHtml(example.description)}</span>
                        </div>
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Project Name</label>
                        <input type="text" class="es-dialog-input" id="example-project-name"
                            placeholder="My Game" value="${defaultName}">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Location</label>
                        <div class="es-dialog-path-row">
                            <input type="text" class="es-dialog-input es-dialog-path"
                                id="example-project-location" placeholder="Select a folder..." readonly>
                            <button class="es-dialog-browse" data-action="browse">...</button>
                        </div>
                    </div>
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="create">Create Project</button>
                </div>
            </div>
        `;
    }

    private setupEvents(): void {
        this.overlay_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.action ?? target.closest('[data-action]')?.getAttribute('data-action');

            if (action === 'close' || action === 'cancel') {
                this.options_.onClose();
            } else if (action === 'browse') {
                this.handleBrowse();
            } else if (action === 'create') {
                this.handleCreate();
            }
        });

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.options_.onClose();
                document.removeEventListener('keydown', keyHandler);
            }
        };
        document.addEventListener('keydown', keyHandler);
    }

    private async handleBrowse(): Promise<void> {
        const path = await selectProjectLocation();
        if (path) {
            this.projectLocation_ = path;
            const locationInput = this.overlay_.querySelector('#example-project-location') as HTMLInputElement;
            if (locationInput) {
                locationInput.value = path;
            }
        }
    }

    private async handleCreate(): Promise<void> {
        const nameInput = this.overlay_.querySelector('#example-project-name') as HTMLInputElement;
        const name = nameInput?.value.trim();

        if (!name) {
            alert('Please enter a project name');
            nameInput?.focus();
            return;
        }

        if (!this.projectLocation_) {
            alert('Please select a project location');
            return;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            alert('Project name can only contain letters, numbers, underscores, and hyphens');
            nameInput?.focus();
            return;
        }

        const createBtn = this.overlay_.querySelector('[data-action="create"]') as HTMLButtonElement;
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = 'Creating...';
        }

        const result = await createFromExample({
            name,
            location: this.projectLocation_,
            example: this.options_.example,
        });

        if (result.success && result.data) {
            this.options_.onProjectCreated(result.data);
        } else {
            alert(result.error ?? 'Failed to create project');
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Project';
            }
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
