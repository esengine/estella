/**
 * @file    ProjectLauncher.ts
 * @brief   Project launcher/welcome screen component
 */

import type { RecentProject } from '../types/ProjectTypes';
import {
    getRecentProjects,
    removeRecentProject,
    openProject,
    openProjectDialog,
} from './ProjectService';
import { NewProjectDialog } from './NewProjectDialog';

// =============================================================================
// Types
// =============================================================================

export interface ProjectLauncherOptions {
    onProjectOpen: (projectPath: string) => void;
}

// =============================================================================
// ProjectLauncher
// =============================================================================

export class ProjectLauncher {
    private container_: HTMLElement;
    private options_: ProjectLauncherOptions;
    private newProjectDialog_: NewProjectDialog | null = null;

    constructor(container: HTMLElement, options: ProjectLauncherOptions) {
        this.container_ = container;
        this.options_ = options;

        this.render();
    }

    dispose(): void {
        this.newProjectDialog_?.dispose();
        this.newProjectDialog_ = null;
        this.container_.innerHTML = '';
    }

    private render(): void {
        this.container_.className = 'es-launcher';
        this.container_.innerHTML = `
            <div class="es-launcher-content">
                <div class="es-launcher-header">
                    <div class="es-launcher-logo">
                        <div class="es-launcher-logo-icon">ES</div>
                        <div class="es-launcher-logo-text">
                            <span class="es-launcher-title">ESEngine</span>
                            <span class="es-launcher-subtitle">Editor</span>
                        </div>
                    </div>
                </div>

                <div class="es-launcher-actions">
                    <button class="es-launcher-btn es-launcher-btn-primary" data-action="new">
                        <span class="es-launcher-btn-icon">+</span>
                        <span>New Project</span>
                    </button>
                    <button class="es-launcher-btn" data-action="open">
                        <span class="es-launcher-btn-icon">📂</span>
                        <span>Open Project</span>
                    </button>
                </div>

                <div class="es-launcher-recent">
                    <div class="es-launcher-recent-header">
                        <span>Recent Projects</span>
                    </div>
                    <div class="es-launcher-recent-list"></div>
                </div>

                <div class="es-launcher-footer">
                    <span>v0.1.0</span>
                </div>
            </div>
        `;

        this.renderRecentProjects();
        this.setupEvents();
    }

    private renderRecentProjects(): void {
        const listContainer = this.container_.querySelector('.es-launcher-recent-list');
        if (!listContainer) return;

        const projects = getRecentProjects();

        if (projects.length === 0) {
            listContainer.innerHTML = `
                <div class="es-launcher-recent-empty">
                    No recent projects
                </div>
            `;
            return;
        }

        listContainer.innerHTML = projects
            .map((project, index) => this.renderRecentProjectItem(project, index))
            .join('');

        // Bind click events for recent project items
        listContainer.querySelectorAll('.es-launcher-recent-item').forEach((item, index) => {
            item.addEventListener('click', () => this.handleOpenRecentProject(projects[index]));
        });

        listContainer.querySelectorAll('.es-launcher-recent-remove').forEach((btn, index) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleRemoveRecentProject(projects[index].path);
            });
        });
    }

    private renderRecentProjectItem(project: RecentProject, _index: number): string {
        const timeAgo = this.formatTimeAgo(project.lastOpened);
        const shortPath = this.shortenPath(project.path);

        return `
            <div class="es-launcher-recent-item">
                <div class="es-launcher-recent-icon">📁</div>
                <div class="es-launcher-recent-info">
                    <div class="es-launcher-recent-name">${this.escapeHtml(project.name)}</div>
                    <div class="es-launcher-recent-path">${this.escapeHtml(shortPath)}</div>
                </div>
                <div class="es-launcher-recent-time">${timeAgo}</div>
                <button class="es-launcher-recent-remove" title="Remove from list">×</button>
            </div>
        `;
    }

    private setupEvents(): void {
        const newBtn = this.container_.querySelector('[data-action="new"]');
        const openBtn = this.container_.querySelector('[data-action="open"]');

        newBtn?.addEventListener('click', () => this.handleNewProject());
        openBtn?.addEventListener('click', () => this.handleOpenProject());
    }

    private handleNewProject(): void {
        if (this.newProjectDialog_) return;

        this.newProjectDialog_ = new NewProjectDialog({
            onClose: () => {
                this.newProjectDialog_?.dispose();
                this.newProjectDialog_ = null;
            },
            onProjectCreated: (projectPath) => {
                this.newProjectDialog_?.dispose();
                this.newProjectDialog_ = null;
                this.options_.onProjectOpen(projectPath);
            },
        });
    }

    private async handleOpenProject(): Promise<void> {
        const result = await openProjectDialog();
        if (result.success && result.data) {
            this.options_.onProjectOpen(result.data);
        } else if (result.error && result.error !== 'No project selected') {
            alert(result.error);
        }
    }

    private async handleOpenRecentProject(project: RecentProject): Promise<void> {
        const result = await openProject(project.path);
        if (result.success && result.data) {
            this.options_.onProjectOpen(result.data);
        } else if (result.error) {
            alert(result.error);
            this.renderRecentProjects();
        }
    }

    private handleRemoveRecentProject(path: string): void {
        removeRecentProject(path);
        this.renderRecentProjects();
    }

    private formatTimeAgo(isoString: string): string {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    }

    private shortenPath(path: string): string {
        const normalized = path.replace(/\\/g, '/');
        const parts = normalized.split('/');
        if (parts.length <= 4) return normalized;
        return `.../${parts.slice(-3).join('/')}`;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
