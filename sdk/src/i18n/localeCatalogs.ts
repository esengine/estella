// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { LocaleCatalog, LocaleEntry, LocaleTableAsset } from './Localization';

interface InlineCatalog {
    first: number;
    entries: Map<string, { order: number; value: LocaleEntry }>;
}

interface CatalogLayer { order: number; locale: string; table?: LocaleTableAsset }
interface FileLayer { order: number; table: LocaleTableAsset }
interface LanguageFiles { files: FileLayer[]; probesLeft?: number }

const sizes = new WeakMap<LocaleTableAsset, number>();

/** The loader reports this count. Reuse it to bound the cost of searching many files. */
export function localeTableKeyCount(table: LocaleTableAsset): number {
    let count = sizes.get(table);
    if (count === undefined) {
        count = Object.keys(table.entries).length;
        sizes.set(table, count);
    }
    return count;
}

/** A file can replace its translations as a unit. Code can still override individual keys. */
export class LocaleCatalogs {
    private clock = 0;
    private readonly inline = new Map<string, InlineCatalog>();
    private readonly files = new Map<string, { order: number; table: LocaleTableAsset; direct: boolean }>();
    private project?: { owner: object; order: number; refs: readonly string[]; members: Set<string> };
    private layers?: Map<string, LanguageFiles>;
    private readonly indexed = new Map<string, Map<string, LocaleEntry>>();

    constructor(private readonly changed: (locale?: string, previousLocale?: string) => void) {}

    add(locale: string, entries: LocaleCatalog): void {
        const order = ++this.clock;
        const catalog = this.inline.get(locale) ?? { first: order, entries: new Map() };
        this.inline.set(locale, catalog);
        for (const [key, value] of Object.entries(entries)) catalog.entries.set(key, { order, value });
        this.invalidate(locale);
    }

    /** Reserve a direct load's precedence before its read starts. Failed reads retain no data. */
    prepare(ref: string, owner: object): (table: LocaleTableAsset) => void {
        const group = this.project?.members.has(ref) ? this.project : undefined;
        const order = this.files.get(ref)?.order ?? group?.order ?? ++this.clock;
        return table => {
            const current = this.project?.members.has(ref);
            if ((group && !current) || (current && this.project?.owner !== owner)) return;
            const previous = this.files.get(ref);
            if (previous?.table === table) return;
            this.files.set(ref, { order, table, direct: previous?.direct === true || !group });
            this.invalidate(table.locale, previous?.table.locale);
        };
    }

    setProject(owner: object, refs: readonly string[]): void {
        const previous = this.project;
        if (!previous && !refs.length) return;
        if (previous?.owner === owner && refs.length === previous.refs.length && refs.every((ref, i) => ref === previous.refs[i])) return;
        const members = new Set(refs);
        for (const ref of previous?.refs ?? []) {
            if ((previous?.owner !== owner || !members.has(ref)) && !this.files.get(ref)?.direct) this.files.delete(ref);
        }
        this.project = { owner, order: previous?.order ?? ++this.clock, refs, members };
        this.invalidate();
    }

    clearProject(owner: object): void {
        if (this.project?.owner !== owner) return;
        this.setProject(owner, []);
        this.project = undefined;
    }

    /** A new Localization resource can adopt a slot that Assets already holds. */
    usePublished(owner: object, ref: string, table: LocaleTableAsset): void {
        if (this.project?.owner === owner && this.project.members.has(ref) && this.files.get(ref)?.table !== table) {
            this.prepare(ref, owner)(table);
        }
    }

    /** A registry refresh updates only the files this service has already adopted. */
    refreshPublished(owner: object, ref: string, previous: unknown, table: LocaleTableAsset): void {
        if (previous && this.files.get(ref)?.table === previous) this.prepare(ref, owner)(table);
    }

    /** The direct load API merges a table into this service beyond the lifetime of a project pin. */
    keepDirect(owner: object, ref: string, table: LocaleTableAsset): void {
        if (this.files.get(ref)?.table !== table) this.prepare(ref, owner)(table);
        const file = this.files.get(ref);
        if (file?.table === table && !file.direct) {
            file.direct = true;
            file.order = ++this.clock;
        }
    }

    private invalidate(locale?: string, previousLocale?: string): void {
        this.layers = undefined;
        if (locale === undefined) this.indexed.clear();
        else this.indexed.delete(locale);
        if (previousLocale !== undefined) this.indexed.delete(previousLocale);
        this.changed(locale, previousLocale);
    }

    /** Index the order of sources without traversing their translations. Project tables
     *  have equal precedence and keep their configured order in the stable sort. */
    private byLocale(): Map<string, LanguageFiles> {
        if (this.layers) return this.layers;
        const project = this.project;
        const layers: CatalogLayer[] = [...this.inline].map(([locale, inline]) => ({ order: inline.first, locale }));
        for (const [ref, file] of this.files) {
            if (!project?.members.has(ref)) layers.push({ order: file.order, locale: file.table.locale, table: file.table });
        }
        if (project) {
            for (const ref of project.refs) {
                const file = this.files.get(ref);
                if (file) layers.push({ order: project.order, locale: file.table.locale, table: file.table });
            }
        }
        const groups = new Map<string, LanguageFiles>();
        for (const layer of layers.sort((a, b) => a.order - b.order)) {
            let group = groups.get(layer.locale);
            if (!group) groups.set(layer.locale, group = { files: [] });
            if (layer.table) group.files.push({ order: layer.order, table: layer.table });
        }
        return this.layers = groups;
    }

    locales(): string[] { return [...this.byLocale().keys()]; }

    private indexLanguage(locale: string, files: readonly FileLayer[]): Map<string, LocaleEntry> {
        const entries = new Map<string, LocaleEntry>();
        const inline = this.inline.get(locale)?.entries;
        if (inline) for (const [key, entry] of inline) entries.set(key, entry.value);
        for (const { table, order } of files) {
            for (const key of Object.keys(table.entries)) {
                if (!inline || (inline.get(key)?.order ?? 0) <= order) entries.set(key, table.entries[key]);
            }
        }
        this.indexed.set(locale, entries);
        return entries;
    }

    get(locale: string, key: string): LocaleEntry | undefined {
        const indexed = this.indexed.get(locale);
        if (indexed) return indexed.get(key);
        const inline = this.inline.get(locale)?.entries.get(key);
        const group = this.byLocale().get(locale);
        if (!group) return inline?.value;
        const layers = group.files;
        // A single file already has its own key index. For split languages, search directly
        // until accumulated file probes reach the cost of indexing all their keys once.
        if (layers.length > 1) {
            group.probesLeft ??= layers.reduce((sum, layer) => sum + localeTableKeyCount(layer.table), 0);
            if (group.probesLeft <= 0) return this.indexLanguage(locale, layers).get(key);
        }
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            if (inline && inline.order > layer.order) break;
            if (group.probesLeft !== undefined) group.probesLeft--;
            const entries = layer.table.entries;
            if (Object.prototype.hasOwnProperty.call(entries, key)) return entries[key];
        }
        return inline?.value;
    }
}
