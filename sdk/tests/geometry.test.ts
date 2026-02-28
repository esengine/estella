import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    Geometry,
    DataType,
    initGeometryAPI,
    shutdownGeometryAPI,
} from '../src/geometry';
import type { GeometryHandle } from '../src/geometry';
import type { ESEngineModule } from '../src/wasm';

// =============================================================================
// Mock WASM module for Geometry API
// =============================================================================

function createGeometryMockModule() {
    let nextHandle = 1;
    const validHandles = new Set<number>();
    const heapBuffer = new ArrayBuffer(1024 * 1024);

    const mock = {
        _malloc: vi.fn((size: number) => {
            return size;
        }),
        _free: vi.fn(),
        HEAPF32: new Float32Array(heapBuffer),
        HEAPU8: new Uint8Array(heapBuffer),
        geometry_create: vi.fn(() => {
            const h = nextHandle++;
            validHandles.add(h);
            return h;
        }),
        geometry_init: vi.fn(),
        geometry_setIndices16: vi.fn(),
        geometry_setIndices32: vi.fn(),
        geometry_updateVertices: vi.fn(),
        geometry_release: vi.fn((h: number) => {
            validHandles.delete(h);
        }),
        geometry_isValid: vi.fn((h: number) => validHandles.has(h)),

        _nextHandle: () => nextHandle,
        _validHandles: validHandles,
    };

    return mock;
}

type MockModule = ReturnType<typeof createGeometryMockModule>;

// =============================================================================
// Tests
// =============================================================================

describe('Geometry API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createGeometryMockModule();
        initGeometryAPI(mock as unknown as ESEngineModule);
    });

    afterEach(() => {
        shutdownGeometryAPI();
    });

    // =========================================================================
    // initGeometryAPI / shutdownGeometryAPI
    // =========================================================================

    describe('initGeometryAPI', () => {
        it('should allocate vertex, index, and layout buffers', () => {
            expect(mock._malloc).toHaveBeenCalledTimes(3);
        });
    });

    describe('shutdownGeometryAPI', () => {
        it('should free all allocated buffers', () => {
            shutdownGeometryAPI();
            expect(mock._free).toHaveBeenCalledTimes(3);
        });

        it('should handle double shutdown gracefully', () => {
            shutdownGeometryAPI();
            shutdownGeometryAPI();
            expect(mock._free).toHaveBeenCalledTimes(3);
        });
    });

    // =========================================================================
    // getModule guard
    // =========================================================================

    describe('uninitialized guard', () => {
        it('should throw when API not initialized', () => {
            shutdownGeometryAPI();
            expect(() => Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            })).toThrow('Geometry API not initialized');
        });
    });

    // =========================================================================
    // Geometry.create
    // =========================================================================

    describe('Geometry.create', () => {
        it('should create geometry and return a handle', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0, 1, 0, 0, 1]),
                layout: [{ name: 'a_position', type: DataType.Float3 }],
            });

            expect(handle).toBeGreaterThan(0);
            expect(mock.geometry_create).toHaveBeenCalledOnce();
            expect(mock.geometry_init).toHaveBeenCalledOnce();
        });

        it('should pass vertex data to HEAPF32', () => {
            const verts = new Float32Array([1, 2, 3, 4]);
            Geometry.create({
                vertices: verts,
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });

            expect(mock.geometry_init).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number),
                4,
                expect.any(Number),
                1,
                false,
            );
        });

        it('should pass layout types to geometry_init', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0, 0, 0]),
                layout: [
                    { name: 'a_position', type: DataType.Float2 },
                    { name: 'a_texCoord', type: DataType.Float2 },
                ],
            });

            expect(mock.geometry_init).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number),
                4,
                expect.any(Number),
                2,
                false,
            );
        });

        it('should pass dynamic flag', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                dynamic: true,
            });

            expect(mock.geometry_init).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                true,
            );
        });

        it('should default dynamic to false', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });

            expect(mock.geometry_init).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                expect.any(Number),
                false,
            );
        });

        it('should throw when geometry_create returns 0', () => {
            mock.geometry_create.mockReturnValueOnce(0);
            expect(() => Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            })).toThrow('Failed to create geometry');
        });

        it('should throw when vertex data exceeds buffer size', () => {
            const huge = new Float32Array(64 * 1024 + 1);
            expect(() => Geometry.create({
                vertices: huge,
                layout: [{ name: 'a_pos', type: DataType.Float }],
            })).toThrow('Vertex data too large');
        });

        // Indices
        it('should handle Uint16Array indices', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0, 1, 0, 0, 1]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                indices: new Uint16Array([0, 1, 2]),
            });

            expect(mock.geometry_setIndices16).toHaveBeenCalledOnce();
            expect(mock.geometry_setIndices32).not.toHaveBeenCalled();
        });

        it('should handle Uint32Array indices', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0, 1, 0, 0, 1]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                indices: new Uint32Array([0, 1, 2]),
            });

            expect(mock.geometry_setIndices32).toHaveBeenCalledOnce();
            expect(mock.geometry_setIndices16).not.toHaveBeenCalled();
        });

        it('should throw when index data exceeds buffer size', () => {
            const hugeIdx = new Uint16Array(16 * 1024 + 1);
            expect(() => Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                indices: hugeIdx,
            })).toThrow('Index data too large');
        });

        it('should not call setIndices when no indices provided', () => {
            Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });

            expect(mock.geometry_setIndices16).not.toHaveBeenCalled();
            expect(mock.geometry_setIndices32).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Geometry.updateVertices
    // =========================================================================

    describe('Geometry.updateVertices', () => {
        it('should update vertices on a handle', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                dynamic: true,
            });

            const newVerts = new Float32Array([1, 1]);
            Geometry.updateVertices(handle, newVerts);

            expect(mock.geometry_updateVertices).toHaveBeenCalledWith(
                handle,
                expect.any(Number),
                2,
                0,
            );
        });

        it('should pass offset parameter', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                dynamic: true,
            });

            Geometry.updateVertices(handle, new Float32Array([5, 5]), 4);

            expect(mock.geometry_updateVertices).toHaveBeenCalledWith(
                handle,
                expect.any(Number),
                2,
                4,
            );
        });

        it('should throw when vertex data too large', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
                dynamic: true,
            });

            const huge = new Float32Array(64 * 1024 + 1);
            expect(() => Geometry.updateVertices(handle, huge)).toThrow('Vertex data too large');
        });
    });

    // =========================================================================
    // Geometry.release
    // =========================================================================

    describe('Geometry.release', () => {
        it('should call geometry_release for valid handle', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });

            Geometry.release(handle);
            expect(mock.geometry_release).toHaveBeenCalledWith(handle);
        });

        it('should skip release for handle <= 0', () => {
            Geometry.release(0);
            Geometry.release(-1 as GeometryHandle);
            expect(mock.geometry_release).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Geometry.isValid
    // =========================================================================

    describe('Geometry.isValid', () => {
        it('should return true for valid handle', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });

            expect(Geometry.isValid(handle)).toBe(true);
        });

        it('should return false after release', () => {
            const handle = Geometry.create({
                vertices: new Float32Array([0, 0]),
                layout: [{ name: 'a_pos', type: DataType.Float2 }],
            });
            Geometry.release(handle);
            expect(Geometry.isValid(handle)).toBe(false);
        });

        it('should return false for handle <= 0', () => {
            expect(Geometry.isValid(0)).toBe(false);
            expect(Geometry.isValid(-1)).toBe(false);
        });

        it('should return false when module not initialized', () => {
            shutdownGeometryAPI();
            expect(Geometry.isValid(1)).toBe(false);
        });
    });

    // =========================================================================
    // Helper: createQuad
    // =========================================================================

    describe('Geometry.createQuad', () => {
        it('should create a unit quad by default', () => {
            const handle = Geometry.createQuad();
            expect(handle).toBeGreaterThan(0);
            expect(mock.geometry_create).toHaveBeenCalledOnce();
            expect(mock.geometry_setIndices16).toHaveBeenCalledOnce();
        });

        it('should create a quad with custom size', () => {
            const handle = Geometry.createQuad(2, 4);
            expect(handle).toBeGreaterThan(0);

            const initCall = mock.geometry_init.mock.calls[0];
            expect(initCall[2]).toBe(16);
        });

        it('should produce 4 vertices (16 floats: x,y,u,v each)', () => {
            Geometry.createQuad();
            const initCall = mock.geometry_init.mock.calls[0];
            expect(initCall[2]).toBe(16);
        });

        it('should produce 6 indices (two triangles)', () => {
            Geometry.createQuad();
            const indicesCall = mock.geometry_setIndices16.mock.calls[0];
            expect(indicesCall[2]).toBe(6);
        });
    });

    // =========================================================================
    // Helper: createCircle
    // =========================================================================

    describe('Geometry.createCircle', () => {
        it('should create a circle with default parameters', () => {
            const handle = Geometry.createCircle();
            expect(handle).toBeGreaterThan(0);
        });

        it('should have center + (segments+1) vertices', () => {
            const segments = 8;
            Geometry.createCircle(1, segments);
            const initCall = mock.geometry_init.mock.calls[0];
            const vertexFloats = initCall[2] as number;
            const vertexCount = vertexFloats / 4;
            expect(vertexCount).toBe(1 + segments + 1);
        });

        it('should have segments * 3 indices', () => {
            const segments = 8;
            Geometry.createCircle(1, segments);
            const indicesCall = mock.geometry_setIndices16.mock.calls[0];
            expect(indicesCall[2]).toBe(segments * 3);
        });
    });

    // =========================================================================
    // Helper: createPolygon
    // =========================================================================

    describe('Geometry.createPolygon', () => {
        it('should create a polygon from points', () => {
            const handle = Geometry.createPolygon([
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
            ]);
            expect(handle).toBeGreaterThan(0);
        });

        it('should throw with fewer than 3 points', () => {
            expect(() => Geometry.createPolygon([
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ])).toThrow('Polygon must have at least 3 points');
        });

        it('should produce correct vertex count', () => {
            const pts = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ];
            Geometry.createPolygon(pts);
            const initCall = mock.geometry_init.mock.calls[0];
            const vertexFloats = initCall[2] as number;
            expect(vertexFloats).toBe(pts.length * 4);
        });

        it('should produce fan triangulation indices', () => {
            const pts = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
                { x: -1, y: 0 },
            ];
            Geometry.createPolygon(pts);
            const indicesCall = mock.geometry_setIndices16.mock.calls[0];
            expect(indicesCall[2]).toBe((pts.length - 2) * 3);
        });
    });

    // =========================================================================
    // DataType enum
    // =========================================================================

    describe('DataType enum', () => {
        it('should have correct values', () => {
            expect(DataType.Float).toBe(1);
            expect(DataType.Float2).toBe(2);
            expect(DataType.Float3).toBe(3);
            expect(DataType.Float4).toBe(4);
            expect(DataType.Int).toBe(5);
            expect(DataType.Int2).toBe(6);
            expect(DataType.Int3).toBe(7);
            expect(DataType.Int4).toBe(8);
        });
    });
});
