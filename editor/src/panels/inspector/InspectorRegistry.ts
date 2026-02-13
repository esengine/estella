/**
 * @file    InspectorRegistry.ts
 * @brief   Registry for custom inspector sections and component inspectors
 */

import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { AssetType } from '../../store/EditorStore';

// =============================================================================
// Types
// =============================================================================

export interface InspectorContext {
    store: EditorStore;
    entity?: Entity;
    assetPath?: string;
    assetType?: AssetType;
}

export interface InspectorSectionInstance {
    dispose(): void;
    update?(): void;
}

export interface InspectorSectionDescriptor {
    id: string;
    title: string;
    icon?: string;
    order?: number;
    target: 'entity' | 'asset' | 'both';
    visible?: (ctx: InspectorContext) => boolean;
    render: (container: HTMLElement, ctx: InspectorContext) => InspectorSectionInstance;
}

export interface ComponentInspectorContext {
    store: EditorStore;
    entity: Entity;
    componentType: string;
    componentData: Record<string, unknown>;
    onChange: (property: string, oldValue: unknown, newValue: unknown) => void;
}

export interface ComponentInspectorInstance {
    dispose(): void;
    update?(data: Record<string, unknown>): void;
}

export interface ComponentInspectorDescriptor {
    id: string;
    componentType: string;
    render: (container: HTMLElement, ctx: ComponentInspectorContext) => ComponentInspectorInstance;
}

// =============================================================================
// Section Registry
// =============================================================================

const sectionRegistry: InspectorSectionDescriptor[] = [];
const builtinSectionIds = new Set<string>();

export function registerInspectorSection(descriptor: InspectorSectionDescriptor): void {
    sectionRegistry.push(descriptor);
}

export function getInspectorSections(target: 'entity' | 'asset'): InspectorSectionDescriptor[] {
    return sectionRegistry
        .filter(s => s.target === target || s.target === 'both')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function lockBuiltinInspectorExtensions(): void {
    for (const s of sectionRegistry) {
        builtinSectionIds.add(s.id);
    }
    for (const c of componentRegistry.values()) {
        builtinComponentTypes.add(c.componentType);
    }
}

export function clearExtensionInspectorExtensions(): void {
    for (let i = sectionRegistry.length - 1; i >= 0; i--) {
        if (!builtinSectionIds.has(sectionRegistry[i].id)) {
            sectionRegistry.splice(i, 1);
        }
    }
    for (const [key, desc] of componentRegistry) {
        if (!builtinComponentTypes.has(desc.componentType)) {
            componentRegistry.delete(key);
        }
    }
}

// =============================================================================
// Component Inspector Registry
// =============================================================================

const componentRegistry = new Map<string, ComponentInspectorDescriptor>();
const builtinComponentTypes = new Set<string>();

export function registerComponentInspector(descriptor: ComponentInspectorDescriptor): void {
    componentRegistry.set(descriptor.componentType, descriptor);
}

export function getComponentInspector(componentType: string): ComponentInspectorDescriptor | undefined {
    return componentRegistry.get(componentType);
}
