/**
 * @file    ExampleBrowser.ts
 * @brief   Searchable, filterable example card grid for the Learn view
 */

import type { ExampleProjectInfo, ExampleCategory } from '../types/ProjectTypes';
import { EXAMPLE_PROJECTS, EXAMPLE_CATEGORY_LABELS } from '../types/ProjectTypes';
import { CreateFromExampleDialog } from './CreateFromExampleDialog';
import { icons } from '../utils/icons';

// =============================================================================
// Types
// =============================================================================

export interface ExampleBrowserOptions {
    onProjectOpen: (projectPath: string) => void;
}

// =============================================================================
// ExampleBrowser
// =============================================================================

export class ExampleBrowser {
    private container_: HTMLElement;
    private options_: ExampleBrowserOptions;
    private searchQuery_ = '';
    private selectedCategory_: ExampleCategory | 'all' = 'all';
    private dialog_: CreateFromExampleDialog | null = null;

    constructor(container: HTMLElement, options: ExampleBrowserOptions) {
        this.container_ = container;
        this.options_ = options;
        this.render();
    }

    dispose(): void {
        this.dialog_?.dispose();
        this.dialog_ = null;
        this.container_.innerHTML = '';
    }

    private render(): void {
        const categories = this.getAvailableCategories();

        this.container_.innerHTML = `
            <div class="es-example-browser">
                <div class="es-example-toolbar">
                    <div class="es-example-search">
                        <span class="es-example-search-icon">${icons.search(14)}</span>
                        <input type="text" class="es-example-search-input"
                            placeholder="Search examples..." value="${this.escapeAttr(this.searchQuery_)}">
                    </div>
                    <select class="es-example-filter">
                        <option value="all" ${this.selectedCategory_ === 'all' ? 'selected' : ''}>All Categories</option>
                        ${categories.map(cat =>
                            `<option value="${cat}" ${this.selectedCategory_ === cat ? 'selected' : ''}>${EXAMPLE_CATEGORY_LABELS[cat]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="es-example-list"></div>
            </div>
        `;

        this.renderCards();
        this.setupEvents();
    }

    private renderCards(): void {
        const listEl = this.container_.querySelector('.es-example-list');
        if (!listEl) return;

        const filtered = this.getFilteredExamples();

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="es-example-empty">No examples match your search</div>`;
            return;
        }

        if (this.searchQuery_) {
            listEl.innerHTML = `
                <div class="es-example-grid">
                    ${filtered.map(ex => this.renderCard(ex)).join('')}
                </div>
            `;
        } else {
            const grouped = this.groupByCategory(filtered);
            listEl.innerHTML = Object.entries(grouped)
                .map(([cat, examples]) => `
                    <div class="es-example-category-title">${EXAMPLE_CATEGORY_LABELS[cat as ExampleCategory]}</div>
                    <div class="es-example-grid">
                        ${examples.map(ex => this.renderCard(ex)).join('')}
                    </div>
                `).join('');
        }

        listEl.querySelectorAll('.es-example-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = (card as HTMLElement).dataset.exampleId;
                const example = EXAMPLE_PROJECTS.find(ex => ex.id === id);
                if (example) {
                    this.openCreateDialog(example);
                }
            });
        });

        listEl.querySelectorAll('.es-example-card-img').forEach(img => {
            (img as HTMLImageElement).addEventListener('error', () => {
                (img as HTMLElement).style.display = 'none';
                const fallback = (img as HTMLElement).nextElementSibling as HTMLElement;
                if (fallback) {
                    fallback.style.display = '';
                }
            });
        });
    }

    private renderCard(example: ExampleProjectInfo): string {
        return `
            <div class="es-example-card" data-example-id="${example.id}">
                <div class="es-example-card-thumb">
                    <img class="es-example-card-img" src="/${example.thumbnail}" alt="${this.escapeAttr(example.name)}">
                    <div class="es-example-card-thumb-fallback" style="display:none">${icons.image(48)}</div>
                </div>
                <div class="es-example-card-body">
                    <div class="es-example-card-title">${this.escapeHtml(example.name)}</div>
                    <div class="es-example-card-desc">${this.escapeHtml(example.description)}</div>
                    <div class="es-example-card-meta">
                        <span class="es-example-card-tag es-example-card-category">${EXAMPLE_CATEGORY_LABELS[example.category]}</span>
                        <span class="es-example-card-tag es-example-card-difficulty">${example.difficulty}</span>
                    </div>
                </div>
            </div>
        `;
    }

    private setupEvents(): void {
        const searchInput = this.container_.querySelector('.es-example-search-input') as HTMLInputElement;
        const filterSelect = this.container_.querySelector('.es-example-filter') as HTMLSelectElement;

        searchInput?.addEventListener('input', () => {
            this.searchQuery_ = searchInput.value.trim();
            this.renderCards();
        });

        filterSelect?.addEventListener('change', () => {
            this.selectedCategory_ = filterSelect.value as ExampleCategory | 'all';
            this.renderCards();
        });
    }

    private getFilteredExamples(): ExampleProjectInfo[] {
        let results = EXAMPLE_PROJECTS;

        if (this.selectedCategory_ !== 'all') {
            results = results.filter(ex => ex.category === this.selectedCategory_);
        }

        if (this.searchQuery_) {
            const q = this.searchQuery_.toLowerCase();
            results = results.filter(ex =>
                ex.name.toLowerCase().includes(q) ||
                ex.description.toLowerCase().includes(q) ||
                ex.tags.some(tag => tag.toLowerCase().includes(q)) ||
                ex.category.toLowerCase().includes(q)
            );
        }

        return results;
    }

    private getAvailableCategories(): ExampleCategory[] {
        const cats = new Set<ExampleCategory>();
        for (const ex of EXAMPLE_PROJECTS) {
            cats.add(ex.category);
        }
        return Array.from(cats);
    }

    private groupByCategory(examples: ExampleProjectInfo[]): Record<string, ExampleProjectInfo[]> {
        const groups: Record<string, ExampleProjectInfo[]> = {};
        for (const ex of examples) {
            if (!groups[ex.category]) {
                groups[ex.category] = [];
            }
            groups[ex.category].push(ex);
        }
        return groups;
    }

    private openCreateDialog(example: ExampleProjectInfo): void {
        if (this.dialog_) return;

        this.dialog_ = new CreateFromExampleDialog({
            example,
            onClose: () => {
                this.dialog_?.dispose();
                this.dialog_ = null;
            },
            onProjectCreated: (projectPath) => {
                this.dialog_?.dispose();
                this.dialog_ = null;
                this.options_.onProjectOpen(projectPath);
            },
        });
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private escapeAttr(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }
}
