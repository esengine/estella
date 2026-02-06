/**
 * @file    ShaderPropertyParser.ts
 * @brief   Parser for shader property annotations
 */

// =============================================================================
// Types
// =============================================================================

export enum ShaderPropertyType {
    Float = 'float',
    Vec2 = 'vec2',
    Vec3 = 'vec3',
    Vec4 = 'vec4',
    Color = 'color',
    Int = 'int',
    Texture = 'texture',
    Unknown = 'unknown',
}

export interface ShaderProperty {
    name: string;
    type: ShaderPropertyType;
    defaultValue: string;
    displayName: string;
    min?: number;
    max?: number;
    step?: number;
    group?: string;
}

export interface ParsedShaderInfo {
    name: string;
    version: string;
    properties: ShaderProperty[];
    valid: boolean;
    errorMessage: string;
}

// =============================================================================
// Parser
// =============================================================================

export function parseShaderProperties(source: string): ParsedShaderInfo {
    const result: ParsedShaderInfo = {
        name: '',
        version: '',
        properties: [],
        valid: false,
        errorMessage: '',
    };

    if (!source) {
        result.errorMessage = 'Empty shader source';
        return result;
    }

    const lines = source.split('\n');
    let inProperties = false;

    for (const line of lines) {
        const { directive, argument } = parseDirective(line);

        if (directive === 'shader') {
            result.name = argument.replace(/^"|"$/g, '');
            continue;
        }

        if (directive === 'version') {
            result.version = argument;
            continue;
        }

        if (directive === 'properties') {
            inProperties = true;
            continue;
        }

        if (directive === 'end') {
            inProperties = false;
            continue;
        }

        if (inProperties && line.includes('uniform')) {
            const prop = parsePropertyAnnotation(line);
            if (prop.name) {
                result.properties.push(prop);
            }
        }
    }

    result.valid = true;
    return result;
}

function parseDirective(line: string): { directive: string; argument: string } {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#pragma')) {
        return { directive: '', argument: '' };
    }

    const rest = trimmed.slice(7).trim();
    if (!rest) {
        return { directive: '', argument: '' };
    }

    const spaceIndex = rest.search(/\s/);
    if (spaceIndex === -1) {
        return { directive: rest, argument: '' };
    }

    return {
        directive: rest.slice(0, spaceIndex),
        argument: rest.slice(spaceIndex).trim(),
    };
}

function parsePropertyAnnotation(line: string): ShaderProperty {
    const prop: ShaderProperty = {
        name: '',
        type: ShaderPropertyType.Unknown,
        defaultValue: '',
        displayName: '',
    };

    const uniformIndex = line.indexOf('uniform');
    if (uniformIndex === -1) {
        return prop;
    }

    const afterUniform = line.slice(uniformIndex + 7).trim();
    const spaceIndex = afterUniform.search(/\s/);
    if (spaceIndex === -1) {
        return prop;
    }

    const glslType = afterUniform.slice(0, spaceIndex);
    const rest = afterUniform.slice(spaceIndex).trim();
    const semicolonIndex = rest.indexOf(';');
    if (semicolonIndex === -1) {
        return prop;
    }

    prop.name = rest.slice(0, semicolonIndex).trim();
    prop.type = glslTypeToPropertyType(glslType);

    const propIndex = line.indexOf('@property');
    if (propIndex !== -1) {
        const parenStart = line.indexOf('(', propIndex);
        const parenEnd = line.indexOf(')', parenStart);
        if (parenStart !== -1 && parenEnd !== -1) {
            const params = line.slice(parenStart + 1, parenEnd);
            parsePropertyParams(params, prop);
        }
    }

    if (!prop.displayName) {
        prop.displayName = prop.name;
        if (prop.displayName.startsWith('u_')) {
            prop.displayName = prop.displayName.slice(2);
        }
        if (prop.displayName) {
            prop.displayName = prop.displayName.charAt(0).toUpperCase() + prop.displayName.slice(1);
        }
    }

    return prop;
}

function parsePropertyParams(params: string, prop: ShaderProperty): void {
    const typeMatch = params.match(/type\s*=\s*(\w+)/);
    if (typeMatch) {
        prop.type = stringToPropertyType(typeMatch[1]);
    }

    const defaultMatch = params.match(/default\s*=\s*([^,)]+)/);
    if (defaultMatch) {
        prop.defaultValue = defaultMatch[1].trim();
    }

    const nameMatch = params.match(/name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
        prop.displayName = nameMatch[1];
    }

    const minMatch = params.match(/min\s*=\s*(-?[\d.]+)/);
    if (minMatch) {
        prop.min = parseFloat(minMatch[1]);
    }

    const maxMatch = params.match(/max\s*=\s*(-?[\d.]+)/);
    if (maxMatch) {
        prop.max = parseFloat(maxMatch[1]);
    }

    const stepMatch = params.match(/step\s*=\s*([\d.]+)/);
    if (stepMatch) {
        prop.step = parseFloat(stepMatch[1]);
    }

    const groupMatch = params.match(/group\s*=\s*"([^"]+)"/);
    if (groupMatch) {
        prop.group = groupMatch[1];
    }
}

function glslTypeToPropertyType(glslType: string): ShaderPropertyType {
    switch (glslType) {
        case 'float': return ShaderPropertyType.Float;
        case 'vec2': return ShaderPropertyType.Vec2;
        case 'vec3': return ShaderPropertyType.Vec3;
        case 'vec4': return ShaderPropertyType.Vec4;
        case 'int': return ShaderPropertyType.Int;
        case 'sampler2D': return ShaderPropertyType.Texture;
        default: return ShaderPropertyType.Unknown;
    }
}

function stringToPropertyType(typeStr: string): ShaderPropertyType {
    switch (typeStr) {
        case 'float': return ShaderPropertyType.Float;
        case 'vec2': return ShaderPropertyType.Vec2;
        case 'vec3': return ShaderPropertyType.Vec3;
        case 'vec4': return ShaderPropertyType.Vec4;
        case 'color': return ShaderPropertyType.Color;
        case 'int': return ShaderPropertyType.Int;
        case 'texture': return ShaderPropertyType.Texture;
        default: return ShaderPropertyType.Unknown;
    }
}

export function getDefaultPropertyValue(type: ShaderPropertyType): unknown {
    switch (type) {
        case ShaderPropertyType.Float:
        case ShaderPropertyType.Int:
            return 0;
        case ShaderPropertyType.Vec2:
            return { x: 0, y: 0 };
        case ShaderPropertyType.Vec3:
            return { x: 0, y: 0, z: 0 };
        case ShaderPropertyType.Vec4:
        case ShaderPropertyType.Color:
            return { x: 1, y: 1, z: 1, w: 1 };
        case ShaderPropertyType.Texture:
            return '';
        default:
            return null;
    }
}

export function parseDefaultValueString(defaultStr: string, type: ShaderPropertyType): unknown {
    if (!defaultStr) {
        return getDefaultPropertyValue(type);
    }

    switch (type) {
        case ShaderPropertyType.Float:
            return parseFloat(defaultStr) || 0;

        case ShaderPropertyType.Int:
            return parseInt(defaultStr, 10) || 0;

        case ShaderPropertyType.Vec2: {
            const parts = defaultStr.split(':').map(s => parseFloat(s) || 0);
            return { x: parts[0] ?? 0, y: parts[1] ?? 0 };
        }

        case ShaderPropertyType.Vec3: {
            const parts = defaultStr.split(':').map(s => parseFloat(s) || 0);
            return { x: parts[0] ?? 0, y: parts[1] ?? 0, z: parts[2] ?? 0 };
        }

        case ShaderPropertyType.Vec4:
        case ShaderPropertyType.Color: {
            const parts = defaultStr.split(':').map(s => parseFloat(s) || 0);
            return {
                x: parts[0] ?? 1,
                y: parts[1] ?? 1,
                z: parts[2] ?? 1,
                w: parts[3] ?? 1
            };
        }

        default:
            return getDefaultPropertyValue(type);
    }
}

export function getShaderDefaultProperties(info: ParsedShaderInfo): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const prop of info.properties) {
        if (prop.type === ShaderPropertyType.Texture) continue;

        const value = prop.defaultValue
            ? parseDefaultValueString(prop.defaultValue, prop.type)
            : getDefaultPropertyValue(prop.type);

        result[prop.name] = value;
    }

    return result;
}
