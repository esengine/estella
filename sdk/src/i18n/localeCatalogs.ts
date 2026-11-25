// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { LocaleCatalog, LocaleEntry, LocaleTableAsset } from './Localization';

interface InlineCatalog {
    first: number;
    entries: Map<string, { order: number; value: LocaleEntry }>;
}

type CatalogLayer =
    | { order: number; locale: string; inline: InlineCatalog }
    | { order: number; tables: LocaleTableAsset[] };

/** A file can replace its translations as a unit. Code can still override individual keys. */
export class LocaleCatalogs {
    private clock = 0;
    private readonly inline = new Map<string, InlineCatalog>();
    private readonly files = new Map<string, { order: number; table: LocaleTableAsset; direct: boolean }>();
    private project?: { owner: object; order: number; refs: readonly string[]; members: Set<string> };
    private resolved?: Map<string, Map<string, LocaleEntry>>;

    constructor(private readonly changed: () => void) {}

    add(locale: string, entries: LocaleCatalog): void {
        const order = ++this.clock;
        const catalog = this.inline.get(locale) ?? { first: order, entries: new Map() };
        this.inline.set(locale, catalog);
        for (const [key, value] of Object.entries(entries)) catalog.entries.set(key, { order, value });
        this.invalidate();
    }

    /** Reserve a direct load's precedence before its read starts. Failed reads retain no data. */
    prepare(ref: string, owner: object): (table: LocaleTableAsset) => void {
        const group = this.project?.members.has(ref) ? this.project : undefined;
        const order = this.files.get(ref)?.order ?? group?.order ?? ++this.clock;
        return table => {
            const current = this.project?.members.has(ref);
            if ((group && !current) || (current && this.project?.owner !== owner)) return;
            if (this.files.get(ref)?.table === table) return;
            this.files.set(ref, { order, table, direct: this.files.get(ref)?.direct === true || !group });
            this.invalidate();
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

    private invalidate(): void { this.resolved = undefined; this.changed(); }

    read(): ReadonlyMap<string, ReadonlyMap<string, LocaleEntry>> {
        if (this.resolved) return this.resolved;
        const project = this.project;
        const layers: CatalogLayer[] = [...this.inline].map(([locale, inline]) => ({ order: inline.first, locale, inline }));
        for (const [ref, file] of this.files) {
            if (!project?.members.has(ref)) layers.push({ order: file.order, tables: [file.table] });
        }
        if (project) {
            const tables: LocaleTableAsset[] = [];
            for (const ref of project.refs) {
                const file = this.files.get(ref);
                if (file) tables.push(file.table);
            }
            layers.push({ order: project.order, tables });
        }
        // First appearance determines locale fallback. Each key still honors later writes from code.
        const resolved = new Map<string, Map<string, LocaleEntry>>();
        const entriesFor = (locale: string) => {
            let entries = resolved.get(locale);
            if (!entries) resolved.set(locale, entries = new Map());
            return entries;
        };
        for (const layer of layers.sort((a, b) => a.order - b.order)) {
            if ('inline' in layer) {
                const target = entriesFor(layer.locale);
                for (const [key, { value }] of layer.inline.entries) target.set(key, value);
            } else {
                for (const table of layer.tables) {
                    const target = entriesFor(table.locale);
                    const inline = this.inline.get(table.locale);
                    for (const [key, value] of Object.entries(table.entries)) {
                        if ((inline?.entries.get(key)?.order ?? 0) <= layer.order) target.set(key, value);
                    }
                }
            }
        }
        return this.resolved = resolved;
    }
}
