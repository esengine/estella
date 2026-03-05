import type { PropertyMeta } from '../property/PropertyEditor';
import { getComponentDefaults } from 'esengine';
import { getSettingsValue } from '../settings/SettingsRegistry';
import { getEditorContainer } from '../container';
import { COMPONENT_SCHEMA } from '../container/tokens';

export type ComponentCategory = 'builtin' | 'ui' | 'physics' | 'script' | 'tag';

export interface ComponentSchema {
    name: string;
    category: ComponentCategory;
    properties: PropertyMeta[];
    removable?: boolean;
    hidden?: boolean;
    displayName?: string;
}

function isVec2(v: unknown): boolean {
    return typeof v === 'object' && v !== null &&
           'x' in v && 'y' in v && !('z' in v);
}

export function inferPropertyType(value: unknown): string {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) {
        if (value.length > 0 && isVec2(value[0])) return 'vec2-array';
        return 'string-array';
    }
    if (isVec2(value)) return 'vec2';
    if (typeof value === 'object' && value !== null &&
        'x' in value && 'y' in value && 'z' in value && !('w' in value)) return 'vec3';
    if (typeof value === 'object' && value !== null) {
        if ('r' in value && 'g' in value && 'b' in value && 'a' in value) return 'color';
        if ('x' in value && 'y' in value && 'z' in value && 'w' in value) return 'vec4';
    }
    return 'string';
}

export function registerComponentSchema(schema: ComponentSchema): void {
    getEditorContainer().provide(COMPONENT_SCHEMA, schema.name, schema);
}

export function getComponentSchema(name: string): ComponentSchema | undefined {
    return getEditorContainer().get(COMPONENT_SCHEMA, name);
}

export function getAllComponentSchemas(): ComponentSchema[] {
    return Array.from(getEditorContainer().getAll(COMPONENT_SCHEMA).values());
}

export function isComponentRemovable(name: string): boolean {
    const schema = getEditorContainer().get(COMPONENT_SCHEMA, name);
    return schema?.removable !== false;
}

export interface ComponentsByCategory {
    builtin: ComponentSchema[];
    ui: ComponentSchema[];
    physics: ComponentSchema[];
    script: ComponentSchema[];
    tag: ComponentSchema[];
}

export function getComponentsByCategory(): ComponentsByCategory {
    const result: ComponentsByCategory = { builtin: [], ui: [], physics: [], script: [], tag: [] };
    for (const schema of getEditorContainer().getAll(COMPONENT_SCHEMA).values()) {
        result[schema.category].push(schema);
    }
    result.builtin.sort((a, b) => a.name.localeCompare(b.name));
    result.ui.sort((a, b) => a.name.localeCompare(b.name));
    result.physics.sort((a, b) => a.name.localeCompare(b.name));
    result.script.sort((a, b) => a.name.localeCompare(b.name));
    result.tag.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

export function clearScriptComponents(): void {
    const c = getEditorContainer();
    c.removeWhere(COMPONENT_SCHEMA,
        (k, s) => !c.isBuiltin(COMPONENT_SCHEMA, k) && (s.category === 'script' || s.category === 'tag'));
}

function registerUserComponent(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    const c = getEditorContainer();
    const existing = c.get(COMPONENT_SCHEMA, name);
    if (existing?.category === 'builtin') {
        return;
    }

    const schema: ComponentSchema = {
        name,
        category: isTag ? 'tag' : 'script',
        properties: isTag ? [] : Object.entries(defaults).map(([key, value]) => ({
            name: key,
            type: inferPropertyType(value),
        })),
    };
    c.provide(COMPONENT_SCHEMA, name, schema);
}

export function exposeRegistrationAPI(): void {
    if (typeof window !== 'undefined') {
        window.__esengine_registerComponent = registerUserComponent;
    }
}

export { TransformSchema, CameraSchema } from '../plugins/coreComponents';
export { SpriteSchema } from '../plugins/sprite';
export { TextSchema } from '../plugins/text';

export function getDefaultComponentData(typeName: string): Record<string, unknown> {
    return getComponentDefaults(typeName) ?? {};
}

const editorInitialOverrides: Record<string, Record<string, unknown>> = {
    BitmapText: {
        text: 'BitmapText',
        font: '',
    },
    Text: {
        content: 'Text',
        align: 1,
        verticalAlign: 1,
    },
    TextInput: {
        placeholder: 'Enter text...',
    },
};

function getDynamicOverrides(typeName: string): Record<string, unknown> | null {
    switch (typeName) {
        case 'Sprite': {
            const w = getSettingsValue<number>('rendering.defaultSpriteWidth');
            const h = getSettingsValue<number>('rendering.defaultSpriteHeight');
            if (w != null || h != null) {
                return { size: { x: w ?? 100, y: h ?? 100 } };
            }
            return null;
        }
        case 'Canvas': {
            const ppu = getSettingsValue<number>('rendering.pixelsPerUnit');
            if (ppu != null) {
                return { pixelsPerUnit: ppu };
            }
            return null;
        }
        default:
            return null;
    }
}

export function getInitialComponentData(typeName: string): Record<string, unknown> {
    const defaults = getDefaultComponentData(typeName);
    const overrides = editorInitialOverrides[typeName];
    const dynamic = getDynamicOverrides(typeName);
    if (overrides || dynamic) {
        return { ...defaults, ...overrides, ...dynamic };
    }
    return defaults;
}
