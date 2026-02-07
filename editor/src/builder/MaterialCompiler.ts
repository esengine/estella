import type { NativeFS } from '../types/NativeFS';
import type { AssetLibrary } from '../asset/AssetLibrary';
import type { BuildConfig } from '../types/BuildTypes';
import type { AssetExportConfig } from './AssetCollector';
import { BuildAssetCollector, AssetExportConfigService } from './AssetCollector';
import { joinPath } from '../utils/path';
import { parseEsShader, resolveShaderPath } from '../utils/shader';

export interface CompiledMaterial {
    relativePath: string;
    uuid: string;
    json: string;
}

export async function compileMaterials(
    fs: NativeFS,
    projectDir: string,
    assetLibrary: AssetLibrary,
    config: BuildConfig,
    exportConfig: AssetExportConfig
): Promise<CompiledMaterial[]> {
    const results: CompiledMaterial[] = [];
    const collector = new BuildAssetCollector(fs, projectDir, assetLibrary);
    const assetPaths = await collector.collect(config, exportConfig);

    for (const relativePath of assetPaths) {
        if (!relativePath.endsWith('.esmaterial')) continue;

        const uuid = assetLibrary.getUuid(relativePath);
        if (!uuid) continue;

        const fullPath = joinPath(projectDir, relativePath);
        const content = await fs.readFile(fullPath);
        if (!content) continue;

        try {
            const matData = JSON.parse(content);
            if (matData.type !== 'material' || !matData.shader) continue;

            const shaderRelPath = resolveShaderPath(relativePath, matData.shader);
            const shaderFullPath = joinPath(projectDir, shaderRelPath);
            const shaderContent = await fs.readFile(shaderFullPath);
            if (!shaderContent) continue;

            const parsed = parseEsShader(shaderContent);
            if (!parsed.vertex || !parsed.fragment) continue;

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
        } catch {
            console.warn(`[MaterialCompiler] Failed to compile material: ${relativePath}`);
        }
    }

    return results;
}
