/**
 * @file    ProjectLauncher.ts
 * @brief   Project launcher/welcome screen with sidebar navigation
 */

import type { RecentProject } from '../types/ProjectTypes';
import { ENGINE_VERSION } from '../types/ProjectTypes';
import {
    getRecentProjects,
    removeRecentProject,
    openProject,
    openProjectDialog,
} from './ProjectService';
import { NewProjectDialog } from './NewProjectDialog';
import { ExampleBrowser } from './ExampleBrowser';
import { icons } from '../utils/icons';

// =============================================================================
// Types
// =============================================================================

export interface ProjectLauncherOptions {
    onProjectOpen: (projectPath: string) => void;
}

type LauncherView = 'projects' | 'learn';

// =============================================================================
// ProjectLauncher
// =============================================================================

export class ProjectLauncher {
    private container_: HTMLElement;
    private options_: ProjectLauncherOptions;
    private newProjectDialog_: NewProjectDialog | null = null;
    private activeView_: LauncherView = 'projects';
    private exampleBrowser_: ExampleBrowser | null = null;

    constructor(container: HTMLElement, options: ProjectLauncherOptions) {
        this.container_ = container;
        this.options_ = options;

        this.render();
    }

    dispose(): void {
        this.newProjectDialog_?.dispose();
        this.newProjectDialog_ = null;
        this.exampleBrowser_?.dispose();
        this.exampleBrowser_ = null;
        this.container_.innerHTML = '';
    }

    private render(): void {
        this.container_.className = 'es-launcher';
        this.container_.innerHTML = `
            <div class="es-launcher-topbar" data-tauri-drag-region>
                <div class="es-launcher-topbar-left">
                    <div class="es-launcher-logo-icon">${icons.logo(28)}</div>
                    <span class="es-launcher-topbar-title">ESEngine Editor</span>
                </div>
                <span class="es-launcher-topbar-version">v${ENGINE_VERSION}</span>
            </div>
            <div class="es-launcher-body">
                <div class="es-launcher-sidebar">
                    <button class="es-launcher-nav-item ${this.activeView_ === 'projects' ? 'active' : ''}" data-view="projects">
                        <span class="es-launcher-nav-icon">${icons.folder(16)}</span>
                        <span>Projects</span>
                    </button>
                    <button class="es-launcher-nav-item ${this.activeView_ === 'learn' ? 'active' : ''}" data-view="learn">
                        <span class="es-launcher-nav-icon">${icons.bookOpen(16)}</span>
                        <span>Learn</span>
                    </button>
                </div>
                <div class="es-launcher-content"></div>
            </div>
        `;

        this.renderActiveView();
        this.setupEvents();
    }

    private renderActiveView(): void {
        const content = this.container_.querySelector('.es-launcher-content');
        if (!content) return;

        this.exampleBrowser_?.dispose();
        this.exampleBrowser_ = null;

        if (this.activeView_ === 'projects') {
            this.renderProjectsView(content as HTMLElement);
        } else {
            this.renderLearnView(content as HTMLElement);
        }
    }

    private renderProjectsView(container: HTMLElement): void {
        container.innerHTML = `
            <div class="es-launcher-projects">
                <div class="es-launcher-welcome">
                    <div class="es-launcher-welcome-icon">${icons.logo(48)}</div>
                    <div class="es-launcher-welcome-text">
                        <h2 class="es-launcher-welcome-title">Welcome to ESEngine</h2>
                        <p class="es-launcher-welcome-desc">Create a new project or open an existing one to get started.</p>
                    </div>
                </div>
                <div class="es-launcher-actions">
                    <button class="es-launcher-action-card" data-action="new">
                        <span class="es-launcher-action-icon es-launcher-action-icon--primary">${icons.plus(20)}</span>
                        <span class="es-launcher-action-label">New Project</span>
                        <span class="es-launcher-action-desc">Start from a blank template</span>
                    </button>
                    <button class="es-launcher-action-card" data-action="open">
                        <span class="es-launcher-action-icon">${icons.folderOpen(20)}</span>
                        <span class="es-launcher-action-label">Open Project</span>
                        <span class="es-launcher-action-desc">Open an existing .esproject</span>
                    </button>
                </div>
                <div class="es-launcher-recent">
                    <div class="es-launcher-recent-header">
                        <span>Recent Projects</span>
                    </div>
                    <div class="es-launcher-recent-list"></div>
                </div>
            </div>
        `;

        this.renderRecentProjects();
    }

    private renderLearnView(container: HTMLElement): void {
        this.exampleBrowser_ = new ExampleBrowser(container, {
            onProjectOpen: (path) => this.options_.onProjectOpen(path),
        });
    }

    private renderRecentProjects(): void {
        const listContainer = this.container_.querySelector('.es-launcher-recent-list');
        if (!listContainer) return;

        const projects = getRecentProjects();

        if (projects.length === 0) {
            listContainer.innerHTML = `
                <div class="es-launcher-recent-empty">
                    <div class="es-launcher-recent-empty-icon">${icons.folder(24)}</div>
                    <span>No recent projects</span>
                    <span class="es-launcher-recent-empty-hint">Projects you open will appear here</span>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = projects
            .map((project, index) => this.renderRecentProjectItem(project, index))
            .join('');

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
                <div class="es-launcher-recent-icon">${icons.folder()}</div>
                <div class="es-launcher-recent-info">
                    <div class="es-launcher-recent-name">${this.escapeHtml(project.name)}</div>
                    <div class="es-launcher-recent-path">${this.escapeHtml(shortPath)}</div>
                </div>
                <div class="es-launcher-recent-time">${timeAgo}</div>
                <button class="es-launcher-recent-remove" title="Remove from list">&times;</button>
            </div>
        `;
    }

    private setupEvents(): void {
        this.container_.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        this.container_.querySelectorAll('.es-launcher-nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = (btn as HTMLElement).dataset.view as LauncherView;
                if (view && view !== this.activeView_) {
                    this.switchView(view);
                }
            });
        });

        const newBtn = this.container_.querySelector('[data-action="new"]');
        const openBtn = this.container_.querySelector('[data-action="open"]');

        newBtn?.addEventListener('click', () => this.handleNewProject());
        openBtn?.addEventListener('click', () => this.handleOpenProject());
    }

    private switchView(view: LauncherView): void {
        this.activeView_ = view;

        this.container_.querySelectorAll('.es-launcher-nav-item').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.view === view);
        });

        this.renderActiveView();

        const content = this.container_.querySelector('.es-launcher-content');
        if (content && this.activeView_ === 'projects') {
            const newBtn = content.querySelector('[data-action="new"]');
            const openBtn = content.querySelector('[data-action="open"]');
            newBtn?.addEventListener('click', () => this.handleNewProject());
            openBtn?.addEventListener('click', () => this.handleOpenProject());
        }
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
