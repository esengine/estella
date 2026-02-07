import { getDirName } from './path';

export function parseEsShader(content: string): { vertex: string | null; fragment: string | null } {
    const vm = content.match(/#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/);
    const fm = content.match(/#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/);
    return { vertex: vm ? vm[1].trim() : null, fragment: fm ? fm[1].trim() : null };
}

export function resolveShaderPath(materialPath: string, shaderPath: string): string {
    if (shaderPath.startsWith('/') || shaderPath.startsWith('assets/')) return shaderPath;
    const dir = getDirName(materialPath);
    return dir ? `${dir}/${shaderPath}` : shaderPath;
}
