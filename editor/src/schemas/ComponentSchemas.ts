/**
 * @file    ComponentSchemas.ts
 * @brief   Component property schemas for the inspector
 */

import type { PropertyMeta } from '../property/PropertyEditor';
import { getComponentDefaults } from 'esengine';

// =============================================================================
// Types
// =============================================================================

export type ComponentCategory = 'builtin' | 'physics' | 'script' | 'tag';

export interface ComponentSchema {
    name: string;
    category: ComponentCategory;
    properties: PropertyMeta[];
    removable?: boolean;
}

// =============================================================================
// Type Inference
// =============================================================================

function isVec2(v: unknown): boolean {
    return typeof v === 'object' && v !== null &&
           'x' in v && 'y' in v && !('z' in v);
}

function isVec3(v: unknown): boolean {
    return typeof v === 'object' && v !== null &&
           'x' in v && 'y' in v && 'z' in v && !('w' in v);
}

function isVec4OrColor(v: unknown): boolean {
    if (typeof v !== 'object' || v === null) return false;
    if ('r' in v && 'g' in v && 'b' in v && 'a' in v) return true;
    return 'x' in v && 'y' in v && 'z' in v && 'w' in v;
}

function inferPropertyType(value: unknown): string {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'boolean') return 'boolean';
    if (isVec2(value)) return 'vec2';
    if (isVec3(value)) return 'vec3';
    if (isVec4OrColor(value)) return 'vec4';
    return 'string';
}

// =============================================================================
// Built-in Schemas
// =============================================================================

export const LocalTransformSchema: ComponentSchema = {
    name: 'LocalTransform',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'position', type: 'vec3' },
        { name: 'rotation', type: 'euler' },
        { name: 'scale', type: 'vec3' },
    ],
};

export const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    category: 'builtin',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2' },
        { name: 'uvOffset', type: 'vec2' },
        { name: 'uvScale', type: 'vec2' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
    ],
};

export const CameraSchema: ComponentSchema = {
    name: 'Camera',
    category: 'builtin',
    properties: [
        { name: 'isActive', type: 'boolean' },
        {
            name: 'projectionType',
            type: 'enum',
            options: [
                { label: 'Orthographic', value: 0 },
                { label: 'Perspective', value: 1 },
            ],
        },
        { name: 'fov', type: 'number', min: 1, max: 179 },
        { name: 'orthoSize', type: 'number', min: 0.1 },
        { name: 'nearPlane', type: 'number', step: 0.1 },
        { name: 'farPlane', type: 'number', step: 1 },
        { name: 'priority', type: 'number', step: 1 },
        { name: 'viewportX', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportY', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportW', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'viewportH', type: 'number', min: 0, max: 1, step: 0.01 },
        {
            name: 'clearFlags',
            type: 'enum',
            options: [
                { label: 'None', value: 0 },
                { label: 'Color Only', value: 1 },
                { label: 'Depth Only', value: 2 },
                { label: 'Color + Depth', value: 3 },
            ],
        },
        { name: 'showFrustum', type: 'boolean' },
    ],
};

export const TextSchema: ComponentSchema = {
    name: 'Text',
    category: 'builtin',
    properties: [
        { name: 'content', type: 'string' },
        { name: 'fontFamily', type: 'font' },
        { name: 'fontSize', type: 'number', min: 8, max: 200 },
        { name: 'color', type: 'color' },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        {
            name: 'verticalAlign',
            type: 'enum',
            options: [
                { label: 'Top', value: 0 },
                { label: 'Middle', value: 1 },
                { label: 'Bottom', value: 2 },
            ],
        },
        { name: 'wordWrap', type: 'boolean' },
        {
            name: 'overflow',
            type: 'enum',
            options: [
                { label: 'Visible', value: 0 },
                { label: 'Clip', value: 1 },
                { label: 'Ellipsis', value: 2 },
            ],
        },
        { name: 'lineHeight', type: 'number', min: 0.5, max: 3, step: 0.1 },
    ],
};

export const UIRectSchema: ComponentSchema = {
    name: 'UIRect',
    category: 'builtin',
    properties: [
        { name: 'size', type: 'vec2' },
        { name: 'anchor', type: 'vec2' },
        { name: 'pivot', type: 'vec2' },
    ],
};

export const CanvasSchema: ComponentSchema = {
    name: 'Canvas',
    category: 'builtin',
    properties: [
        { name: 'designResolution', type: 'vec2' },
        { name: 'pixelsPerUnit', type: 'number', min: 1, step: 1 },
        {
            name: 'scaleMode',
            type: 'enum',
            options: [
                { label: 'FixedWidth', value: 0 },
                { label: 'FixedHeight', value: 1 },
                { label: 'Expand', value: 2 },
                { label: 'Shrink', value: 3 },
                { label: 'Match', value: 4 },
            ],
        },
        { name: 'matchWidthOrHeight', type: 'number', min: 0, max: 1, step: 0.1 },
        { name: 'backgroundColor', type: 'color' },
    ],
};

export const BitmapTextSchema: ComponentSchema = {
    name: 'BitmapText',
    category: 'builtin',
    properties: [
        { name: 'text', type: 'string' },
        { name: 'font', type: 'bitmap-font-file' },
        { name: 'color', type: 'color' },
        { name: 'fontSize', type: 'number', min: 0.1, step: 0.1 },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        { name: 'spacing', type: 'number', step: 0.1 },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
    ],
};

export const SpineAnimationSchema: ComponentSchema = {
    name: 'SpineAnimation',
    category: 'builtin',
    properties: [
        { name: 'skeletonPath', type: 'spine-file', fileFilter: ['.json', '.skel'] },
        { name: 'atlasPath', type: 'spine-file', fileFilter: ['.atlas'] },
        { name: 'material', type: 'material-file' },
        { name: 'skin', type: 'spine-skin', dependsOn: 'skeletonPath' },
        { name: 'animation', type: 'spine-animation', dependsOn: 'skeletonPath' },
        { name: 'timeScale', type: 'number', min: 0, max: 10, step: 0.1 },
        { name: 'loop', type: 'boolean' },
        { name: 'playing', type: 'boolean' },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
        { name: 'color', type: 'color' },
        { name: 'layer', type: 'number', min: -1000, max: 1000 },
        { name: 'skeletonScale', type: 'number', min: 0.01, max: 100, step: 0.01 },
    ],
};

export const RigidBodySchema: ComponentSchema = {
    name: 'RigidBody',
    category: 'physics',
    properties: [
        { name: 'bodyType', type: 'enum', options: [
            { label: 'Static', value: 0 },
            { label: 'Kinematic', value: 1 },
            { label: 'Dynamic', value: 2 },
        ]},
        { name: 'gravityScale', type: 'number', step: 0.1 },
        { name: 'linearDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'angularDamping', type: 'number', min: 0, step: 0.1 },
        { name: 'fixedRotation', type: 'boolean' },
        { name: 'bullet', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

export const BoxColliderSchema: ComponentSchema = {
    name: 'BoxCollider',
    category: 'physics',
    properties: [
        { name: 'halfExtents', type: 'vec2' },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
    ],
};

export const CircleColliderSchema: ComponentSchema = {
    name: 'CircleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
    ],
};

export const CapsuleColliderSchema: ComponentSchema = {
    name: 'CapsuleCollider',
    category: 'physics',
    properties: [
        { name: 'radius', type: 'number', min: 0, step: 0.01 },
        { name: 'halfHeight', type: 'number', min: 0, step: 0.01 },
        { name: 'offset', type: 'vec2' },
        { name: 'density', type: 'number', min: 0, step: 0.1 },
        { name: 'friction', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'restitution', type: 'number', min: 0, max: 1, step: 0.01 },
        { name: 'isSensor', type: 'boolean' },
    ],
};

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
    physics: ComponentSchema[];
    script: ComponentSchema[];
    tag: ComponentSchema[];
}

export function getComponentsByCategory(): ComponentsByCategory {
    const result: ComponentsByCategory = { builtin: [], physics: [], script: [], tag: [] };
    for (const schema of schemaRegistry.values()) {
        result[schema.category].push(schema);
    }
    result.builtin.sort((a, b) => a.name.localeCompare(b.name));
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

function exposeRegistrationAPI(): void {
    if (typeof window !== 'undefined') {
        window.__esengine_registerComponent = registerUserComponent;
    }
}

// =============================================================================
// Initialization
// =============================================================================

export interface BuiltinSchemaOptions {
    enableSpine?: boolean;
}

export function registerBuiltinSchemas(options?: BuiltinSchemaOptions): void {
    const enableSpine = options?.enableSpine ?? true;

    registerComponentSchema(LocalTransformSchema);
    registerComponentSchema(SpriteSchema);
    registerComponentSchema(CameraSchema);
    registerComponentSchema(TextSchema);
    registerComponentSchema(UIRectSchema);
    registerComponentSchema(CanvasSchema);
    registerComponentSchema(BitmapTextSchema);
    registerComponentSchema(RigidBodySchema);
    registerComponentSchema(BoxColliderSchema);
    registerComponentSchema(CircleColliderSchema);
    registerComponentSchema(CapsuleColliderSchema);
    if (enableSpine) {
        registerComponentSchema(SpineAnimationSchema);
    }
    exposeRegistrationAPI();
}

export function registerSpineSchema(): void {
    registerComponentSchema(SpineAnimationSchema);
}

// =============================================================================
// Default Component Data
// =============================================================================

const editorOnlyDefaults: Record<string, Record<string, unknown>> = {
    BitmapText: {
        text: 'BitmapText',
        font: '',
        color: { r: 1, g: 1, b: 1, a: 1 },
        fontSize: 1.0,
        align: 0,
        spacing: 0,
        layer: 0,
    },
    UIRect: {
        size: { x: 100, y: 100 },
        anchor: { x: 0.5, y: 0.5 },
        pivot: { x: 0.5, y: 0.5 },
    },
    Text: {
        content: 'Text',
        fontFamily: 'Arial',
        fontSize: 24,
        color: { r: 1, g: 1, b: 1, a: 1 },
        align: 0,
        verticalAlign: 0,
        wordWrap: true,
        overflow: 0,
        lineHeight: 1.2,
    },
};

export function getDefaultComponentData(typeName: string): Record<string, unknown> {
    const editorDefaults = editorOnlyDefaults[typeName];
    if (editorDefaults) {
        return { ...editorDefaults };
    }

    const sdkDefaults = getComponentDefaults(typeName);
    if (sdkDefaults) {
        return sdkDefaults;
    }

    return {};
}
