/**
 * @file    AssetLoader.ts
 * @brief   Web platform asset loading utilities
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import type { ESEngineModule, ResourceManager, TextureHandle, ShaderHandle } from './esengine';
import { TextureFormat } from './esengine';

export interface TextureData {
    width: number;
    height: number;
    pixels: Uint8Array;
    format: 'RGBA8' | 'RGB8';
}

export interface ShaderData {
    vertexSource: string;
    fragmentSource: string;
}

export class AssetLoader {
    private module_: ESEngineModule;
    private resourceManager_: ResourceManager;
    private textureCache_ = new Map<string, TextureHandle>();
    private shaderCache_ = new Map<string, ShaderHandle>();

    constructor(module: ESEngineModule, resourceManager: ResourceManager) {
        this.module_ = module;
        this.resourceManager_ = resourceManager;
    }

    async loadAndCreateTexture(url: string): Promise<TextureHandle> {
        const cached = this.textureCache_.get(url);
        if (cached !== undefined) {
            return cached;
        }

        const data = await this.loadTexture(url);
        const handle = this.createTextureFromData(data);
        this.textureCache_.set(url, handle);
        return handle;
    }

    async loadAndCreateShader(url: string): Promise<ShaderHandle> {
        const cached = this.shaderCache_.get(url);
        if (cached !== undefined) {
            return cached;
        }

        const data = await this.loadShader(url);
        const handle = this.resourceManager_.createShader(data.vertexSource, data.fragmentSource);
        this.shaderCache_.set(url, handle);
        return handle;
    }

    createTextureFromData(data: TextureData): TextureHandle {
        const ptr = this.module_._malloc(data.pixels.length);
        this.module_.HEAPU8.set(data.pixels, ptr);

        const format = data.format === 'RGBA8' ? TextureFormat.RGBA8 : TextureFormat.RGB8;
        const handle = this.resourceManager_.createTexture(
            data.width, data.height, ptr, data.pixels.length, format
        );

        this.module_._free(ptr);
        return handle;
    }

    async loadTexture(url: string): Promise<TextureData> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch texture: ${url}`);
        }

        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);

        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

        return {
            width: bitmap.width,
            height: bitmap.height,
            pixels: new Uint8Array(imageData.data.buffer),
            format: 'RGBA8'
        };
    }

    async loadShader(url: string): Promise<ShaderData> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch shader: ${url}`);
        }

        const source = await response.text();
        return this.parseESShader(source);
    }

    async loadText(url: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${url}`);
        }
        return response.text();
    }

    async loadBinary(url: string): Promise<ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${url}`);
        }
        return response.arrayBuffer();
    }

    async loadJson<T = unknown>(url: string): Promise<T> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${url}`);
        }
        return response.json();
    }

    private parseESShader(source: string): ShaderData {
        let vertexSource = '';
        let fragmentSource = '';
        let sharedCode = '';
        let version = '';

        const lines = source.split('\n');
        let state: 'global' | 'vertex' | 'fragment' = 'global';
        let currentSection: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('#pragma')) {
                const parts = trimmed.substring(7).trim().split(/\s+/);
                const directive = parts[0];

                if (directive === 'version') {
                    version = parts[1] || '';
                } else if (directive === 'vertex') {
                    state = 'vertex';
                    currentSection = [];
                } else if (directive === 'fragment') {
                    state = 'fragment';
                    currentSection = [];
                } else if (directive === 'end') {
                    if (state === 'vertex') {
                        vertexSource = currentSection.join('\n');
                    } else if (state === 'fragment') {
                        fragmentSource = currentSection.join('\n');
                    }
                    state = 'global';
                }
                continue;
            }

            if (state === 'global') {
                if (trimmed && !trimmed.startsWith('//')) {
                    sharedCode += line + '\n';
                }
            } else {
                currentSection.push(line);
            }
        }

        const versionLine = version ? `#version ${version}\n` : '';

        return {
            vertexSource: versionLine + sharedCode + vertexSource,
            fragmentSource: versionLine + sharedCode + fragmentSource
        };
    }
}
