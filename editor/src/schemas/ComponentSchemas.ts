import type { PropertyMeta } from '../property/PropertyEditor';
import { getComponentDefaults } from 'esengine';
import { getSettingsValue } from '../settings/SettingsRegistry';

// =============================================================================
// Types
// =============================================================================

export type ComponentCategory = 'builtin' | 'ui' | 'physics' | 'script' | 'tag';

export interface ComponentSchema {
    name: string;
    category: ComponentCategory;
    properties: PropertyMeta[];
    removable?: boolean;
    hidden?: boolean;
    displayName?: string;
}

// =============================================================================
// Type Inference
// =============================================================================

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

// =============================================================================
// Registry
// =============================================================================

const schemaRegistry = new Map<string, ComponentSchema>();

export function registerComponentSchema(schema: ComponentSchema): void {
    schemaRegistry.set(schema.name, schema);
}

export function getComponentSchema(name: string): ComponentSchema | undefined {
    return schemaRegistry.get(name);
}

export function getAllComponentSchemas(): ComponentSchema[] {
    return Array.from(schemaRegistry.values());
}

export function isComponentRemovable(name: string): boolean {
    const schema = schemaRegistry.get(name);
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
    for (const schema of schemaRegistry.values()) {
        result[schema.category].push(schema);
    }
    result.builtin.sort((a, b) => a.name.localeCompare(b.name));
    result.ui.sort((a, b) => a.name.localeCompare(b.name));
    result.physics.sort((a, b) => a.name.localeCompare(b.name));
    result.script.sort((a, b) => a.name.localeCompare(b.name));
    result.tag.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

const builtinSchemaNames = new Set<string>();

export function lockBuiltinComponentSchemas(): void {
    for (const name of schemaRegistry.keys()) builtinSchemaNames.add(name);
}

export function clearExtensionComponentSchemas(): void {
    for (const name of schemaRegistry.keys()) {
        if (!builtinSchemaNames.has(name)) schemaRegistry.delete(name);
    }
}

export function clearScriptComponents(): void {
    for (const [name, schema] of schemaRegistry.entries()) {
        if (builtinSchemaNames.has(name)) continue;
        if (schema.category === 'script' || schema.category === 'tag') {
            schemaRegistry.delete(name);
        }
    }
}

// =============================================================================
// User Component Registration
// =============================================================================

function registerUserComponent(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    const existing = schemaRegistry.get(name);
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
    schemaRegistry.set(name, schema);
}

export function exposeRegistrationAPI(): void {
    if (typeof window !== 'undefined') {
        window.__esengine_registerComponent = registerUserComponent;
    }
}

// =============================================================================
// Backward-compatible re-exports from plugins
// =============================================================================

export { TransformSchema, CameraSchema } from '../plugins/coreComponents';
export { SpriteSchema } from '../plugins/sprite';
export { TextSchema } from '../plugins/text';

// =============================================================================
// Legacy registration (kept for backward compat)
// =============================================================================

export interface BuiltinSchemaOptions {
    enableSpine?: boolean;
}

export function registerBuiltinSchemas(_options?: BuiltinSchemaOptions): void {
    // Schemas are now registered via EditorPlugin system.
    // This function is kept for backward compatibility.
    exposeRegistrationAPI();
}

export function registerSpineSchema(): void {
    // Spine schema is now registered via the spine plugin.
}

// =============================================================================
// Default Component Data
// =============================================================================

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
