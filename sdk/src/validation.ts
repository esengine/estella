/**
 * @file    validation.ts
 * @brief   Component data validation utilities
 */

export type ValidationError = {
    field: string;
    expected: string;
    actual: string;
    value: unknown;
};

export function validateComponentData(
    componentName: string,
    defaults: Record<string, unknown>,
    data: Record<string, unknown>
): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const [field, value] of Object.entries(data)) {
        if (!(field in defaults)) {
            errors.push({
                field,
                expected: 'field to exist in component definition',
                actual: 'unknown field',
                value,
            });
            continue;
        }

        const defaultValue = defaults[field];
        const expectedType = getType(defaultValue);
        const actualType = getType(value);

        if (expectedType !== actualType && value !== null && value !== undefined) {
            errors.push({
                field,
                expected: expectedType,
                actual: actualType,
                value,
            });
        }
    }

    return errors;
}

function getType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

export function formatValidationErrors(
    componentName: string,
    errors: ValidationError[]
): string {
    const lines = [`Invalid component data for "${componentName}":`];
    for (const err of errors) {
        lines.push(
            `  - Field "${err.field}": expected ${err.expected}, got ${err.actual} (${JSON.stringify(err.value)})`
        );
    }
    return lines.join('\n');
}
