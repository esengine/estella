const COMPONENT_ENTITY_FIELDS = new Map<string, string[]>();

export function registerComponentEntityFields(
    componentType: string,
    fields: string[]
): void {
    COMPONENT_ENTITY_FIELDS.set(componentType, fields);
}

export function getComponentEntityFields(componentType: string): string[] | undefined {
    return COMPONENT_ENTITY_FIELDS.get(componentType);
}
