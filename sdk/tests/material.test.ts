// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    Material,
    ShaderSources,
    isTextureRef,
    initMaterialAPI,
    shutdownMaterialAPI,
    CullMode,
} from '../src/material';
import type {
    MaterialHandle,
    ShaderHandle,
    TextureRef,
    MaterialAssetData,
} from '../src/material';
import type { ESEngineModule } from '../src/wasm';
import { BlendMode } from '../src/blend';
import { initResourceManager, shutdownResourceManager } from '../src/resourceManager';

// =============================================================================
// Mock WASM module for Material API
// =============================================================================

function createMaterialMockModule() {
    const resourceManager = {
        createShader: vi.fn().mockReturnValue(1),
        releaseShader: vi.fn(),
    };

    const mock = {
        getResourceManager: vi.fn(() => resourceManager),
        resourceManager,
        // The engine-side material store push (replaces the old pull callback + cache).
        compileEsshader: vi.fn().mockReturnValue(7),
        defineMaterial: vi.fn(),
        setMaterialUniform: vi.fn(),
        setMaterialTexture: vi.fn(),
        undefineMaterial: vi.fn(),
    };

    return mock;
}

type MockModule = ReturnType<typeof createMaterialMockModule>;

// Render-state flags the SDK packs for defineMaterial: depthTest (bit 0),
// depthWrite (bit 1), CullMode (bits 2-3).
function flags(depthTest: boolean, depthWrite: boolean, cull: CullMode): number {
    return (depthTest ? 0x1 : 0) | (depthWrite ? 0x2 : 0) | ((cull & 0x3) << 2);
}

// =============================================================================
// Tests
// =============================================================================

describe('Material API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createMaterialMockModule();
        initResourceManager(mock.resourceManager as any);
        initMaterialAPI(mock as unknown as ESEngineModule);
    });

    afterEach(() => {
        shutdownMaterialAPI();
        shutdownResourceManager();
    });

    // =========================================================================
    // shutdownMaterialAPI
    // =========================================================================

    describe('shutdownMaterialAPI', () => {
        it('should clear materials map', () => {
            const mat = Material.create({ shader: 1 as ShaderHandle });
            shutdownMaterialAPI();
            expect(Material.isValid(mat)).toBe(false);
        });

        it('should reset nextMaterialId to 1', () => {
            Material.create({ shader: 1 as ShaderHandle });
            Material.create({ shader: 1 as ShaderHandle });
            shutdownMaterialAPI();

            // Re-init to verify ID reset
            mock = createMaterialMockModule();
            initMaterialAPI(mock as unknown as ESEngineModule);
            const handle = Material.create({ shader: 1 as ShaderHandle });
            expect(handle).toBe(1);
        });

        it('should handle double shutdown gracefully', () => {
            shutdownMaterialAPI();
            expect(() => shutdownMaterialAPI()).not.toThrow();
        });
    });

    // =========================================================================
    // Shader create/release
    // =========================================================================

    describe('Material.createShader', () => {
        it('should proxy to resourceManager.createShader', () => {
            const handle = Material.createShader('vert', 'frag');
            expect(handle).toBe(1);
            expect(mock.resourceManager.createShader).toHaveBeenCalledWith('vert', 'frag');
        });
    });

    describe('Material.releaseShader', () => {
        it('should proxy to resourceManager.releaseShader for valid handle', () => {
            Material.releaseShader(5 as ShaderHandle);
            expect(mock.resourceManager.releaseShader).toHaveBeenCalledWith(5);
        });

        it('should skip release for handle <= 0', () => {
            Material.releaseShader(0 as ShaderHandle);
            Material.releaseShader(-1 as ShaderHandle);
            expect(mock.resourceManager.releaseShader).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Material CRUD
    // =========================================================================

    describe('Material.create', () => {
        it('should return incrementing handles starting from 1', () => {
            // Handle 1 was already consumed by some tests; re-init
            shutdownMaterialAPI();
            mock = createMaterialMockModule();
            initMaterialAPI(mock as unknown as ESEngineModule);

            const h1 = Material.create({ shader: 1 as ShaderHandle });
            const h2 = Material.create({ shader: 1 as ShaderHandle });
            const h3 = Material.create({ shader: 1 as ShaderHandle });
            expect(h1).toBe(1);
            expect(h2).toBe(2);
            expect(h3).toBe(3);
        });

        it('should store material with default values', () => {
            const h = Material.create({ shader: 42 as ShaderHandle });
            const data = Material.get(h);
            expect(data).toBeDefined();
            expect(data!.shader).toBe(42);
            expect(data!.blendMode).toBe(BlendMode.Normal);
            expect(data!.depthTest).toBe(false);
            expect(data!.depthWrite).toBe(true);
            expect(data!.cull).toBe(CullMode.None);
            expect(data!.uniforms.size).toBe(0);
        });

        it('should push the resolved render state to the engine store', () => {
            const h = Material.create({
                shader: 42 as ShaderHandle,
                blendMode: BlendMode.Additive,
                depthTest: true,
                cull: CullMode.Back,
            });
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                h, 42, BlendMode.Additive, flags(true, true, CullMode.Back),
            );
        });

        it('should accept optional uniforms', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_time: 0.5, u_color: { x: 1, y: 0, z: 0, w: 1 } },
            });
            const data = Material.get(h);
            expect(data!.uniforms.size).toBe(2);
            expect(data!.uniforms.get('u_time')).toBe(0.5);
        });

        it('should accept custom blendMode and depthTest', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                blendMode: BlendMode.Additive,
                depthTest: true,
            });
            const data = Material.get(h);
            expect(data!.blendMode).toBe(BlendMode.Additive);
            expect(data!.depthTest).toBe(true);
        });
    });

    describe('Material.get', () => {
        it('should return material data for valid handle', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            expect(Material.get(h)).toBeDefined();
        });

        it('should return undefined for invalid handle', () => {
            expect(Material.get(999 as MaterialHandle)).toBeUndefined();
        });
    });

    describe('Material.isValid', () => {
        it('should return true for existing material', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            expect(Material.isValid(h)).toBe(true);
        });

        it('should return false for non-existing material', () => {
            expect(Material.isValid(999 as MaterialHandle)).toBe(false);
        });

        it('should return false after release', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.release(h);
            expect(Material.isValid(h)).toBe(false);
        });
    });

    describe('Material.release', () => {
        it('should delete material and undefine it in the engine store', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.release(h);
            expect(Material.isValid(h)).toBe(false);
            expect(mock.undefineMaterial).toHaveBeenCalledWith(h);
        });
    });

    describe('Material.releaseAll', () => {
        it('should clear all materials and undefine each in the engine store', () => {
            const h1 = Material.create({ shader: 1 as ShaderHandle });
            const h2 = Material.create({ shader: 1 as ShaderHandle });
            Material.releaseAll();
            expect(Material.isValid(h1)).toBe(false);
            expect(Material.isValid(h2)).toBe(false);
            expect(mock.undefineMaterial).toHaveBeenCalledWith(h1);
            expect(mock.undefineMaterial).toHaveBeenCalledWith(h2);
        });
    });

    // =========================================================================
    // Uniform management
    // =========================================================================

    describe('Uniform management', () => {
        it('should set and get uniform value', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.setUniform(h, 'u_time', 3.14);
            expect(Material.getUniform(h, 'u_time')).toBe(3.14);
        });

        it('should return undefined for non-existing uniform', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            expect(Material.getUniform(h, 'nonexistent')).toBeUndefined();
        });

        it('should return undefined for invalid material handle', () => {
            expect(Material.getUniform(999 as MaterialHandle, 'u_val')).toBeUndefined();
        });

        it('should not throw when setting uniform on invalid handle', () => {
            expect(() => Material.setUniform(999 as MaterialHandle, 'u_val', 1.0)).not.toThrow();
        });
    });

    describe('Material.getUniforms', () => {
        it('should return a copy of uniforms map', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_a: 1, u_b: 2 },
            });
            const uniformsCopy = Material.getUniforms(h);
            expect(uniformsCopy.size).toBe(2);
            expect(uniformsCopy.get('u_a')).toBe(1);

            // Modifying copy should not affect original
            uniformsCopy.set('u_c', 3);
            expect(Material.getUniforms(h).size).toBe(2);
        });

        it('should return empty map for invalid handle', () => {
            const uniforms = Material.getUniforms(999 as MaterialHandle);
            expect(uniforms.size).toBe(0);
        });
    });

    // =========================================================================
    // BlendMode / DepthTest / DepthWrite / Cull / Shader
    // =========================================================================

    describe('BlendMode', () => {
        it('should set and get blend mode', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.setBlendMode(h, BlendMode.Multiply);
            expect(Material.getBlendMode(h)).toBe(BlendMode.Multiply);
        });

        it('should push the new state on setBlendMode', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.defineMaterial.mockClear();
            Material.setBlendMode(h, BlendMode.Additive);
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                h, 1, BlendMode.Additive, flags(false, true, CullMode.None),
            );
        });

        it('should return Normal for invalid handle', () => {
            expect(Material.getBlendMode(999 as MaterialHandle)).toBe(BlendMode.Normal);
        });
    });

    describe('DepthTest / DepthWrite / Cull', () => {
        it('should set depth test and push state', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.defineMaterial.mockClear();
            Material.setDepthTest(h, true);
            expect(Material.get(h)!.depthTest).toBe(true);
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                h, 1, BlendMode.Normal, flags(true, true, CullMode.None),
            );
        });

        it('should set depth write and push state', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.defineMaterial.mockClear();
            Material.setDepthWrite(h, false);
            expect(Material.get(h)!.depthWrite).toBe(false);
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                h, 1, BlendMode.Normal, flags(false, false, CullMode.None),
            );
        });

        it('should set cull mode and push state', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.defineMaterial.mockClear();
            Material.setCull(h, CullMode.Front);
            expect(Material.get(h)!.cull).toBe(CullMode.Front);
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                h, 1, BlendMode.Normal, flags(false, true, CullMode.Front),
            );
        });
    });

    describe('Material.getShader', () => {
        it('should return shader handle', () => {
            const h = Material.create({ shader: 42 as ShaderHandle });
            expect(Material.getShader(h)).toBe(42);
        });

        it('should return 0 for invalid handle', () => {
            expect(Material.getShader(999 as MaterialHandle)).toBe(0);
        });
    });

    // =========================================================================
    // createFromAsset
    // =========================================================================

    describe('Material.createFromAsset', () => {
        const baseAsset = (extra: Partial<MaterialAssetData>): MaterialAssetData => ({
            version: '1.0',
            type: 'material',
            shader: 'test.shader',
            blendMode: BlendMode.Normal,
            depthTest: false,
            properties: {},
            ...extra,
        });

        it('should parse number properties', () => {
            const h = Material.createFromAsset(baseAsset({ properties: { u_intensity: 0.75 } }), 10 as ShaderHandle);
            expect(Material.getUniform(h, 'u_intensity')).toBe(0.75);
        });

        it('should parse Color (with "a" key) as Vec4', () => {
            const h = Material.createFromAsset(
                baseAsset({ properties: { u_color: { r: 1, g: 0.5, b: 0.25, a: 1 } } }), 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_color') as { x: number; y: number; z: number; w: number };
            expect(val).toEqual({ x: 1, y: 0.5, z: 0.25, w: 1 });
        });

        it('should parse Vec4 (with "w" key)', () => {
            const h = Material.createFromAsset(
                baseAsset({ properties: { u_rect: { x: 0, y: 1, z: 2, w: 3 } } }), 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_rect') as { x: number; y: number; z: number; w: number };
            expect(val).toEqual({ x: 0, y: 1, z: 2, w: 3 });
        });

        it('should parse Vec3 (with "z" key)', () => {
            const h = Material.createFromAsset(
                baseAsset({ properties: { u_pos: { x: 1, y: 2, z: 3 } } }), 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_pos') as { x: number; y: number; z: number };
            expect(val).toEqual({ x: 1, y: 2, z: 3 });
        });

        it('should parse Vec2 (with "y" key)', () => {
            const h = Material.createFromAsset(
                baseAsset({ properties: { u_offset: { x: 5, y: 10 } } }), 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_offset') as { x: number; y: number };
            expect(val).toEqual({ x: 5, y: 10 });
        });

        it('should use blendMode, depthTest, depthWrite and cull from asset data', () => {
            const h = Material.createFromAsset(
                baseAsset({ blendMode: BlendMode.Screen, depthTest: true, depthWrite: false, cull: CullMode.Back }),
                10 as ShaderHandle);
            expect(Material.getBlendMode(h)).toBe(BlendMode.Screen);
            const data = Material.get(h)!;
            expect(data.depthTest).toBe(true);
            expect(data.depthWrite).toBe(false);
            expect(data.cull).toBe(CullMode.Back);
        });

        it('should default depthWrite/cull when absent from asset data', () => {
            const h = Material.createFromAsset(baseAsset({}), 10 as ShaderHandle);
            const data = Material.get(h)!;
            expect(data.depthWrite).toBe(true);
            expect(data.cull).toBe(CullMode.None);
        });

        it('should use provided shaderHandle', () => {
            const h = Material.createFromAsset(baseAsset({}), 77 as ShaderHandle);
            expect(Material.getShader(h)).toBe(77);
        });
    });

    // =========================================================================
    // createInstance
    // =========================================================================

    describe('Material.createInstance', () => {
        it('should inherit shader, uniforms, blendMode, depthTest from the parent', () => {
            const src = Material.create({
                shader: 42 as ShaderHandle,
                uniforms: { u_time: 1.5 },
                blendMode: BlendMode.Additive,
                depthTest: true,
            });
            const inst = Material.createInstance(src);

            expect(Material.getShader(inst)).toBe(42);
            expect(Material.getUniform(inst, 'u_time')).toBe(1.5);
            expect(Material.getBlendMode(inst)).toBe(BlendMode.Additive);
        });

        it('should push the flattened (inherited) instance to the engine store', () => {
            const src = Material.create({ shader: 5 as ShaderHandle, blendMode: BlendMode.Multiply });
            mock.defineMaterial.mockClear();
            const inst = Material.createInstance(src);
            expect(mock.defineMaterial).toHaveBeenCalledWith(
                inst, 5, BlendMode.Multiply, flags(false, true, CullMode.None),
            );
        });

        it('an instance override does not affect the parent', () => {
            const src = Material.create({ shader: 1 as ShaderHandle, uniforms: { u_val: 10 } });
            const inst = Material.createInstance(src);

            Material.setUniform(inst, 'u_val', 20);
            expect(Material.getUniform(src, 'u_val')).toBe(10);
            expect(Material.getUniform(inst, 'u_val')).toBe(20);
        });

        it('a parent edit PROPAGATES to a non-overriding instance', () => {
            const src = Material.create({ shader: 1 as ShaderHandle, uniforms: { u_val: 10 } });
            const inst = Material.createInstance(src);

            Material.setUniform(src, 'u_val', 99);
            expect(Material.getUniform(inst, 'u_val')).toBe(99);  // inherited the change
        });

        it('an overridden param shields the instance from parent edits', () => {
            const src = Material.create({ shader: 1 as ShaderHandle, uniforms: { u_val: 10 } });
            const inst = Material.createInstance(src);
            Material.setUniform(inst, 'u_val', 20);  // override

            Material.setUniform(src, 'u_val', 99);
            expect(Material.getUniform(inst, 'u_val')).toBe(20);  // override wins
        });

        it('an instance can override render state independently of the parent', () => {
            const src = Material.create({ shader: 1 as ShaderHandle, blendMode: BlendMode.Normal });
            const inst = Material.createInstance(src);
            Material.setBlendMode(inst, BlendMode.Additive);

            expect(Material.getBlendMode(inst)).toBe(BlendMode.Additive);
            expect(Material.getBlendMode(src)).toBe(BlendMode.Normal);
        });

        it('a parent edit re-pushes the instance to the engine (propagation)', () => {
            const src = Material.create({ shader: 1 as ShaderHandle, uniforms: { u_val: 10 } });
            const inst = Material.createInstance(src);
            mock.setMaterialUniform.mockClear();
            Material.setUniform(src, 'u_val', 99);
            // Both the parent and the inheriting instance are re-pushed with the new value.
            expect(mock.setMaterialUniform).toHaveBeenCalledWith(src, 'u_val', 1, 99, 0, 0, 0);
            expect(mock.setMaterialUniform).toHaveBeenCalledWith(inst, 'u_val', 1, 99, 0, 0, 0);
        });

        it('should throw for invalid source', () => {
            expect(() => Material.createInstance(999 as MaterialHandle)).toThrow(
                'Invalid source material: 999',
            );
        });

        it('should return a new handle different from source', () => {
            const src = Material.create({ shader: 1 as ShaderHandle });
            const inst = Material.createInstance(src);
            expect(inst).not.toBe(src);
            expect(inst).toBeGreaterThan(src);
        });
    });

    // =========================================================================
    // Material instance serialization (diff)
    // =========================================================================

    describe('Material instance serialization', () => {
        it('serializes an instance as a diff (instanceOf + only overrides)', () => {
            const src = Material.create({
                shader: 9 as ShaderHandle,
                uniforms: { u_a: 1, u_b: 2 },
                blendMode: BlendMode.Normal,
            });
            const inst = Material.createInstance(src);
            Material.setUniform(inst, 'u_a', 5);          // override one param
            Material.setBlendMode(inst, BlendMode.Additive);  // override render state

            const asset = Material.toAssetData(inst, '', 'parent.esmaterial')!;
            expect(asset.instanceOf).toBe('parent.esmaterial');
            expect(asset.properties).toEqual({ u_a: 5 });  // only the overridden param
            expect(asset.blendMode).toBe(BlendMode.Additive);
            expect(asset.depthTest).toBeUndefined();        // not overridden -> omitted
        });

        it('round-trips an instance via createFromAsset(parentHandle)', () => {
            const src = Material.create({ shader: 3 as ShaderHandle, uniforms: { u_a: 1 } });
            const asset: MaterialAssetData = {
                version: '1.0', type: 'material', shader: '', instanceOf: 'p.esmaterial',
                properties: { u_a: 7 },
            };
            const inst = Material.createFromAsset(asset, 0, src);
            expect(Material.getShader(inst)).toBe(3);        // inherited shader
            expect(Material.getUniform(inst, 'u_a')).toBe(7); // overridden value
        });

        it('a base material still serializes its full state', () => {
            const h = Material.create({ shader: 1 as ShaderHandle, blendMode: BlendMode.Multiply });
            const asset = Material.toAssetData(h, 'x.esshader')!;
            expect(asset.instanceOf).toBeUndefined();
            expect(asset.blendMode).toBe(BlendMode.Multiply);
        });
    });

    // =========================================================================
    // toAssetData
    // =========================================================================

    describe('Material.toAssetData', () => {
        it('should serialize to MaterialAssetData', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_time: 0.5 },
                blendMode: BlendMode.Multiply,
                depthTest: true,
            });
            const asset = Material.toAssetData(h, 'shaders/custom.shader');
            expect(asset).toEqual({
                version: '1.0',
                type: 'material',
                shader: 'shaders/custom.shader',
                blendMode: BlendMode.Multiply,
                depthTest: true,
                depthWrite: true,
                cull: CullMode.None,
                properties: { u_time: 0.5 },
            });
        });

        it('should return null for invalid material', () => {
            expect(Material.toAssetData(999 as MaterialHandle, 'path')).toBeNull();
        });

        it('should include all uniforms in properties', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: {
                    u_a: 1,
                    u_b: { x: 1, y: 2 },
                    u_c: { x: 1, y: 2, z: 3 },
                },
            });
            const asset = Material.toAssetData(h, 'test.shader')!;
            expect(Object.keys(asset.properties)).toHaveLength(3);
            expect(asset.properties['u_a']).toBe(1);
            expect(asset.properties['u_b']).toEqual({ x: 1, y: 2 });
            expect(asset.properties['u_c']).toEqual({ x: 1, y: 2, z: 3 });
        });
    });

    // =========================================================================
    // tex() and isTextureRef
    // =========================================================================

    describe('Material.tex', () => {
        it('should return TextureRef with __textureRef flag', () => {
            const ref = Material.tex(42);
            expect(ref.__textureRef).toBe(true);
            expect(ref.textureId).toBe(42);
            expect(ref.slot).toBeUndefined();
        });

        it('should accept optional slot', () => {
            const ref = Material.tex(10, 3);
            expect(ref.textureId).toBe(10);
            expect(ref.slot).toBe(3);
        });
    });

    describe('isTextureRef', () => {
        it('should return true for TextureRef objects', () => {
            expect(isTextureRef(Material.tex(1))).toBe(true);
            expect(isTextureRef({ __textureRef: true, textureId: 5 } as TextureRef)).toBe(true);
        });

        it('should return false for numbers', () => {
            expect(isTextureRef(42)).toBe(false);
        });

        it('should return false for Vec2', () => {
            expect(isTextureRef({ x: 1, y: 2 })).toBe(false);
        });

        it('should return false for Vec3', () => {
            expect(isTextureRef({ x: 1, y: 2, z: 3 })).toBe(false);
        });

        it('should return false for Vec4', () => {
            expect(isTextureRef({ x: 1, y: 2, z: 3, w: 4 })).toBe(false);
        });

        it('should return false for arrays', () => {
            expect(isTextureRef([1, 2, 3])).toBe(false);
        });
    });

    // =========================================================================
    // Material parameter push (P1: reflection-driven MaterialConstants UBO)
    // =========================================================================

    describe('material parameter push', () => {
        it('compileShader proxies to module.compileEsshader (no switches => empty features)', () => {
            const h = Material.compileShader('#pragma shader "x"');
            expect(h).toBe(7);
            expect(mock.compileEsshader).toHaveBeenCalledWith('#pragma shader "x"', '');
        });

        it('compileShader passes enabled switches as a CSV feature set', () => {
            mock.compileEsshader.mockClear();
            Material.compileShader('src', ['USE_A', 'USE_B']);
            expect(mock.compileEsshader).toHaveBeenCalledWith('src', 'USE_A,USE_B');
        });

        it('stores static switches and round-trips them through toAssetData', () => {
            const h = Material.create({ shader: 1 as ShaderHandle, switches: { USE_GREEN: true } });
            expect(Material.getSwitch(h, 'USE_GREEN')).toBe(true);
            expect(Material.getSwitch(h, 'USE_NOPE')).toBe(false);
            const asset = Material.toAssetData(h, 'x.esshader')!;
            expect(asset.switches).toEqual({ USE_GREEN: true });
        });

        it('pushes uniform values to the engine on create', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_tint: { x: 1, y: 0, z: 0, w: 1 } },
            });
            expect(mock.setMaterialUniform).toHaveBeenCalledWith(h, 'u_tint', 4, 1, 0, 0, 1);
        });

        it('pushes the value on setUniform', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.setMaterialUniform.mockClear();
            Material.setUniform(h, 'u_strength', 2.5);
            expect(mock.setMaterialUniform).toHaveBeenCalledWith(h, 'u_strength', 1, 2.5, 0, 0, 0);
        });

        it('routes texture refs to setMaterialTexture (not the std140 uniform path)', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.setMaterialUniform.mockClear();
            mock.setMaterialTexture.mockClear();
            Material.setUniform(h, 'u_tex', Material.tex(5));
            expect(mock.setMaterialUniform).not.toHaveBeenCalled();
            expect(mock.setMaterialTexture).toHaveBeenCalledWith(h, 'u_tex', 5);
        });
    });

    // =========================================================================
    // ShaderSources constants
    // =========================================================================

    describe('ShaderSources', () => {
        it('should have SPRITE_VERTEX containing vertex shader markers', () => {
            expect(ShaderSources.SPRITE_VERTEX).toContain('#version 300 es');
            expect(ShaderSources.SPRITE_VERTEX).toContain('a_position');
            expect(ShaderSources.SPRITE_VERTEX).toContain('gl_Position');
        });

        it('should have SPRITE_FRAGMENT containing fragment shader markers', () => {
            expect(ShaderSources.SPRITE_FRAGMENT).toContain('#version 300 es');
            expect(ShaderSources.SPRITE_FRAGMENT).toContain('u_texture');
            expect(ShaderSources.SPRITE_FRAGMENT).toContain('fragColor');
        });

        it('should have COLOR_VERTEX containing vertex shader markers', () => {
            expect(ShaderSources.COLOR_VERTEX).toContain('#version 300 es');
            expect(ShaderSources.COLOR_VERTEX).toContain('a_position');
            expect(ShaderSources.COLOR_VERTEX).toContain('gl_Position');
        });

        it('should have COLOR_FRAGMENT containing fragment shader markers', () => {
            expect(ShaderSources.COLOR_FRAGMENT).toContain('#version 300 es');
            expect(ShaderSources.COLOR_FRAGMENT).toContain('v_color');
            expect(ShaderSources.COLOR_FRAGMENT).toContain('fragColor');
        });

        it('should have COLOR_FRAGMENT without texture sampler', () => {
            expect(ShaderSources.COLOR_FRAGMENT).not.toContain('u_texture');
        });
    });

    // =========================================================================
    // Uninitialized guard
    // =========================================================================

    describe('uninitialized guard', () => {
        it('should throw when createShader called without init', () => {
            shutdownMaterialAPI();
            shutdownResourceManager();
            expect(() => Material.createShader('v', 'f')).toThrow(
                'ResourceManager not initialized',
            );
        });

        it('should throw when releaseShader called without init for valid handle', () => {
            shutdownMaterialAPI();
            shutdownResourceManager();
            expect(() => Material.releaseShader(1 as ShaderHandle)).toThrow(
                'ResourceManager not initialized',
            );
        });
    });
});
