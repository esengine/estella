export type SettingsItemType = 'boolean' | 'number' | 'string' | 'color' | 'select' | 'range';

export interface SettingsSectionDescriptor {
    id: string;
    title: string;
    icon?: string;
    order?: number;
}

export interface SettingsGroupDescriptor {
    id: string;
    section: string;
    label: string;
    order?: number;
    collapsed?: boolean;
}

export interface SettingsItemDescriptor {
    id: string;
    section: string;
    label: string;
    description?: string;
    type: SettingsItemType;
    defaultValue: unknown;
    order?: number;
    options?: { label: string; value: string }[];
    min?: number;
    max?: number;
    step?: number;
    onChange?: (value: unknown) => void;
    visibleWhen?: { settingId: string; value: unknown };
    group?: string;
    tags?: string[];
    projectSync?: boolean;
}

type SettingsChangeListener = (id: string, value: unknown) => void;

const STORAGE_KEY = 'esengine_settings';

const sections_ = new Map<string, SettingsSectionDescriptor>();
const groups_ = new Map<string, SettingsGroupDescriptor>();
const items_ = new Map<string, SettingsItemDescriptor>();
const values_ = new Map<string, unknown>();
const listeners_: SettingsChangeListener[] = [];
let builtinSectionIds_: Set<string> | null = null;
let builtinItemIds_: Set<string> | null = null;

const LEGACY_GIZMO_KEY = 'esengine_gizmo_settings';

const LEGACY_KEY_MAP: Record<string, string> = {
    showGrid: 'scene.showGrid',
    gridColor: 'scene.gridColor',
    gridOpacity: 'scene.gridOpacity',
    showGizmos: 'scene.showGizmos',
    showSelectionBox: 'scene.showSelectionBox',
};

function migrateLegacySettings(): void {
    try {
        const raw = localStorage.getItem(LEGACY_GIZMO_KEY);
        if (!raw) return;
        const data = JSON.parse(raw) as Record<string, unknown>;
        for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
            if (oldKey in data && !values_.has(newKey)) {
                values_.set(newKey, data[oldKey]);
            }
        }
        localStorage.removeItem(LEGACY_GIZMO_KEY);
        saveToStorage();
    } catch { /* ignore */ }
}

function loadFromStorage(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw) as Record<string, unknown>;
            for (const [key, value] of Object.entries(data)) {
                values_.set(key, value);
            }
        }
    } catch { /* ignore */ }
}

function saveToStorage(): void {
    try {
        const data: Record<string, unknown> = {};
        for (const [key, value] of values_) {
            data[key] = value;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

loadFromStorage();
migrateLegacySettings();

export function registerSettingsSection(descriptor: SettingsSectionDescriptor): void {
    sections_.set(descriptor.id, descriptor);
}

export function registerSettingsGroup(descriptor: SettingsGroupDescriptor): void {
    groups_.set(descriptor.id, descriptor);
}

export function registerSettingsItem(descriptor: SettingsItemDescriptor): void {
    items_.set(descriptor.id, descriptor);
    if (!values_.has(descriptor.id)) {
        values_.set(descriptor.id, descriptor.defaultValue);
    }
}

export function getSettingsValue<T = unknown>(id: string): T {
    if (values_.has(id)) return values_.get(id) as T;
    const item = items_.get(id);
    return (item?.defaultValue ?? undefined) as T;
}

export function setSettingsValue(id: string, value: unknown): void {
    const prev = values_.get(id);
    if (prev === value) return;

    values_.set(id, value);
    saveToStorage();

    const item = items_.get(id);
    item?.onChange?.(value);

    for (const listener of listeners_) {
        listener(id, value);
    }
}

export function onSettingsChange(listener: SettingsChangeListener): () => void {
    listeners_.push(listener);
    return () => {
        const idx = listeners_.indexOf(listener);
        if (idx >= 0) listeners_.splice(idx, 1);
    };
}

export function getAllSections(): SettingsSectionDescriptor[] {
    return [...sections_.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getSectionItems(sectionId: string): SettingsItemDescriptor[] {
    return [...items_.values()]
        .filter(item => item.section === sectionId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getSectionGroups(sectionId: string): SettingsGroupDescriptor[] {
    return [...groups_.values()]
        .filter(g => g.section === sectionId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getGroupItems(groupId: string): SettingsItemDescriptor[] {
    return [...items_.values()]
        .filter(item => item.group === groupId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getUngroupedSectionItems(sectionId: string): SettingsItemDescriptor[] {
    return [...items_.values()]
        .filter(item => item.section === sectionId && !item.group)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function searchSettings(query: string): SettingsItemDescriptor[] {
    const q = query.toLowerCase();
    return [...items_.values()].filter(item => {
        if (item.label.toLowerCase().includes(q)) return true;
        if (item.description?.toLowerCase().includes(q)) return true;
        if (item.tags?.some(t => t.toLowerCase().includes(q))) return true;
        const section = sections_.get(item.section);
        if (section?.title.toLowerCase().includes(q)) return true;
        return false;
    });
}

export function sectionHasModifiedValues(sectionId: string): boolean {
    const sectionItems = getSectionItems(sectionId);
    return sectionItems.some(item => {
        const current = getSettingsValue(item.id);
        return current !== item.defaultValue;
    });
}

export function resetSection(sectionId: string): void {
    const sectionItems = getSectionItems(sectionId);
    for (const item of sectionItems) {
        setSettingsValue(item.id, item.defaultValue);
    }
}

export function exportSettings(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const item of items_.values()) {
        const value = getSettingsValue(item.id);
        if (value !== item.defaultValue) {
            result[item.id] = value;
        }
    }
    return result;
}

export function importSettings(data: Record<string, unknown>): void {
    for (const [id, value] of Object.entries(data)) {
        if (items_.has(id)) {
            setSettingsValue(id, value);
        }
    }
}

export function getItemDescriptor(id: string): SettingsItemDescriptor | undefined {
    return items_.get(id);
}

export function getGroupDescriptor(id: string): SettingsGroupDescriptor | undefined {
    return groups_.get(id);
}

export function lockBuiltinSettings(): void {
    builtinSectionIds_ = new Set(sections_.keys());
    builtinItemIds_ = new Set(items_.keys());
}

export function clearExtensionSettings(): void {
    if (!builtinSectionIds_ || !builtinItemIds_) return;
    for (const id of sections_.keys()) {
        if (!builtinSectionIds_.has(id)) sections_.delete(id);
    }
    for (const id of items_.keys()) {
        if (!builtinItemIds_.has(id)) items_.delete(id);
    }
}
