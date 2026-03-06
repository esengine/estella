import type { Entity } from 'esengine';
import type { EditorStore } from '../../store/EditorStore';
import type { AssetType } from '../../store/EditorStore';
import { getEditorContainer } from '../../container';
import { INSPECTOR_SECTION, COMPONENT_INSPECTOR } from '../../container/tokens';

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
    update(data: Record<string, unknown>): void;
}

export interface ComponentInspectorDescriptor {
    id: string;
    componentType: string;
    render: (container: HTMLElement, ctx: ComponentInspectorContext) => ComponentInspectorInstance;
}

export function registerInspectorSection(descriptor: InspectorSectionDescriptor): void {
    getEditorContainer().provide(INSPECTOR_SECTION, descriptor.id, descriptor);
}

export function getInspectorSections(target: 'entity' | 'asset'): InspectorSectionDescriptor[] {
    return getEditorContainer().getOrdered(INSPECTOR_SECTION)
        .filter(s => s.target === target || s.target === 'both');
}

export function registerComponentInspector(descriptor: ComponentInspectorDescriptor): void {
    getEditorContainer().provide(COMPONENT_INSPECTOR, descriptor.componentType, descriptor);
}

export function getComponentInspector(componentType: string): ComponentInspectorDescriptor | undefined {
    return getEditorContainer().get(COMPONENT_INSPECTOR, componentType);
}
