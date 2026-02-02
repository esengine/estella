/**
 * @file    AssetLoader.ts
 * @brief   Asset loading utilities for textures, shaders, and data files
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import type { ESEngineModule, CppResourceManager, TextureHandle, ShaderHandle } from '../wasm/types';
import { TextureFormat } from '../wasm/types';

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// AssetLoader
// =============================================================================

export class AssetLoader {
    private module_: ESEngineModule;
    private resourceManager_: CppResourceManager;
    private textureCache_ = new Map<string, TextureHandle>();
    private shaderCache_ = new Map<string, ShaderHandle>();

    constructor(module: ESEngineModule, resourceManager: CppResourceManager) {
        this.module_ = module;
        this.resourceManager_ = resourceManager;
    }

    // =========================================================================
    // Texture Loading
    // =========================================================================

    async loadTexture(url: string): Promise<TextureHandle> {
        const cached = this.textureCache_.get(url);
        if (cached !== undefined) {
            return cached;
        }

        const data = await this.fetchTexture(url);
        const handle = this.createTexture(data);
        this.textureCache_.set(url, handle);
        return handle;
    }

    createTexture(data: TextureData): TextureHandle {
        const ptr = this.module_._malloc(data.pixels.length);
        this.module_.HEAPU8.set(data.pixels, ptr);

        const format = data.format === 'RGBA8' ? TextureFormat.RGBA8 : TextureFormat.RGB8;
        const handle = this.resourceManager_.createTexture(
            data.width, data.height, ptr, data.pixels.length, format
        );

        this.module_._free(ptr);
        return handle;
    }

    private async fetchTexture(url: string): Promise<TextureData> {
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

    // =========================================================================
    // Shader Loading
    // =========================================================================

    async loadShader(url: string): Promise<ShaderHandle> {
        const cached = this.shaderCache_.get(url);
        if (cached !== undefined) {
            return cached;
        }

        const data = await this.fetchShader(url);
        const handle = this.resourceManager_.createShader(data.vertexSource, data.fragmentSource);
        this.shaderCache_.set(url, handle);
        return handle;
    }

    private async fetchShader(url: string): Promise<ShaderData> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch shader: ${url}`);
        }

        const source = await response.text();
        return this.parseShader(source);
    }

    private parseShader(source: string): ShaderData {
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

    // =========================================================================
    // Generic Loading
    // =========================================================================

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

    // =========================================================================
    // Cache Management
    // =========================================================================

    releaseTexture(url: string): void {
        const handle = this.textureCache_.get(url);
        if (handle !== undefined) {
            this.resourceManager_.releaseTexture(handle);
            this.textureCache_.delete(url);
        }
    }

    releaseShader(url: string): void {
        const handle = this.shaderCache_.get(url);
        if (handle !== undefined) {
            this.resourceManager_.releaseShader(handle);
            this.shaderCache_.delete(url);
        }
    }

    clearCache(): void {
        for (const handle of this.textureCache_.values()) {
            this.resourceManager_.releaseTexture(handle);
        }
        for (const handle of this.shaderCache_.values()) {
            this.resourceManager_.releaseShader(handle);
        }
        this.textureCache_.clear();
        this.shaderCache_.clear();
    }
}
