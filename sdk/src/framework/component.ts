/**
 * @file    component.ts
 * @brief   Component definition API for the ECS framework
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Schema, InferSchema, computeDefaults } from './types';
import { SchemaLayout, computeSchemaLayout } from './proxy';

// =============================================================================
// Component Definition
// =============================================================================

export interface ComponentDef<S extends Schema = Schema> {
    readonly _id: symbol;
    readonly _schema: S;
    readonly _defaults: InferSchema<S>;
    readonly _name: string;
    readonly _layout: SchemaLayout;
    _cppId: number | null;

    create(data?: Partial<InferSchema<S>>): InferSchema<S>;
}

let componentCounter = 0;

export function defineComponent<S extends Schema>(
    schema: S,
    defaults?: Partial<InferSchema<S>>,
    name?: string
): ComponentDef<S> {
    const counter = ++componentCounter;
    const id = Symbol(`Component_${counter}`);
    const computedDefaults = computeDefaults(schema, defaults);
    const componentName = name ?? `Component_${counter}`;
    const layout = computeSchemaLayout(schema);

    return {
        _id: id,
        _schema: schema,
        _defaults: computedDefaults,
        _name: componentName,
        _layout: layout,
        _cppId: null,

        create(data?: Partial<InferSchema<S>>): InferSchema<S> {
            if (!data) {
                return { ...computedDefaults };
            }
            return { ...computedDefaults, ...data };
        }
    };
}

// =============================================================================
// Tag Component (Marker)
// =============================================================================

export type TagSchema = Record<string, never>;

export function defineTag(name?: string): ComponentDef<TagSchema> {
    const counter = ++componentCounter;
    const id = Symbol(`Tag_${counter}`);
    const tagName = name ?? `Tag_${counter}`;

    return {
        _id: id,
        _schema: {} as TagSchema,
        _defaults: {} as InferSchema<TagSchema>,
        _name: tagName,
        _layout: { fields: {}, stride: 0 },
        _cppId: null,

        create(): InferSchema<TagSchema> {
            return {};
        }
    };
}

// =============================================================================
// Component Instance Type Extraction
// =============================================================================

export type ComponentInstance<C extends ComponentDef<Schema>> =
    C extends ComponentDef<infer S> ? InferSchema<S> : never;

export type ComponentInstances<C extends readonly ComponentDef<Schema>[]> = {
    [K in keyof C]: C[K] extends ComponentDef<infer S> ? InferSchema<S> : never;
};
