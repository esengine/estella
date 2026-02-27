/**
 * @file    NewProjectDialog.ts
 * @brief   New project creation dialog with Templates and Examples tabs
 */

import type { ProjectTemplate, ExampleProjectInfo } from '../types/ProjectTypes';
import { PROJECT_TEMPLATES, EXAMPLE_PROJECTS } from '../types/ProjectTypes';
import { createProject, createFromExample, selectProjectLocation } from './ProjectService';

// =============================================================================
// Types
// =============================================================================

export interface NewProjectDialogOptions {
    onClose: () => void;
    onProjectCreated: (projectPath: string) => void;
}

type DialogTab = 'templates' | 'examples';

// =============================================================================
// NewProjectDialog
// =============================================================================

export class NewProjectDialog {
    private overlay_: HTMLElement;
    private options_: NewProjectDialogOptions;
    private selectedTemplate_: ProjectTemplate = 'empty';
    private selectedExample_: ExampleProjectInfo | null = EXAMPLE_PROJECTS[0] ?? null;
    private activeTab_: DialogTab = 'templates';
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
        this.overlay_.innerHTML = `
            <div class="es-dialog">
                <div class="es-dialog-header">
                    <span class="es-dialog-title">New Project</span>
                    <button class="es-dialog-close" data-action="close">×</button>
                </div>
                <div class="es-dialog-body">
                    <div class="es-dialog-tabs">
                        <button class="es-dialog-tab ${this.activeTab_ === 'templates' ? 'active' : ''}"
                            data-tab="templates">Templates</button>
                        <button class="es-dialog-tab ${this.activeTab_ === 'examples' ? 'active' : ''}"
                            data-tab="examples">Examples</button>
                    </div>
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
                    ${this.renderTabContent()}
                </div>
                <div class="es-dialog-footer">
                    <button class="es-dialog-btn" data-action="cancel">Cancel</button>
                    <button class="es-dialog-btn es-dialog-btn-primary" data-action="create">Create Project</button>
                </div>
            </div>
        `;
    }

    private renderTabContent(): string {
        if (this.activeTab_ === 'templates') {
            return this.renderTemplatesTab();
        }
        return this.renderExamplesTab();
    }

    private renderTemplatesTab(): string {
        const items = PROJECT_TEMPLATES.map(
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

        return `
            <div class="es-dialog-field">
                <label class="es-dialog-label">Template</label>
                <div class="es-dialog-templates">${items}</div>
            </div>
        `;
    }

    private renderExamplesTab(): string {
        if (EXAMPLE_PROJECTS.length === 0) {
            return `<div class="es-dialog-field"><span class="es-dialog-empty">No examples available</span></div>`;
        }

        const items = EXAMPLE_PROJECTS.map(
            (ex) => `
            <label class="es-dialog-template ${this.selectedExample_?.id === ex.id ? 'selected' : ''}">
                <input type="radio" name="example" value="${ex.id}" ${this.selectedExample_?.id === ex.id ? 'checked' : ''}>
                <span class="es-dialog-template-name">${ex.name}</span>
                <span class="es-dialog-template-desc">${ex.description}</span>
            </label>
        `
        ).join('');

        return `
            <div class="es-dialog-field">
                <label class="es-dialog-label">Example</label>
                <div class="es-dialog-templates">${items}</div>
            </div>
        `;
    }

    private setupEvents(): void {
        this.overlay_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const action = target.dataset.action ?? target.closest('[data-action]')?.getAttribute('data-action');
            const tab = target.dataset.tab;

            if (action === 'close' || action === 'cancel') {
                this.options_.onClose();
            } else if (action === 'browse') {
                this.handleBrowse();
            } else if (action === 'create') {
                this.handleCreate();
            } else if (tab) {
                this.switchTab(tab as DialogTab);
            }
        });

        this.overlay_.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.name === 'template') {
                this.selectedTemplate_ = target.value as ProjectTemplate;
                this.updateSelection();
            } else if (target.name === 'example') {
                this.selectedExample_ = EXAMPLE_PROJECTS.find(ex => ex.id === target.value) ?? null;
                this.updateSelection();
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

    private switchTab(tab: DialogTab): void {
        this.activeTab_ = tab;

        const locationInput = this.overlay_.querySelector('#project-location') as HTMLInputElement;
        const nameInput = this.overlay_.querySelector('#project-name') as HTMLInputElement;
        const savedLocation = locationInput?.value ?? '';
        const savedName = nameInput?.value ?? 'MyGame';

        this.render();

        const newNameInput = this.overlay_.querySelector('#project-name') as HTMLInputElement;
        const newLocationInput = this.overlay_.querySelector('#project-location') as HTMLInputElement;
        if (newNameInput) newNameInput.value = savedName;
        if (newLocationInput && savedLocation) newLocationInput.value = savedLocation;
    }

    private updateSelection(): void {
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

        let result;
        if (this.activeTab_ === 'examples' && this.selectedExample_) {
            result = await createFromExample({
                name,
                location: this.projectLocation_,
                example: this.selectedExample_,
            });
        } else {
            result = await createProject({
                name,
                location: this.projectLocation_,
                template: this.selectedTemplate_,
            });
        }

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
