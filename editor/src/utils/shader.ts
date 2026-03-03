import { getDirName } from './path';

export interface ParsedEsShader {
    vertex: string | null;
    fragment: string | null;
    name: string;
    version: string;
    properties: string[];
}

export function parseEsShader(content: string): { vertex: string | null; fragment: string | null } {
    const parsed = parseEsShaderFull(content);
    return { vertex: parsed.vertex, fragment: parsed.fragment };
}

export function parseEsShaderFull(content: string): ParsedEsShader {
    const result: ParsedEsShader = {
        vertex: null,
        fragment: null,
        name: '',
        version: '',
        properties: [],
    };

    const lines = content.split('\n');
    let state: 'global' | 'properties' | 'vertex' | 'fragment' | 'variant' = 'global';
    let sharedCode = '';
    let currentSection = '';

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('#pragma ')) {
            const rest = trimmed.slice(7).trim();
            const spaceIdx = rest.indexOf(' ');
            const directive = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
            const arg = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : '';

            if (directive === 'shader') {
                result.name = arg.replace(/^"|"$/g, '');
                continue;
            }
            if (directive === 'version') {
                result.version = arg;
                continue;
            }
            if (directive === 'properties' && state === 'global') {
                state = 'properties';
                continue;
            }
            if (directive === 'vertex' && state === 'global') {
                state = 'vertex';
                currentSection = '';
                continue;
            }
            if (directive === 'fragment' && state === 'global') {
                state = 'fragment';
                currentSection = '';
                continue;
            }
            if (directive === 'variant' && state === 'global') {
                state = 'variant';
                currentSection = '';
                continue;
            }
            if (directive === 'end') {
                if (state === 'vertex') {
                    result.vertex = assembleStage(result.version, sharedCode, currentSection);
                } else if (state === 'fragment') {
                    result.fragment = assembleStage(result.version, sharedCode, currentSection);
                }
                state = 'global';
                continue;
            }
        }

        switch (state) {
            case 'global': {
                const t = line.trim();
                if (t && !t.startsWith('//')) {
                    sharedCode += line + '\n';
                }
                break;
            }
            case 'properties': {
                const t = line.trim();
                if (t && t.includes('uniform')) {
                    result.properties.push(t);
                }
                break;
            }
            case 'vertex':
            case 'fragment':
            case 'variant':
                currentSection += line + '\n';
                break;
        }
    }

    return result;
}

function assembleStage(version: string, sharedCode: string, stageCode: string): string {
    let result = '';
    if (version) {
        result += `#version ${version}\n`;
    }
    if (sharedCode.trim()) {
        result += sharedCode;
    }
    result += stageCode;
    return result.trim();
}

export function resolveShaderPath(materialPath: string, shaderPath: string): string {
    if (shaderPath.startsWith('/') || shaderPath.startsWith('assets/')) return shaderPath;
    const dir = getDirName(materialPath);
    return dir ? `${dir}/${shaderPath}` : shaderPath;
}
