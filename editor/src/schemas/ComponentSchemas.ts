/**
 * @file    ComponentSchemas.ts
 * @brief   Component property schemas for the inspector
 */

import type { PropertyMeta } from '../property/PropertyEditor';

// =============================================================================
// Types
// =============================================================================

export interface ComponentSchema {
    name: string;
    properties: PropertyMeta[];
}

// =============================================================================
// Built-in Schemas
// =============================================================================

export const LocalTransformSchema: ComponentSchema = {
    name: 'LocalTransform',
    properties: [
        { name: 'position', type: 'vec3' },
        { name: 'rotation', type: 'vec4' },
        { name: 'scale', type: 'vec3' },
    ],
};

export const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    properties: [
        { name: 'texture', type: 'number' },
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
    ],
};

export const TextSchema: ComponentSchema = {
    name: 'Text',
    properties: [
        { name: 'content', type: 'string' },
        { name: 'fontSize', type: 'number', min: 8, max: 200 },
        { name: 'fontFamily', type: 'string' },
        { name: 'color', type: 'color' },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 'left' },
                { label: 'Center', value: 'center' },
                { label: 'Right', value: 'right' },
            ],
        },
        {
            name: 'baseline',
            type: 'enum',
            options: [
                { label: 'Top', value: 'top' },
                { label: 'Middle', value: 'middle' },
                { label: 'Bottom', value: 'bottom' },
            ],
        },
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

export function registerBuiltinSchemas(): void {
    registerComponentSchema(LocalTransformSchema);
    registerComponentSchema(SpriteSchema);
    registerComponentSchema(CameraSchema);
    registerComponentSchema(TextSchema);
}
