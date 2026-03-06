import { getEditorContainer } from '../container';
import { SETTINGS_SECTION, SETTINGS_GROUP, SETTINGS_ITEM } from '../container/tokens';

export type SettingsItemType = 'boolean' | 'number' | 'string' | 'color' | 'select' | 'range' | 'custom';

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
    hidden?: boolean;
    render?: (container: HTMLElement) => (() => void) | void;
}

type SettingsChangeListener = (id: string, value: unknown) => void;

const STORAGE_KEY = 'esengine_settings';

const values_ = new Map<string, unknown>();
const listeners_: SettingsChangeListener[] = [];

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
    getEditorContainer().provide(SETTINGS_SECTION, descriptor.id, descriptor);
}

export function registerSettingsGroup(descriptor: SettingsGroupDescriptor): void {
    getEditorContainer().provide(SETTINGS_GROUP, descriptor.id, descriptor);
}

export function registerSettingsItem(descriptor: SettingsItemDescriptor): void {
    getEditorContainer().provide(SETTINGS_ITEM, descriptor.id, descriptor);
    if (!values_.has(descriptor.id)) {
        values_.set(descriptor.id, descriptor.defaultValue);
    }
}

export function getSettingsValue<T = unknown>(id: string): T {
    if (values_.has(id)) return values_.get(id) as T;
    const item = getEditorContainer().get(SETTINGS_ITEM, id);
    return (item?.defaultValue ?? undefined) as T;
}

export function setSettingsValue(id: string, value: unknown): void {
    const prev = values_.get(id);
    if (prev === value) return;

    values_.set(id, value);
    saveToStorage();

    const item = getEditorContainer().get(SETTINGS_ITEM, id);
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
    return getEditorContainer().getOrdered(SETTINGS_SECTION);
}

export function getSectionItems(sectionId: string): SettingsItemDescriptor[] {
    return getEditorContainer().getOrdered(SETTINGS_ITEM)
        .filter(item => item.section === sectionId);
}

export function getSectionGroups(sectionId: string): SettingsGroupDescriptor[] {
    return getEditorContainer().getOrdered(SETTINGS_GROUP)
        .filter(g => g.section === sectionId);
}

export function getGroupItems(groupId: string): SettingsItemDescriptor[] {
    return getEditorContainer().getOrdered(SETTINGS_ITEM)
        .filter(item => item.group === groupId);
}

export function getUngroupedSectionItems(sectionId: string): SettingsItemDescriptor[] {
    return getEditorContainer().getOrdered(SETTINGS_ITEM)
        .filter(item => item.section === sectionId && !item.group);
}

export function searchSettings(query: string): SettingsItemDescriptor[] {
    const q = query.toLowerCase();
    return [...getEditorContainer().getAll(SETTINGS_ITEM).values()].filter(item => {
        if (item.hidden) return false;
        if (item.label.toLowerCase().includes(q)) return true;
        if (item.description?.toLowerCase().includes(q)) return true;
        if (item.tags?.some(t => t.toLowerCase().includes(q))) return true;
        const section = getEditorContainer().get(SETTINGS_SECTION, item.section);
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
    for (const item of getEditorContainer().getAll(SETTINGS_ITEM).values()) {
        const value = getSettingsValue(item.id);
        if (value !== item.defaultValue) {
            result[item.id] = value;
        }
    }
    return result;
}

export function importSettings(data: Record<string, unknown>): void {
    const c = getEditorContainer();
    for (const [id, value] of Object.entries(data)) {
        if (c.has(SETTINGS_ITEM, id)) {
            setSettingsValue(id, value);
        }
    }
}

export function getItemDescriptor(id: string): SettingsItemDescriptor | undefined {
    return getEditorContainer().get(SETTINGS_ITEM, id);
}

export function getGroupDescriptor(id: string): SettingsGroupDescriptor | undefined {
    return getEditorContainer().get(SETTINGS_GROUP, id);
}
