import type { PanelInstance } from './PanelRegistry';
import { icons } from '../utils/icons';

type OutputType = 'command' | 'stdout' | 'stderr' | 'error' | 'success';

const MAX_LINES = 5000;

const TYPE_LABELS: Record<OutputType, string> = {
    command: 'Cmd',
    stdout: 'Out',
    stderr: 'Warn',
    error: 'Error',
    success: 'OK',
};

interface LogEntry {
    text: string;
    type: OutputType;
    timestamp: string;
    el: HTMLElement;
    repeatCount: number;
    groupId: string;
}

function formatTimestamp(): string {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

export class OutputPanel implements PanelInstance {
    private container_: HTMLElement;
    private contentEl_: HTMLElement | null = null;
    private entries_: LogEntry[] = [];
    private lastEntry_: LogEntry | null = null;
    private autoScroll_ = true;
    private searchText_ = '';
    private activeFilters_ = new Set<OutputType>(['command', 'stdout', 'stderr', 'error', 'success']);
    private typeCounts_ = new Map<OutputType, number>();
    private currentGroupId_ = '';
    private groupHeaders_ = new Map<string, HTMLElement>();
    private collapsedGroups_ = new Set<string>();
    private filterBtns_ = new Map<OutputType, HTMLElement>();
    private scrollBtn_: HTMLElement | null = null;
    private searchInput_: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.render();
    }

    appendOutput(text: string, type: OutputType): void {
        if (!this.contentEl_) return;

        const empty = this.contentEl_.querySelector('.es-output-empty');
        if (empty) empty.remove();

        if (type === 'command') {
            this.currentGroupId_ = text;
        }

        if (
            this.lastEntry_ &&
            text === this.lastEntry_.text &&
            type === this.lastEntry_.type
        ) {
            this.lastEntry_.repeatCount++;
            let badge = this.lastEntry_.el.querySelector('.es-output-badge') as HTMLElement;
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'es-output-badge';
                this.lastEntry_.el.prepend(badge);
            }
            badge.textContent = String(this.lastEntry_.repeatCount);
            this.scrollIfNeeded();
            return;
        }

        const timestamp = formatTimestamp();
        const groupId = this.currentGroupId_;

        if (type === 'command' && groupId && !this.groupHeaders_.has(groupId)) {
            const header = document.createElement('div');
            header.className = 'es-output-group-header';
            header.innerHTML = `<span class="es-output-group-toggle">${icons.chevronDown(10)}</span>`;
            header.addEventListener('click', () => this.toggleGroup(groupId));
            this.contentEl_.appendChild(header);
            this.groupHeaders_.set(groupId, header);
        }

        const line = document.createElement('div');
        line.className = `es-output-line es-output-${type}`;
        if (groupId && type !== 'command') {
            line.dataset.group = groupId;
        }

        const tsSpan = document.createElement('span');
        tsSpan.className = 'es-output-timestamp';
        tsSpan.textContent = timestamp;
        line.appendChild(tsSpan);

        const textNode = document.createTextNode(text);
        line.appendChild(textNode);

        const entry: LogEntry = {
            text,
            type,
            timestamp,
            el: line,
            repeatCount: 1,
            groupId,
        };

        this.entries_.push(entry);
        this.lastEntry_ = entry;

        this.typeCounts_.set(type, (this.typeCounts_.get(type) ?? 0) + 1);
        this.updateFilterBadge(type);

        if (this.entries_.length > MAX_LINES) {
            this.trimOldest();
        }

        const visible = this.isEntryVisible(entry);
        if (!visible) {
            line.style.display = 'none';
        }

        if (groupId && type !== 'command' && this.collapsedGroups_.has(groupId)) {
            line.style.display = 'none';
        }

        this.contentEl_.appendChild(line);
        this.scrollIfNeeded();

        line.addEventListener('contextmenu', (e) => this.showContextMenu(e, entry));
    }

    clear(): void {
        if (!this.contentEl_) return;
        this.contentEl_.innerHTML = '<div class="es-output-empty">No output messages</div>';
        this.entries_ = [];
        this.lastEntry_ = null;
        this.typeCounts_.clear();
        this.currentGroupId_ = '';
        this.groupHeaders_.clear();
        this.collapsedGroups_.clear();
        for (const type of Object.keys(TYPE_LABELS) as OutputType[]) {
            this.updateFilterBadge(type);
        }
    }

    dispose(): void {
        this.container_.innerHTML = '';
    }

    private render(): void {
        this.container_.innerHTML = `
            <div class="es-output-panel">
                <div class="es-output-header">
                    <div class="es-output-toolbar">
                        <div class="es-output-filters"></div>
                        <div class="es-output-search-wrap">
                            <input type="text" class="es-output-search" placeholder="Filter output..." spellcheck="false" />
                        </div>
                    </div>
                    <div class="es-output-actions">
                        <button class="es-btn es-btn-icon es-output-scroll-btn es-active" data-action="toggle-scroll" title="Auto-scroll">${icons.arrowDown(12)}</button>
                        <button class="es-btn es-btn-icon" data-action="clear-output" title="Clear">${icons.trash(12)}</button>
                    </div>
                </div>
                <div class="es-output-content" role="log" aria-live="polite">
                    <div class="es-output-empty">No output messages</div>
                </div>
            </div>
        `;

        this.contentEl_ = this.container_.querySelector('.es-output-content');

        const filtersEl = this.container_.querySelector('.es-output-filters')!;
        for (const type of Object.keys(TYPE_LABELS) as OutputType[]) {
            const btn = document.createElement('button');
            btn.className = `es-btn es-btn-icon es-output-filter-btn es-active es-output-filter-${type}`;
            btn.title = `Toggle ${type}`;
            btn.innerHTML = `${TYPE_LABELS[type]} <span class="es-output-filter-count">0</span>`;
            btn.addEventListener('click', () => this.toggleFilter(type));
            filtersEl.appendChild(btn);
            this.filterBtns_.set(type, btn);
        }

        this.scrollBtn_ = this.container_.querySelector('[data-action="toggle-scroll"]');
        this.scrollBtn_?.addEventListener('click', () => this.toggleAutoScroll());

        this.searchInput_ = this.container_.querySelector('.es-output-search');
        this.searchInput_?.addEventListener('input', (e) => {
            this.searchText_ = (e.target as HTMLInputElement).value.toLowerCase();
            this.applyFilters();
        });

        const clearBtn = this.container_.querySelector('[data-action="clear-output"]');
        clearBtn?.addEventListener('click', () => this.clear());

        this.contentEl_?.addEventListener('scroll', () => {
            if (!this.contentEl_) return;
            const { scrollTop, scrollHeight, clientHeight } = this.contentEl_;
            const atBottom = scrollHeight - scrollTop - clientHeight < 30;
            if (atBottom && !this.autoScroll_) {
                this.autoScroll_ = true;
                this.scrollBtn_?.classList.add('es-active');
            } else if (!atBottom && this.autoScroll_) {
                this.autoScroll_ = false;
                this.scrollBtn_?.classList.remove('es-active');
            }
        });
    }

    private toggleFilter(type: OutputType): void {
        const btn = this.filterBtns_.get(type);
        if (this.activeFilters_.has(type)) {
            this.activeFilters_.delete(type);
            btn?.classList.remove('es-active');
        } else {
            this.activeFilters_.add(type);
            btn?.classList.add('es-active');
        }
        this.applyFilters();
    }

    private toggleAutoScroll(): void {
        this.autoScroll_ = !this.autoScroll_;
        if (this.autoScroll_) {
            this.scrollBtn_?.classList.add('es-active');
            this.scrollIfNeeded();
        } else {
            this.scrollBtn_?.classList.remove('es-active');
        }
    }

    private toggleGroup(groupId: string): void {
        const header = this.groupHeaders_.get(groupId);
        if (!header) return;

        if (this.collapsedGroups_.has(groupId)) {
            this.collapsedGroups_.delete(groupId);
            header.classList.remove('es-collapsed');
        } else {
            this.collapsedGroups_.add(groupId);
            header.classList.add('es-collapsed');
        }

        for (const entry of this.entries_) {
            if (entry.groupId === groupId && entry.type !== 'command') {
                const hidden = this.collapsedGroups_.has(groupId) || !this.isEntryVisible(entry);
                entry.el.style.display = hidden ? 'none' : '';
            }
        }
    }

    private isEntryVisible(entry: LogEntry): boolean {
        if (!this.activeFilters_.has(entry.type)) return false;
        if (this.searchText_ && !entry.text.toLowerCase().includes(this.searchText_)) return false;
        return true;
    }

    private applyFilters(): void {
        for (const entry of this.entries_) {
            const visible = this.isEntryVisible(entry);
            const collapsed = entry.groupId &&
                entry.type !== 'command' &&
                this.collapsedGroups_.has(entry.groupId);
            entry.el.style.display = (!visible || collapsed) ? 'none' : '';
        }
    }

    private updateFilterBadge(type: OutputType): void {
        const btn = this.filterBtns_.get(type);
        if (!btn) return;
        const count = this.typeCounts_.get(type) ?? 0;
        const badge = btn.querySelector('.es-output-filter-count') as HTMLElement;
        if (badge) badge.textContent = String(count);
    }

    private trimOldest(): void {
        const excess = this.entries_.length - MAX_LINES;
        for (let i = 0; i < excess; i++) {
            const entry = this.entries_[i];
            entry.el.remove();
            const count = (this.typeCounts_.get(entry.type) ?? 1) - 1;
            if (count <= 0) {
                this.typeCounts_.delete(entry.type);
            } else {
                this.typeCounts_.set(entry.type, count);
            }
            this.updateFilterBadge(entry.type);
        }
        this.entries_.splice(0, excess);
    }

    private scrollIfNeeded(): void {
        if (this.autoScroll_ && this.contentEl_) {
            this.contentEl_.scrollTop = this.contentEl_.scrollHeight;
        }
    }

    private showContextMenu(e: MouseEvent, entry: LogEntry): void {
        e.preventDefault();
        const existing = document.querySelector('.es-output-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'es-output-context-menu';
        menu.innerHTML = `
            <div class="es-output-context-item" data-action="copy-line">Copy Line</div>
            <div class="es-output-context-item" data-action="copy-all">Copy All</div>
        `;

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        document.body.appendChild(menu);

        const copyLine = menu.querySelector('[data-action="copy-line"]');
        copyLine?.addEventListener('click', () => {
            navigator.clipboard.writeText(`[${entry.timestamp}] ${entry.text}`);
            menu.remove();
        });

        const copyAll = menu.querySelector('[data-action="copy-all"]');
        copyAll?.addEventListener('click', () => {
            const allText = this.entries_
                .filter(e => this.isEntryVisible(e))
                .map(e => `[${e.timestamp}] ${e.text}`)
                .join('\n');
            navigator.clipboard.writeText(allText);
            menu.remove();
        });

        const dismiss = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener('click', dismiss);
            }
        };
        setTimeout(() => document.addEventListener('click', dismiss), 0);
    }
}
