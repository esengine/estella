/**
 * @file    NewProjectDialog.ts
 * @brief   New project creation dialog
 */

import type { ProjectTemplate } from '../types/ProjectTypes';
import { PROJECT_TEMPLATES } from '../types/ProjectTypes';
import { createProject, selectProjectLocation } from './ProjectService';

// =============================================================================
// Types
// =============================================================================

export interface NewProjectDialogOptions {
    onClose: () => void;
    onProjectCreated: (projectPath: string) => void;
}

// =============================================================================
// NewProjectDialog
// =============================================================================

export class NewProjectDialog {
    private overlay_: HTMLElement;
    private options_: NewProjectDialogOptions;
    private selectedTemplate_: ProjectTemplate = 'empty';
    private projectLocation_: string = '';

    constructor(options: NewProjectDialogOptions) {
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
        const templatesHtml = PROJECT_TEMPLATES.map(
            (t) => `
            <label class="es-dialog-template ${t.id === this.selectedTemplate_ ? 'selected' : ''} ${!t.enabled ? 'disabled' : ''}">
                <input type="radio" name="template" value="${t.id}"
                    ${t.id === this.selectedTemplate_ ? 'checked' : ''}
                    ${!t.enabled ? 'disabled' : ''}>
                <span class="es-dialog-template-name">${t.name}</span>
                <span class="es-dialog-template-desc">${t.description}${!t.enabled ? ' (coming soon)' : ''}</span>
            </label>
        `
        ).join('');

        this.overlay_.innerHTML = `
            <div class="es-dialog">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">New Project</span>
                    <button class="es-dialog-close" data-action="close">×</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Project Name</label>
                        <input type="text" class="es-dialog-input" id="project-name"
                            placeholder="My Game" value="MyGame">
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Location</label>
                        <div class="es-dialog-path-row">
                            <input type="text" class="es-dialog-input es-dialog-path"
                                id="project-location" placeholder="Select a folder..." readonly>
                            <button class="es-dialog-browse" data-action="browse">...</button>
                        </div>
                    </div>
                    <div class="es-dialog-field">
                        <label class="es-dialog-label">Template</label>
                        <div class="es-dialog-templates">
                            ${templatesHtml}
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
        // Close button
        this.overlay_.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.options_.onClose();
        });

        // Cancel button
        this.overlay_.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this.options_.onClose();
        });

        // Browse button
        this.overlay_.querySelector('[data-action="browse"]')?.addEventListener('click', () => {
            this.handleBrowse();
        });

        // Create button
        this.overlay_.querySelector('[data-action="create"]')?.addEventListener('click', () => {
            this.handleCreate();
        });

        // Template selection
        this.overlay_.querySelectorAll('input[name="template"]').forEach((input) => {
            input.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                this.selectedTemplate_ = target.value as ProjectTemplate;
                this.updateTemplateSelection();
            });
        });

        // Overlay click to close
        this.overlay_.addEventListener('click', (e) => {
            if (e.target === this.overlay_) {
                this.options_.onClose();
            }
        });

        // Escape key to close
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.options_.onClose();
                document.removeEventListener('keydown', keyHandler);
            }
        };
        document.addEventListener('keydown', keyHandler);
    }

    private updateTemplateSelection(): void {
        this.overlay_.querySelectorAll('.es-dialog-template').forEach((el) => {
            const input = el.querySelector('input') as HTMLInputElement;
            el.classList.toggle('selected', input.checked);
        });
    }

    private async handleBrowse(): Promise<void> {
        const path = await selectProjectLocation();
        if (path) {
            this.projectLocation_ = path;
            const locationInput = this.overlay_.querySelector('#project-location') as HTMLInputElement;
            if (locationInput) {
                locationInput.value = path;
            }
        }
    }

    private async handleCreate(): Promise<void> {
        const nameInput = this.overlay_.querySelector('#project-name') as HTMLInputElement;
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

        // Validate project name
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

        const result = await createProject({
            name,
            location: this.projectLocation_,
            template: this.selectedTemplate_,
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
}
