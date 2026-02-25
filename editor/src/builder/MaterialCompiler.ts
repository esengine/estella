import type { NativeFS } from '../types/NativeFS';
import type { AssetLibrary } from '../asset/AssetLibrary';
import { joinPath } from '../utils/path';
import { parseEsShader, resolveShaderPath } from '../utils/shader';
import { getAssetTypeEntry } from 'esengine';

export interface CompiledMaterial {
    relativePath: string;
    uuid: string;
    json: string;
}

export async function compileMaterials(
    fs: NativeFS,
    projectDir: string,
    assetLibrary: AssetLibrary,
    assetPaths: Set<string>
): Promise<CompiledMaterial[]> {
    const results: CompiledMaterial[] = [];

    for (const relativePath of assetPaths) {
        if (getAssetTypeEntry(relativePath)?.editorType !== 'material') continue;

        const uuid = assetLibrary.getUuid(relativePath);
        if (!uuid) continue;

        const fullPath = joinPath(projectDir, relativePath);
        const content = await fs.readFile(fullPath);
        if (!content) continue;

        try {
            const matData = JSON.parse(content);
            if (matData.type !== 'material' || !matData.shader) {
                console.warn(`[MaterialCompiler] Invalid material (missing type or shader): ${relativePath}`);
                continue;
            }

            const shaderRelPath = resolveShaderPath(relativePath, matData.shader);
            const shaderFullPath = joinPath(projectDir, shaderRelPath);
            const shaderContent = await fs.readFile(shaderFullPath);
            if (!shaderContent) {
                console.error(`[MaterialCompiler] Shader not found: ${shaderRelPath} (referenced by ${relativePath})`);
                continue;
            }

            const parsed = parseEsShader(shaderContent);
            if (!parsed.vertex || !parsed.fragment) {
                console.error(`[MaterialCompiler] Shader missing vertex or fragment block: ${shaderRelPath}`);
                continue;
            }

            const compiled = {
                type: 'material',
                vertexSource: parsed.vertex,
                fragmentSource: parsed.fragment,
                blendMode: matData.blendMode ?? 0,
                depthTest: matData.depthTest ?? false,
                properties: matData.properties ?? {},
            };

            results.push({
                relativePath,
                uuid,
                json: JSON.stringify(compiled),
            });
        } catch (err) {
            console.error(`[MaterialCompiler] Failed to compile material: ${relativePath}`, err);
        }
    }

    return results;
}
