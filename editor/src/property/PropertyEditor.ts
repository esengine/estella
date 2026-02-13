/**
 * @file    PropertyEditor.ts
 * @brief   Base property editor interface and registry
 */

// =============================================================================
// Types
// =============================================================================

export interface PropertyMeta {
    name: string;
    type: string;
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: unknown }[];
    fileFilter?: string[];
    dependsOn?: string;
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

// =============================================================================
// Registry
// =============================================================================

const editorRegistry = new Map<string, PropertyEditorFactory>();

export function registerPropertyEditor(type: string, factory: PropertyEditorFactory): void {
    editorRegistry.set(type, factory);
}

export function getPropertyEditor(type: string): PropertyEditorFactory | undefined {
    return editorRegistry.get(type);
}

const builtinEditorTypes = new Set<string>();

export function lockBuiltinPropertyEditors(): void {
    for (const type of editorRegistry.keys()) builtinEditorTypes.add(type);
}

export function clearExtensionPropertyEditors(): void {
    for (const type of editorRegistry.keys()) {
        if (!builtinEditorTypes.has(type)) editorRegistry.delete(type);
    }
}

export function createPropertyEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance | null {
    const factory = editorRegistry.get(ctx.meta.type);
    if (!factory) {
        console.warn(`[PropertyEditor] No editor registered for type "${ctx.meta.type}"`);
        return null;
    }
    return factory(container, ctx);
}
