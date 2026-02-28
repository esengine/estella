import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    Material,
    ShaderSources,
    isTextureRef,
    initMaterialAPI,
    shutdownMaterialAPI,
    registerMaterialCallback,
} from '../src/material';
import type {
    MaterialHandle,
    ShaderHandle,
    TextureRef,
    UniformValue,
    MaterialAssetData,
} from '../src/material';
import type { ESEngineModule } from '../src/wasm';
import { BlendMode } from '../src/blend';

// =============================================================================
// Mock WASM module for Material API
// =============================================================================

function createMaterialMockModule() {
    const heapBuffer = new ArrayBuffer(1024 * 1024);

    const resourceManager = {
        createShader: vi.fn().mockReturnValue(1),
        releaseShader: vi.fn(),
    };

    const mock = {
        _malloc: vi.fn((_size: number) => 1024),
        _free: vi.fn(),
        HEAPU8: new Uint8Array(heapBuffer),
        HEAPU32: new Uint32Array(heapBuffer),
        HEAPF32: new Float32Array(heapBuffer),
        getResourceManager: vi.fn(() => resourceManager),
        resourceManager,
        invalidateMaterialCache: vi.fn(),
        clearMaterialCache: vi.fn(),
        materialDataProvider: null as
            | ((
                  materialId: number,
                  outShaderIdPtr: number,
                  outBlendModePtr: number,
                  outUniformBufferPtr: number,
                  outUniformCountPtr: number,
              ) => void)
            | null,
    };

    return mock;
}

type MockModule = ReturnType<typeof createMaterialMockModule>;

// =============================================================================
// Tests
// =============================================================================

describe('Material API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createMaterialMockModule();
        initMaterialAPI(mock as unknown as ESEngineModule);
    });

    afterEach(() => {
        shutdownMaterialAPI();
    });

    // =========================================================================
    // initMaterialAPI / shutdownMaterialAPI
    // =========================================================================

    describe('initMaterialAPI', () => {
        it('should store resourceManager from module', () => {
            expect(mock.getResourceManager).toHaveBeenCalled();
        });

        it('should register material callback', () => {
            expect(mock.materialDataProvider).toBeTypeOf('function');
        });
    });

    describe('shutdownMaterialAPI', () => {
        it('should free uniform buffer if allocated', () => {
            const mat = Material.create({ shader: 1 as ShaderHandle });
            Material.setUniform(mat, 'u_val', 1.0);

            // Trigger callback to allocate uniform buffer
            if (mock.materialDataProvider) {
                mock.materialDataProvider(mat, 0, 4, 8, 12);
            }

            shutdownMaterialAPI();
            expect(mock._free).toHaveBeenCalled();
        });

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
            expect(data!.dirty_).toBe(true);
            expect(data!.uniforms.size).toBe(0);
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
        it('should delete material and call invalidateMaterialCache', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.release(h);
            expect(Material.isValid(h)).toBe(false);
            expect(mock.invalidateMaterialCache).toHaveBeenCalledWith(h);
        });
    });

    describe('Material.releaseAll', () => {
        it('should clear all materials and call clearMaterialCache', () => {
            const h1 = Material.create({ shader: 1 as ShaderHandle });
            const h2 = Material.create({ shader: 1 as ShaderHandle });
            Material.releaseAll();
            expect(Material.isValid(h1)).toBe(false);
            expect(Material.isValid(h2)).toBe(false);
            expect(mock.clearMaterialCache).toHaveBeenCalled();
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

        it('should mark dirty and invalidate cache on setUniform', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            const data = Material.get(h)!;
            data.dirty_ = false;

            Material.setUniform(h, 'u_val', 1.0);
            expect(data.dirty_).toBe(true);
            expect(mock.invalidateMaterialCache).toHaveBeenCalledWith(h);
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
    // BlendMode / DepthTest / Shader
    // =========================================================================

    describe('BlendMode', () => {
        it('should set and get blend mode', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            Material.setBlendMode(h, BlendMode.Multiply);
            expect(Material.getBlendMode(h)).toBe(BlendMode.Multiply);
        });

        it('should call invalidateMaterialCache on setBlendMode', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.invalidateMaterialCache.mockClear();
            Material.setBlendMode(h, BlendMode.Additive);
            expect(mock.invalidateMaterialCache).toHaveBeenCalledWith(h);
        });

        it('should return Normal for invalid handle', () => {
            expect(Material.getBlendMode(999 as MaterialHandle)).toBe(BlendMode.Normal);
        });
    });

    describe('DepthTest', () => {
        it('should set depth test and invalidate cache', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            mock.invalidateMaterialCache.mockClear();
            Material.setDepthTest(h, true);
            const data = Material.get(h)!;
            expect(data.depthTest).toBe(true);
            expect(mock.invalidateMaterialCache).toHaveBeenCalledWith(h);
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
        it('should parse number properties', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: { u_intensity: 0.75 },
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            expect(Material.getUniform(h, 'u_intensity')).toBe(0.75);
        });

        it('should parse Color (with "a" key) as Vec4', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: {
                    u_color: { r: 1, g: 0.5, b: 0.25, a: 1 },
                },
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_color') as { x: number; y: number; z: number; w: number };
            expect(val).toEqual({ x: 1, y: 0.5, z: 0.25, w: 1 });
        });

        it('should parse Vec4 (with "w" key)', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: {
                    u_rect: { x: 0, y: 1, z: 2, w: 3 },
                },
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_rect') as { x: number; y: number; z: number; w: number };
            expect(val).toEqual({ x: 0, y: 1, z: 2, w: 3 });
        });

        it('should parse Vec3 (with "z" key)', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: {
                    u_pos: { x: 1, y: 2, z: 3 },
                },
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_pos') as { x: number; y: number; z: number };
            expect(val).toEqual({ x: 1, y: 2, z: 3 });
        });

        it('should parse Vec2 (with "y" key)', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: {
                    u_offset: { x: 5, y: 10 },
                },
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            const val = Material.getUniform(h, 'u_offset') as { x: number; y: number };
            expect(val).toEqual({ x: 5, y: 10 });
        });

        it('should use blendMode and depthTest from asset data', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Screen,
                depthTest: true,
                properties: {},
            };
            const h = Material.createFromAsset(assetData, 10 as ShaderHandle);
            expect(Material.getBlendMode(h)).toBe(BlendMode.Screen);
            expect(Material.get(h)!.depthTest).toBe(true);
        });

        it('should use provided shaderHandle', () => {
            const assetData: MaterialAssetData = {
                version: '1.0',
                type: 'material',
                shader: 'test.shader',
                blendMode: BlendMode.Normal,
                depthTest: false,
                properties: {},
            };
            const h = Material.createFromAsset(assetData, 77 as ShaderHandle);
            expect(Material.getShader(h)).toBe(77);
        });
    });

    // =========================================================================
    // createInstance
    // =========================================================================

    describe('Material.createInstance', () => {
        it('should copy shader, uniforms, blendMode, depthTest from source', () => {
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
            expect(Material.get(inst)!.depthTest).toBe(true);
        });

        it('should create independent instance (modifying instance does not affect source)', () => {
            const src = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_val: 10 },
            });
            const inst = Material.createInstance(src);

            Material.setUniform(inst, 'u_val', 20);
            expect(Material.getUniform(src, 'u_val')).toBe(10);
            expect(Material.getUniform(inst, 'u_val')).toBe(20);
        });

        it('should create independent instance (modifying source does not affect instance)', () => {
            const src = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_val: 10 },
            });
            const inst = Material.createInstance(src);

            Material.setUniform(src, 'u_val', 99);
            expect(Material.getUniform(inst, 'u_val')).toBe(10);
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
    // registerMaterialCallback
    // =========================================================================

    describe('registerMaterialCallback', () => {
        it('should set materialDataProvider on module', () => {
            expect(mock.materialDataProvider).toBeTypeOf('function');
        });

        it('should be idempotent (second call is no-op)', () => {
            const firstProvider = mock.materialDataProvider;
            registerMaterialCallback();
            expect(mock.materialDataProvider).toBe(firstProvider);
        });
    });

    // =========================================================================
    // materialDataProvider callback
    // =========================================================================

    describe('materialDataProvider callback', () => {
        it('should write shader and blendMode to outPtrs for valid material', () => {
            const h = Material.create({
                shader: 7 as ShaderHandle,
                blendMode: BlendMode.Additive,
            });

            const outShader = 256;
            const outBlend = 260;
            const outUniBuf = 264;
            const outUniCount = 268;

            mock.materialDataProvider!(h, outShader, outBlend, outUniBuf, outUniCount);

            expect(mock.HEAPU32[outShader >> 2]).toBe(7);
            expect(mock.HEAPU32[outBlend >> 2]).toBe(BlendMode.Additive);
        });

        it('should write zeros for unknown materialId', () => {
            const outShader = 256;
            const outBlend = 260;
            const outUniBuf = 264;
            const outUniCount = 268;

            mock.materialDataProvider!(999, outShader, outBlend, outUniBuf, outUniCount);

            expect(mock.HEAPU32[outShader >> 2]).toBe(0);
            expect(mock.HEAPU32[outBlend >> 2]).toBe(0);
            expect(mock.HEAPU32[outUniBuf >> 2]).toBe(0);
            expect(mock.HEAPU32[outUniCount >> 2]).toBe(0);
        });

        it('should serialize uniforms and report count', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_time: 1.0, u_scale: 2.0 },
            });

            const outShader = 256;
            const outBlend = 260;
            const outUniBuf = 264;
            const outUniCount = 268;

            mock.materialDataProvider!(h, outShader, outBlend, outUniBuf, outUniCount);

            const uniformCount = mock.HEAPU32[outUniCount >> 2];
            expect(uniformCount).toBe(2);
            expect(mock.HEAPU32[outUniBuf >> 2]).toBeGreaterThan(0);
        });

        it('should skip TextureRef uniforms in serialization count', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: {
                    u_time: 1.0,
                    u_tex: Material.tex(5),
                },
            });

            const outShader = 256;
            const outBlend = 260;
            const outUniBuf = 264;
            const outUniCount = 268;

            mock.materialDataProvider!(h, outShader, outBlend, outUniBuf, outUniCount);

            const uniformCount = mock.HEAPU32[outUniCount >> 2];
            expect(uniformCount).toBe(1);
        });
    });

    // =========================================================================
    // serializeUniforms (tested via materialDataProvider callback)
    // =========================================================================

    describe('serializeUniforms (via callback)', () => {
        function callProvider(h: MaterialHandle) {
            const outShader = 256;
            const outBlend = 260;
            const outUniBuf = 264;
            const outUniCount = 268;
            mock.materialDataProvider!(h, outShader, outBlend, outUniBuf, outUniCount);
            return {
                count: mock.HEAPU32[outUniCount >> 2],
                bufferPtr: mock.HEAPU32[outUniBuf >> 2],
            };
        }

        it('should serialize number uniform (type 0)', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { u_val: 42.5 },
            });

            const { count, bufferPtr } = callProvider(h);
            expect(count).toBe(1);

            // Read name length
            const nameLen = mock.HEAPU32[bufferPtr >> 2];
            expect(nameLen).toBe(5); // "u_val"

            // Read type after padded name
            const namePadded = Math.ceil(nameLen / 4) * 4;
            const typeOffset = bufferPtr + 4 + namePadded;
            const type = mock.HEAPU32[typeOffset >> 2];
            expect(type).toBe(0); // number type

            // Read first float value
            const valOffset = typeOffset + 4;
            expect(mock.HEAPF32[valOffset >> 2]).toBeCloseTo(42.5);
        });

        it('should serialize Vec2 uniform (type 1)', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { uv: { x: 3, y: 4 } },
            });

            const { count, bufferPtr } = callProvider(h);
            expect(count).toBe(1);

            const nameLen = mock.HEAPU32[bufferPtr >> 2];
            const namePadded = Math.ceil(nameLen / 4) * 4;
            const typeOffset = bufferPtr + 4 + namePadded;
            expect(mock.HEAPU32[typeOffset >> 2]).toBe(1);

            const valOffset = typeOffset + 4;
            expect(mock.HEAPF32[valOffset >> 2]).toBeCloseTo(3);
            expect(mock.HEAPF32[(valOffset + 4) >> 2]).toBeCloseTo(4);
        });

        it('should serialize Vec3 uniform (type 2)', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { pos: { x: 1, y: 2, z: 3 } },
            });

            const { count, bufferPtr } = callProvider(h);
            expect(count).toBe(1);

            const nameLen = mock.HEAPU32[bufferPtr >> 2];
            const namePadded = Math.ceil(nameLen / 4) * 4;
            const typeOffset = bufferPtr + 4 + namePadded;
            expect(mock.HEAPU32[typeOffset >> 2]).toBe(2);

            const valOffset = typeOffset + 4;
            expect(mock.HEAPF32[valOffset >> 2]).toBeCloseTo(1);
            expect(mock.HEAPF32[(valOffset + 4) >> 2]).toBeCloseTo(2);
            expect(mock.HEAPF32[(valOffset + 8) >> 2]).toBeCloseTo(3);
        });

        it('should serialize Vec4 uniform (type 3)', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: { col: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 } },
            });

            const { count, bufferPtr } = callProvider(h);
            expect(count).toBe(1);

            const nameLen = mock.HEAPU32[bufferPtr >> 2];
            const namePadded = Math.ceil(nameLen / 4) * 4;
            const typeOffset = bufferPtr + 4 + namePadded;
            expect(mock.HEAPU32[typeOffset >> 2]).toBe(3);

            const valOffset = typeOffset + 4;
            expect(mock.HEAPF32[valOffset >> 2]).toBeCloseTo(0.1);
            expect(mock.HEAPF32[(valOffset + 4) >> 2]).toBeCloseTo(0.2);
            expect(mock.HEAPF32[(valOffset + 8) >> 2]).toBeCloseTo(0.3);
            expect(mock.HEAPF32[(valOffset + 12) >> 2]).toBeCloseTo(0.4);
        });

        it('should skip TextureRef uniforms', () => {
            const h = Material.create({
                shader: 1 as ShaderHandle,
                uniforms: {
                    u_tex: Material.tex(1),
                    u_val: 5.0,
                },
            });

            const { count } = callProvider(h);
            expect(count).toBe(1);
        });

        it('should handle material with no uniforms', () => {
            const h = Material.create({ shader: 1 as ShaderHandle });
            const { count } = callProvider(h);
            expect(count).toBe(0);
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
            expect(() => Material.createShader('v', 'f')).toThrow(
                'Material API not initialized',
            );
        });

        it('should throw when releaseShader called without init for valid handle', () => {
            shutdownMaterialAPI();
            expect(() => Material.releaseShader(1 as ShaderHandle)).toThrow(
                'Material API not initialized',
            );
        });
    });
});
