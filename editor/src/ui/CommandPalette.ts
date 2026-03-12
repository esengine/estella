import type { Entity } from 'esengine';
import { icons } from '../utils/icons';
import { fuzzyMatch } from '../utils/fuzzy';
import { getEditorStore } from '../store';
import { getAllMenus, getMenuItems } from '../menus/MenuRegistry';
import { getAssetDatabase } from '../asset/AssetDatabase';
import { getNavigationService } from '../services';

type ResultKind = 'entity' | 'asset' | 'action';

interface PaletteResult {
    kind: ResultKind;
    label: string;
    detail?: string;
    icon: string;
    score: number;
    matches: number[];
    execute: () => void;
}

const MAX_RESULTS = 20;

let activeInstance: CommandPaletteInstance | null = null;

class CommandPaletteInstance {
    private overlay_: HTMLElement;
    private input_: HTMLInputElement;
    private list_: HTMLElement;
    private results_: PaletteResult[] = [];
    private highlightIndex_ = 0;

    constructor() {
        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-command-palette-overlay';
        this.overlay_.innerHTML = `
            <div class="es-command-palette">
                <div class="es-command-palette-input-row">
                    <span class="es-command-palette-icon">${icons.search(14)}</span>
                    <input type="text" class="es-command-palette-input" placeholder="Search entities, assets, actions..." />
                </div>
                <div class="es-command-palette-list"></div>
            </div>
        `;

        this.input_ = this.overlay_.querySelector('.es-command-palette-input')!;
        this.list_ = this.overlay_.querySelector('.es-command-palette-list')!;

        this.input_.addEventListener('input', () => this.onInput());
        this.overlay_.addEventListener('mousedown', (e) => {
            if (e.target === this.overlay_) this.close();
        });
        this.list_.addEventListener('click', (e) => {
            const item = (e.target as HTMLElement).closest('.es-command-palette-item') as HTMLElement;
            if (item) {
                const idx = parseInt(item.dataset.index ?? '', 10);
                if (!isNaN(idx) && idx < this.results_.length) {
                    this.results_[idx].execute();
                    this.close();
                }
            }
        });
        document.addEventListener('keydown', this.onKeyDown_);

        document.body.appendChild(this.overlay_);
        requestAnimationFrame(() => this.input_.focus());
        this.onInput();
    }

    private onInput(): void {
        const query = this.input_.value.trim();
        this.results_ = this.search(query);
        this.highlightIndex_ = 0;
        this.renderList();
    }

    private search(query: string): PaletteResult[] {
        const results: PaletteResult[] = [];

        const store = getEditorStore();
        for (const entity of store.scene.entities) {
            const m = fuzzyMatch(query, entity.name);
            if (m) {
                results.push({
                    kind: 'entity',
                    label: entity.name,
                    detail: entity.parent !== null ? 'Entity' : 'Root Entity',
                    icon: icons.box(14),
                    score: m.score + 2,
                    matches: m.matches,
                    execute: () => store.selectEntity(entity.id as Entity, 'replace'),
                });
            }
        }

        const db = getAssetDatabase();
        if (db) {
            for (const entry of db.getAllEntries()) {
                const name = entry.path.split('/').pop() ?? entry.path;
                const m = fuzzyMatch(query, name);
                if (m) {
                    results.push({
                        kind: 'asset',
                        label: name,
                        detail: entry.type,
                        icon: icons.file(14),
                        score: m.score,
                        matches: m.matches,
                        execute: () => getNavigationService().navigateToAsset(entry.path),
                    });
                }
            }
        }

        const menus = getAllMenus();
        for (const menu of menus) {
            const items = getMenuItems(menu.id);
            for (const item of items) {
                if (item.hidden) continue;
                if (item.enabled && !item.enabled()) continue;
                const m = fuzzyMatch(query, item.label);
                if (m) {
                    results.push({
                        kind: 'action',
                        label: item.label,
                        detail: item.shortcut ? `${menu.label} · ${item.shortcut}` : menu.label,
                        icon: icons.cog(14),
                        score: m.score + 1,
                        matches: m.matches,
                        execute: () => item.action(),
                    });
                }
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, MAX_RESULTS);
    }

    private renderList(): void {
        if (this.results_.length === 0) {
            this.list_.innerHTML = '<div class="es-command-palette-empty">No results</div>';
            return;
        }

        this.list_.innerHTML = this.results_.map((r, i) => {
            const highlighted = i === this.highlightIndex_ ? ' es-highlighted' : '';
            const kindClass = `es-kind-${r.kind}`;
            return `<div class="es-command-palette-item${highlighted} ${kindClass}" data-index="${i}">
                <span class="es-command-palette-item-icon">${r.icon}</span>
                <span class="es-command-palette-item-label">${this.highlightMatches(r.label, r.matches)}</span>
                ${r.detail ? `<span class="es-command-palette-item-detail">${r.detail}</span>` : ''}
            </div>`;
        }).join('');
    }

    private highlightMatches(text: string, matches: number[]): string {
        if (matches.length === 0) return text;
        const set = new Set(matches);
        let result = '';
        for (let i = 0; i < text.length; i++) {
            if (set.has(i)) {
                result += `<mark>${text[i]}</mark>`;
            } else {
                result += text[i];
            }
        }
        return result;
    }

    private onKeyDown_ = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.highlightIndex_ = (this.highlightIndex_ + 1) % Math.max(1, this.results_.length);
            this.renderList();
            this.scrollToHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.highlightIndex_ = this.highlightIndex_ > 0
                ? this.highlightIndex_ - 1
                : this.results_.length - 1;
            this.renderList();
            this.scrollToHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.highlightIndex_ >= 0 && this.highlightIndex_ < this.results_.length) {
                this.results_[this.highlightIndex_].execute();
                this.close();
            }
        }
    };

    private scrollToHighlight(): void {
        const item = this.list_.querySelector('.es-highlighted');
        item?.scrollIntoView({ block: 'nearest' });
    }

    close(): void {
        document.removeEventListener('keydown', this.onKeyDown_);
        this.overlay_.remove();
        activeInstance = null;
    }
}

export function showCommandPalette(): void {
    if (activeInstance) {
        activeInstance.close();
        return;
    }
    activeInstance = new CommandPaletteInstance();
}
