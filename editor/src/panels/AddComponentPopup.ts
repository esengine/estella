/**
 * @file    AddComponentPopup.ts
 * @brief   Popup for adding components to entities
 */

import { icons } from '../utils/icons';
import {
    getComponentsByCategory,
    getComponentSchema,
    getInitialComponentData,
    type ComponentSchema,
    type ComponentCategory,
} from '../schemas/ComponentSchemas';
import { checkComponentComposition } from '../schemas/CompositionChecker';

// =============================================================================
// Component Icon Mapping
// =============================================================================

const COMPONENT_ICONS: Record<string, (size: number) => string> = {
    Transform:       (s) => icons.move(s),
    Name:            (s) => icons.type(s),
    Sprite:          (s) => icons.image(s),
    Camera:          (s) => icons.camera(s),
    Canvas:          (s) => icons.scan(s),
    Velocity:        (s) => icons.zap(s),
    SceneOwner:      (s) => icons.folder(s),
    Parent:          (s) => icons.arrowUp(s),
    Children:        (s) => icons.list(s),

    UIRect:          (s) => icons.template(s),
    UIMask:          (s) => icons.eye(s),
    Image:           (s) => icons.image(s),
    Text:            (s) => icons.type(s),
    BitmapText:      (s) => icons.type(s),
    Button:          (s) => icons.pointer(s),
    Toggle:          (s) => icons.toggle(s),
    TextInput:       (s) => icons.pencil(s),
    Interactable:    (s) => icons.pointer(s),
    UIInteraction:   (s) => icons.pointer(s),
    FlexContainer:   (s) => icons.layoutGrid(s),
    FlexItem:        (s) => icons.layoutList(s),
    ScrollView:      (s) => icons.list(s),
    ProgressBar:     (s) => icons.sliders(s),

    RigidBody:       (s) => icons.hexagon(s),
    BoxCollider:     (s) => icons.rect(s),
    CircleCollider:  (s) => icons.circle(s),
    PolygonCollider: (s) => icons.shield(s),

    SpriteAnimator:  (s) => icons.film(s),
    SpineAnimation:  (s) => icons.bone(s),
    TimelinePlayer:  (s) => icons.play(s),
    AudioSource:     (s) => icons.volume(s),
    AudioListener:   (s) => icons.headphones(s),
    ParticleEmitter: (s) => icons.zap(s),
    ShapeRenderer:   (s) => icons.circle(s),
    PostProcessVolume: (s) => icons.palette(s),
    Tilemap:         (s) => icons.grid(s),
    TilemapLayer:    (s) => icons.layers(s),
};

const CATEGORY_FALLBACK_ICONS: Record<string, (size: number) => string> = {
    builtin:  (s) => icons.box(s),
    ui:       (s) => icons.pointer(s),
    physics:  (s) => icons.circle(s),
    script:   (s) => icons.code(s),
    tag:      (s) => icons.tag(s),
};

function getComponentIcon(name: string, category: string, size: number): string {
    const iconFn = COMPONENT_ICONS[name] ?? CATEGORY_FALLBACK_ICONS[category];
    return iconFn ? iconFn(size) : icons.box(size);
}

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
// Recent Components
// =============================================================================

const RECENT_STORAGE_KEY = 'es-recent-components';
const MAX_RECENT = 5;

function getRecentComponents(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function addRecentComponent(name: string): void {
    const recent = getRecentComponents().filter(n => n !== name);
    recent.unshift(name);
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent));
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

    private fuzzyMatch(text: string, pattern: string): { matched: boolean; score: number; indices: number[] } {
        const textLower = text.toLowerCase();
        const patternLower = pattern.toLowerCase();

        const substringIdx = textLower.indexOf(patternLower);
        if (substringIdx >= 0) {
            const indices = Array.from({ length: pattern.length }, (_, i) => substringIdx + i);
            const score = substringIdx === 0 ? 2 : 1;
            return { matched: true, score, indices };
        }

        const indices: number[] = [];
        let pi = 0;
        for (let ti = 0; ti < text.length && pi < patternLower.length; ti++) {
            if (textLower[ti] === patternLower[pi]) {
                indices.push(ti);
                pi++;
            }
        }

        if (pi === patternLower.length) {
            return { matched: true, score: 0, indices };
        }

        return { matched: false, score: -1, indices: [] };
    }

    private highlightByIndices(name: string, indices: number[]): string {
        if (indices.length === 0) return name;
        const indexSet = new Set(indices);
        let result = '';
        let inMark = false;
        for (let i = 0; i < name.length; i++) {
            if (indexSet.has(i) && !inMark) {
                result += '<mark>';
                inMark = true;
            } else if (!indexSet.has(i) && inMark) {
                result += '</mark>';
                inMark = false;
            }
            result += name[i];
        }
        if (inMark) result += '</mark>';
        return result;
    }

    private renderComponentItem(
        schema: ComponentSchema,
        category: ComponentCategory,
        highlightIndices: number[]
    ): string {
        const label = schema.displayName ?? schema.name;
        const displayName = this.highlightByIndices(label, highlightIndices);
        const composition = checkComponentComposition(schema.name, this.options_.existingComponents);
        const disabledClass = composition.allowed ? '' : 'es-disabled';
        const title = composition.reason ?? (schema.description ?? '');
        return `
            <div class="es-component-item ${disabledClass}" data-component="${schema.name}" title="${title}">
                <span class="es-component-icon">${getComponentIcon(schema.name, category, 14)}</span>
                <div class="es-component-text">
                    <span class="es-component-name">${displayName}</span>
                    ${schema.description ? `<span class="es-component-desc">${schema.description}</span>` : ''}
                </div>
            </div>
        `;
    }

    private renderList(filter: string = ''): void {
        if (!this.listContainer_) return;

        this.highlightIndex_ = -1;

        const components = getComponentsByCategory();
        const existing = new Set(this.options_.existingComponents);

        let html = '';

        if (filter) {
            const allSchemas: { schema: ComponentSchema; category: ComponentCategory }[] = [];
            const categories: [ComponentCategory, ComponentSchema[]][] = [
                ['builtin', components.builtin],
                ['ui', components.ui],
                ['physics', components.physics],
                ['script', components.script],
                ['tag', components.tag],
            ];
            for (const [cat, schemas] of categories) {
                for (const s of schemas) {
                    if (!s.hidden && !existing.has(s.name)) {
                        allSchemas.push({ schema: s, category: cat });
                    }
                }
            }

            const matches: { schema: ComponentSchema; category: ComponentCategory; score: number; indices: number[] }[] = [];
            for (const { schema, category } of allSchemas) {
                const label = schema.displayName ?? schema.name;
                const result = this.fuzzyMatch(label, filter);
                if (result.matched) {
                    matches.push({ schema, category, score: result.score, indices: result.indices });
                }
            }

            matches.sort((a, b) => b.score - a.score);

            for (const { schema, category, indices } of matches) {
                html += this.renderComponentItem(schema, category, indices);
            }
        } else {
            const renderCategory = (
                category: ComponentCategory,
                label: string,
                schemas: ComponentSchema[]
            ) => {
                const filtered = schemas.filter(s => !s.hidden && !existing.has(s.name));
                if (filtered.length === 0) return '';

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
                    categoryHtml += this.renderComponentItem(schema, category, []);
                }

                categoryHtml += `
                        </div>
                    </div>
                `;
                return categoryHtml;
            };

            const recentNames = getRecentComponents().filter(n => !existing.has(n));
            if (recentNames.length > 0) {
                let recentHtml = `
                    <div class="es-component-category es-recent-category">
                        <div class="es-category-header">
                            <span class="es-category-chevron">${icons.rotateCw(12)}</span>
                            <span class="es-category-label">Recent</span>
                        </div>
                        <div class="es-category-items">
                `;
                for (const name of recentNames) {
                    const schema = getComponentSchema(name);
                    if (schema && !schema.hidden) {
                        recentHtml += this.renderComponentItem(schema, schema.category, []);
                    }
                }
                recentHtml += `
                        </div>
                    </div>
                `;
                html += recentHtml;
            }

            html += renderCategory('builtin', 'Built-in', components.builtin);
            html += renderCategory('ui', 'UI', components.ui);
            html += renderCategory('physics', 'Physics', components.physics);
            html += renderCategory('script', 'Scripts', components.script);
            html += renderCategory('tag', 'Tags', components.tag);
        }

        if (!html.trim()) {
            html = `<div class="es-no-components">
                No matching components
                ${filter ? '<button class="es-btn es-btn-clear-search">Clear search</button>' : ''}
            </div>`;
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

        this.container_.addEventListener('click', (e) => {
            const clearBtn = (e.target as HTMLElement).closest('.es-btn-clear-search');
            if (clearBtn && this.searchInput_) {
                this.searchInput_.value = '';
                this.renderList();
                this.searchInput_.focus();
                return;
            }
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
                if (name) this.selectComponent(name);
            }
        });

        document.addEventListener('keydown', this.handleKeyDown);
        setTimeout(() => this.searchInput_?.focus(), 0);
    }

    private selectComponent(name: string): void {
        const composition = checkComponentComposition(name, this.options_.existingComponents);
        if (!composition.allowed) return;
        if (composition.autoAdd) {
            for (const dep of composition.autoAdd) {
                this.options_.onSelect(dep);
            }
        }
        addRecentComponent(name);
        this.options_.onSelect(name);
        this.options_.onClose();
    }

    private getVisibleItems(): HTMLElement[] {
        if (!this.listContainer_) return [];
        return Array.from(
            this.listContainer_.querySelectorAll(
                '.es-category-items:not(.es-hidden) > .es-component-item, .es-add-component-list > .es-component-item'
            )
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
                if (name) this.selectComponent(name);
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
// Anchored Popup Helper
// =============================================================================

let activePopupCleanup: (() => void) | null = null;

export function showAddComponentPopup(
    anchor: HTMLElement,
    existingComponents: string[],
    onSelect: (componentName: string) => void
): void {
    if (activePopupCleanup) {
        activePopupCleanup();
        activePopupCleanup = null;
        return;
    }

    const container = document.createElement('div');
    container.className = 'es-popup-container es-popup-anchored';
    document.body.appendChild(container);

    const positionPanel = () => {
        const rect = anchor.getBoundingClientRect();
        const panelHeight = container.offsetHeight;
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const gap = 4;
        const margin = 5;

        const width = Math.max(rect.width, 320);
        let left = rect.left;
        if (left + width > window.innerWidth - margin) {
            left = window.innerWidth - width - margin;
        }
        if (left < margin) {
            left = margin;
        }

        container.style.left = `${left}px`;
        container.style.width = `${width}px`;

        if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
            container.style.top = `${rect.bottom + gap}px`;
            container.style.bottom = '';
            container.style.maxHeight = `${spaceBelow - gap - margin}px`;
            container.classList.remove('es-popup-above');
        } else {
            container.style.bottom = `${window.innerHeight - rect.top + gap}px`;
            container.style.top = '';
            container.style.maxHeight = `${spaceAbove - gap - margin}px`;
            container.classList.add('es-popup-above');
        }
    };

    const close = () => {
        container.classList.remove('es-popup-visible');
        container.addEventListener('transitionend', () => {
            popup.dispose();
            container.remove();
        }, { once: true });
        setTimeout(() => {
            popup.dispose();
            container.remove();
        }, 200);
        document.removeEventListener('mousedown', onClickOutside, true);
        activePopupCleanup = null;
    };

    const onClickOutside = (e: MouseEvent) => {
        if (!container.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
            close();
        }
    };

    activePopupCleanup = close;

    const popup = new AddComponentPopup(container, {
        existingComponents,
        onSelect,
        onClose: close,
    });

    positionPanel();
    requestAnimationFrame(() => container.classList.add('es-popup-visible'));
    document.addEventListener('mousedown', onClickOutside, true);
}
