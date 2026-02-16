/**
 * @file    AddComponentPopup.ts
 * @brief   Popup for adding components to entities
 */

import { icons } from '../utils/icons';
import {
    getComponentsByCategory,
    type ComponentSchema,
    type ComponentCategory,
} from '../schemas/ComponentSchemas';

// =============================================================================
// Types
// =============================================================================

export interface AddComponentPopupOptions {
    existingComponents: string[];
    onSelect: (componentName: string) => void;
    onClose: () => void;
}

interface CategoryState {
    expanded: boolean;
}

// =============================================================================
// AddComponentPopup
// =============================================================================

export class AddComponentPopup {
    private container_: HTMLElement;
    private options_: AddComponentPopupOptions;
    private searchInput_: HTMLInputElement | null = null;
    private listContainer_: HTMLElement | null = null;
    private highlightIndex_: number = -1;
    private categoryStates_: Map<ComponentCategory, CategoryState> = new Map([
        ['builtin', { expanded: true }],
        ['ui', { expanded: true }],
        ['physics', { expanded: true }],
        ['script', { expanded: true }],
        ['tag', { expanded: true }],
    ]);

    constructor(container: HTMLElement, options: AddComponentPopupOptions) {
        this.container_ = container;
        this.options_ = options;
        this.render();
        this.setupEvents();
    }

    private render(): void {
        this.container_.innerHTML = `
            <div class="es-add-component-popup">
                <div class="es-add-component-header">
                    <span class="es-add-component-title">Add Component</span>
                    <button class="es-btn-icon es-add-component-close" title="Close">
                        ${icons.x(14)}
                    </button>
                </div>
                <div class="es-add-component-search">
                    <span class="es-search-icon">${icons.search(12)}</span>
                    <input type="text" class="es-input es-search-input" placeholder="Search components..." />
                </div>
                <div class="es-add-component-list"></div>
            </div>
        `;

        this.searchInput_ = this.container_.querySelector('.es-search-input');
        this.listContainer_ = this.container_.querySelector('.es-add-component-list');
        this.renderList();
    }

    private highlightName(name: string, filter: string): string {
        if (!filter) return name;
        const idx = name.toLowerCase().indexOf(filter.toLowerCase());
        if (idx < 0) return name;
        const before = name.substring(0, idx);
        const match = name.substring(idx, idx + filter.length);
        const after = name.substring(idx + filter.length);
        return `${before}<mark>${match}</mark>${after}`;
    }

    private renderList(filter: string = ''): void {
        if (!this.listContainer_) return;

        this.highlightIndex_ = -1;

        const components = getComponentsByCategory();
        const filterLower = filter.toLowerCase();
        const existing = new Set(this.options_.existingComponents);

        let html = '';

        const renderCategory = (
            category: ComponentCategory,
            label: string,
            schemas: ComponentSchema[],
            iconFn: () => string
        ) => {
            const filtered = schemas.filter(s =>
                !existing.has(s.name) &&
                s.name.toLowerCase().includes(filterLower)
            );

            if (filtered.length === 0 && filter) return '';

            const state = this.categoryStates_.get(category)!;
            const chevron = state.expanded ? icons.chevronDown(12) : icons.chevronRight(12);
            const itemsClass = state.expanded ? '' : 'es-hidden';

            let categoryHtml = `
                <div class="es-component-category" data-category="${category}">
                    <div class="es-category-header">
                        <span class="es-category-chevron">${chevron}</span>
                        <span class="es-category-label">${label}</span>
                        <span class="es-category-count">${filtered.length}</span>
                    </div>
                    <div class="es-category-items ${itemsClass}">
            `;

            for (const schema of filtered) {
                const displayName = this.highlightName(schema.name, filter);
                categoryHtml += `
                    <div class="es-component-item" data-component="${schema.name}">
                        <span class="es-component-icon">${iconFn()}</span>
                        <span class="es-component-name">${displayName}</span>
                    </div>
                `;
            }

            categoryHtml += `
                    </div>
                </div>
            `;

            return categoryHtml;
        };

        html += renderCategory('builtin', 'Built-in', components.builtin, () => icons.box(14));
        html += renderCategory('ui', 'UI', components.ui, () => icons.pointer(14));
        html += renderCategory('physics', 'Physics', components.physics, () => icons.circle(14));
        html += renderCategory('script', 'Scripts', components.script, () => icons.cog(14));
        html += renderCategory('tag', 'Tags', components.tag, () => icons.tag(14));

        if (!html.trim()) {
            html = '<div class="es-no-components">No components available</div>';
        }

        this.listContainer_.innerHTML = html;
    }

    private setupEvents(): void {
        this.searchInput_?.addEventListener('input', () => {
            this.renderList(this.searchInput_?.value ?? '');
        });

        this.container_.querySelector('.es-add-component-close')?.addEventListener('click', () => {
            this.options_.onClose();
        });

        this.listContainer_?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            const categoryHeader = target.closest('.es-category-header');
            if (categoryHeader) {
                const category = categoryHeader.closest('.es-component-category')?.getAttribute('data-category') as ComponentCategory;
                if (category) {
                    this.toggleCategory(category);
                }
                return;
            }

            const componentItem = target.closest('.es-component-item') as HTMLElement;
            if (componentItem) {
                const name = componentItem.dataset.component;
                if (name) {
                    this.options_.onSelect(name);
                    this.options_.onClose();
                }
            }
        });

        document.addEventListener('keydown', this.handleKeyDown);
        setTimeout(() => this.searchInput_?.focus(), 0);
    }

    private getVisibleItems(): HTMLElement[] {
        if (!this.listContainer_) return [];
        return Array.from(
            this.listContainer_.querySelectorAll('.es-category-items:not(.es-hidden) > .es-component-item')
        );
    }

    private updateHighlight(): void {
        const items = this.getVisibleItems();
        for (const el of items) {
            el.classList.remove('es-highlighted');
        }
        if (this.highlightIndex_ >= 0 && this.highlightIndex_ < items.length) {
            items[this.highlightIndex_].classList.add('es-highlighted');
            items[this.highlightIndex_].scrollIntoView({ block: 'nearest' });
        }
    }

    private handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            this.options_.onClose();
            return;
        }

        const items = this.getVisibleItems();
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.highlightIndex_ = this.highlightIndex_ < items.length - 1
                ? this.highlightIndex_ + 1
                : 0;
            this.updateHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.highlightIndex_ = this.highlightIndex_ > 0
                ? this.highlightIndex_ - 1
                : items.length - 1;
            this.updateHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.highlightIndex_ >= 0 && this.highlightIndex_ < items.length) {
                const name = items[this.highlightIndex_].dataset.component;
                if (name) {
                    this.options_.onSelect(name);
                    this.options_.onClose();
                }
            }
        }
    };

    private toggleCategory(category: ComponentCategory): void {
        const state = this.categoryStates_.get(category);
        if (state) {
            state.expanded = !state.expanded;
            this.renderList(this.searchInput_?.value ?? '');
        }
    }

    dispose(): void {
        document.removeEventListener('keydown', this.handleKeyDown);
        this.container_.innerHTML = '';
    }
}

// =============================================================================
// Overlay Helper
// =============================================================================

export function showAddComponentPopup(
    existingComponents: string[],
    onSelect: (componentName: string) => void
): void {
    const overlay = document.createElement('div');
    overlay.className = 'es-popup-overlay';

    const container = document.createElement('div');
    container.className = 'es-popup-container';
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    const close = () => {
        popup.dispose();
        overlay.remove();
    };

    const popup = new AddComponentPopup(container, {
        existingComponents,
        onSelect,
        onClose: close,
    });
}
