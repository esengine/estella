import { getEditorContainer } from '../container';
import { PROPERTY_EDITOR } from '../container/tokens';

export interface PropertyMeta {
    name: string;
    type: string;
    group?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: unknown }[];
    fileFilter?: string[];
    dependsOn?: string;
    hiddenWhen?: { hasComponent: string };
}

export interface PropertyEditorContext {
    value: unknown;
    meta: PropertyMeta;
    onChange: (value: unknown) => void;
    componentData?: Record<string, unknown>;
    getComponentValue?: (name: string) => unknown;
}

export type PropertyEditorFactory = (
    container: HTMLElement,
    ctx: PropertyEditorContext
) => PropertyEditorInstance;

export interface PropertyEditorInstance {
    update(value: unknown): void;
    dispose(): void;
}

export function registerPropertyEditor(type: string, factory: PropertyEditorFactory): void {
    getEditorContainer().provide(PROPERTY_EDITOR, type, factory);
}

export function getPropertyEditor(type: string): PropertyEditorFactory | undefined {
    return getEditorContainer().get(PROPERTY_EDITOR, type);
}

export function createPropertyEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance | null {
    const factory = getEditorContainer().get(PROPERTY_EDITOR, ctx.meta.type);
    if (!factory) {
        console.warn(`[PropertyEditor] No editor registered for type "${ctx.meta.type}"`);
        return null;
    }
    return factory(container, ctx);
}
