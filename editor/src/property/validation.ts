/**
 * @file    validation.ts
 * @brief   Property value validation utilities
 */

import type { PropertyMeta } from './PropertyEditor';

export interface ValidationResult {
    valid: boolean;
    value: unknown;
    error?: string;
}

export function validateNumber(value: unknown, meta: PropertyMeta): ValidationResult {
    const num = typeof value === 'number' ? value : parseFloat(String(value));

    if (isNaN(num)) {
        return {
            valid: false,
            value: meta.min ?? 0,
            error: 'Value must be a number'
        };
    }

    if (meta.min !== undefined && num < meta.min) {
        return {
            valid: false,
            value: meta.min,
            error: `Value must be at least ${meta.min}`
        };
    }

    if (meta.max !== undefined && num > meta.max) {
        return {
            valid: false,
            value: meta.max,
            error: `Value must be at most ${meta.max}`
        };
    }

    return { valid: true, value: num };
}

export function validateString(value: unknown, meta: PropertyMeta): ValidationResult {
    const str = String(value ?? '');
    return { valid: true, value: str };
}

export function validateBoolean(value: unknown, meta: PropertyMeta): ValidationResult {
    return { valid: true, value: Boolean(value) };
}

export function validateEnum(value: unknown, meta: PropertyMeta): ValidationResult {
    if (!meta.options || meta.options.length === 0) {
        return { valid: true, value };
    }

    const validValues = meta.options.map(opt => opt.value);
    const isValid = validValues.some(v => v === value);

    if (!isValid) {
        return {
            valid: false,
            value: meta.options[0].value,
            error: 'Invalid option selected'
        };
    }

    return { valid: true, value };
}

export function validateVec2(value: unknown, meta: PropertyMeta): ValidationResult {
    if (!value || typeof value !== 'object') {
        return {
            valid: false,
            value: { x: 0, y: 0 },
            error: 'Value must be a Vec2 object'
        };
    }

    const vec = value as { x: number; y: number };
    const xResult = validateNumber(vec.x, { ...meta, name: 'x' });
    const yResult = validateNumber(vec.y, { ...meta, name: 'y' });

    if (!xResult.valid || !yResult.valid) {
        return {
            valid: false,
            value: { x: xResult.value as number, y: yResult.value as number },
            error: xResult.error || yResult.error
        };
    }

    return { valid: true, value: { x: xResult.value, y: yResult.value } };
}

export function validateVec3(value: unknown, meta: PropertyMeta): ValidationResult {
    if (!value || typeof value !== 'object') {
        return {
            valid: false,
            value: { x: 0, y: 0, z: 0 },
            error: 'Value must be a Vec3 object'
        };
    }

    const vec = value as { x: number; y: number; z: number };
    const xResult = validateNumber(vec.x, { ...meta, name: 'x' });
    const yResult = validateNumber(vec.y, { ...meta, name: 'y' });
    const zResult = validateNumber(vec.z, { ...meta, name: 'z' });

    if (!xResult.valid || !yResult.valid || !zResult.valid) {
        return {
            valid: false,
            value: { x: xResult.value as number, y: yResult.value as number, z: zResult.value as number },
            error: xResult.error || yResult.error || zResult.error
        };
    }

    return { valid: true, value: { x: xResult.value, y: yResult.value, z: zResult.value } };
}

export function validateColor(value: unknown, meta: PropertyMeta): ValidationResult {
    if (!value || typeof value !== 'object') {
        return {
            valid: false,
            value: { r: 255, g: 255, b: 255, a: 255 },
            error: 'Value must be a Color object'
        };
    }

    const color = value as { r: number; g: number; b: number; a: number };
    const componentMeta = { ...meta, min: 0, max: 255 };

    const rResult = validateNumber(color.r, componentMeta);
    const gResult = validateNumber(color.g, componentMeta);
    const bResult = validateNumber(color.b, componentMeta);
    const aResult = validateNumber(color.a, componentMeta);

    if (!rResult.valid || !gResult.valid || !bResult.valid || !aResult.valid) {
        return {
            valid: false,
            value: {
                r: rResult.value as number,
                g: gResult.value as number,
                b: bResult.value as number,
                a: aResult.value as number
            },
            error: 'Color components must be 0-255'
        };
    }

    return {
        valid: true,
        value: { r: rResult.value, g: gResult.value, b: bResult.value, a: aResult.value }
    };
}

export function validate(value: unknown, meta: PropertyMeta): ValidationResult {
    switch (meta.type) {
        case 'number':
            return validateNumber(value, meta);
        case 'string':
            return validateString(value, meta);
        case 'boolean':
            return validateBoolean(value, meta);
        case 'enum':
            return validateEnum(value, meta);
        case 'vec2':
            return validateVec2(value, meta);
        case 'vec3':
            return validateVec3(value, meta);
        case 'color':
            return validateColor(value, meta);
        default:
            return { valid: true, value };
    }
}

export function showValidationError(element: HTMLElement, error: string): void {
    element.classList.add('es-validation-error');
    element.title = error;

    setTimeout(() => {
        element.classList.remove('es-validation-error');
        element.title = '';
    }, 3000);
}
