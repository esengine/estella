import { getComponentSchema } from './ComponentSchemas';

export interface CompositionResult {
    allowed: boolean;
    reason?: string;
    autoAdd?: string[];
}

export function checkComponentComposition(
    componentName: string,
    existingComponents: string[],
): CompositionResult {
    const schema = getComponentSchema(componentName);
    if (!schema) return { allowed: true };

    if (schema.conflicts) {
        for (const conflict of schema.conflicts) {
            if (existingComponents.includes(conflict)) {
                const conflictSchema = getComponentSchema(conflict);
                const conflictDisplay = conflictSchema?.displayName ?? conflict;
                return {
                    allowed: false,
                    reason: `Conflicts with ${conflictDisplay}`,
                };
            }
        }
    }

    const autoAdd: string[] = [];
    if (schema.requires) {
        for (const dep of schema.requires) {
            if (!existingComponents.includes(dep)) {
                autoAdd.push(dep);
            }
        }
    }

    return { allowed: true, autoAdd: autoAdd.length > 0 ? autoAdd : undefined };
}
