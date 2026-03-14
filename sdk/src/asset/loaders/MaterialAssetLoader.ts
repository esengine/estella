import type { AssetLoader, LoadContext, MaterialResult } from '../AssetLoader';
import type { MaterialAssetData, ShaderHandle } from '../../material';
import { Material } from '../../material';
import { AsyncCache } from '../AsyncCache';

const ES_SHADER_VERTEX_RE = /#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/;
const ES_SHADER_FRAGMENT_RE = /#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/;

const shaderCache = new AsyncCache<ShaderHandle>();

export class MaterialAssetLoader implements AssetLoader<MaterialResult> {
    readonly type = 'material';
    readonly extensions = ['.esmaterial'];

    async load(path: string, ctx: LoadContext): Promise<MaterialResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        const data = JSON.parse(text) as MaterialAssetData;

        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type} at ${path}`);
        }

        const shaderPath = resolveShaderPath(path, data.shader);
        const shaderHandle = await this.loadShader(shaderPath, ctx);
        const handle = Material.createFromAsset(data, shaderHandle);

        return { handle, shaderHandle };
    }

    unload(asset: MaterialResult): void {
        Material.release(asset.handle);
    }

    private async loadShader(path: string, ctx: LoadContext): Promise<ShaderHandle> {
        const cached = shaderCache.get(path);
        if (cached !== undefined) return cached;

        return shaderCache.getOrLoad(path, async () => {
            const buildPath = ctx.catalog.getBuildPath(path);
            const content = await ctx.loadText(buildPath);
            const vertexMatch = content.match(ES_SHADER_VERTEX_RE);
            const fragmentMatch = content.match(ES_SHADER_FRAGMENT_RE);

            if (!vertexMatch?.[1] || !fragmentMatch?.[1]) {
                throw new Error(`Invalid shader format: ${path}`);
            }

            return Material.createShader(vertexMatch[1].trim(), fragmentMatch[1].trim());
        });
    }
}

function resolveShaderPath(materialPath: string, shaderPath: string): string {
    if (shaderPath.startsWith('/') || shaderPath.startsWith('http') || shaderPath.startsWith('assets/')) {
        return shaderPath;
    }
    const dir = materialPath.substring(0, materialPath.lastIndexOf('/'));
    return dir ? `${dir}/${shaderPath}` : shaderPath;
}
