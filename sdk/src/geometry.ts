/**
 * @file    geometry.ts
 * @brief   Geometry API for custom mesh rendering
 * @details Provides geometry creation and management for custom shapes,
 *          particles, trails, and other procedural meshes.
 */

import type { ESEngineModule } from './wasm';

// =============================================================================
// Types
// =============================================================================

export type GeometryHandle = number;

export enum DataType {
    Float = 1,
    Float2 = 2,
    Float3 = 3,
    Float4 = 4,
    Int = 5,
    Int2 = 6,
    Int3 = 7,
    Int4 = 8,
}

export interface VertexAttributeDescriptor {
    name: string;
    type: DataType;
}

export interface GeometryOptions {
    vertices: Float32Array;
    layout: VertexAttributeDescriptor[];
    indices?: Uint16Array | Uint32Array;
    dynamic?: boolean;
}

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;
let vertexPtr: number = 0;
let indexPtr: number = 0;
let layoutPtr: number = 0;

const VERTEX_BUFFER_SIZE = 64 * 1024;
const INDEX_BUFFER_SIZE = 16 * 1024;
const LAYOUT_BUFFER_SIZE = 64;

// =============================================================================
// Initialization
// =============================================================================

export function initGeometryAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
    vertexPtr = module._malloc(VERTEX_BUFFER_SIZE * 4);
    indexPtr = module._malloc(INDEX_BUFFER_SIZE * 4);
    layoutPtr = module._malloc(LAYOUT_BUFFER_SIZE * 4);
}

export function shutdownGeometryAPI(): void {
    if (module) {
        if (vertexPtr) module._free(vertexPtr);
        if (indexPtr) module._free(indexPtr);
        if (layoutPtr) module._free(layoutPtr);
        vertexPtr = 0;
        indexPtr = 0;
        layoutPtr = 0;
    }
    module = null;
}

// =============================================================================
// Geometry API
// =============================================================================

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('Geometry API not initialized. Call initGeometryAPI() first.');
    }
    return module;
}

export const Geometry = {
    /**
     * Creates a new geometry with vertices and optional indices.
     * @param options Geometry creation options
     * @returns Geometry handle
     */
    create(options: GeometryOptions): GeometryHandle {
        const m = getModule();

        const handle = m.geometry_create();
        if (handle === 0) {
            throw new Error('Failed to create geometry');
        }

        const vertexCount = options.vertices.length;
        if (vertexCount * 4 > VERTEX_BUFFER_SIZE * 4) {
            throw new Error(`Vertex data too large: ${vertexCount} floats (max ${VERTEX_BUFFER_SIZE})`);
        }

        m.HEAPF32.set(options.vertices, vertexPtr / 4);

        const layoutCount = options.layout.length;
        const layoutArray = new Int32Array(layoutCount);
        for (let i = 0; i < layoutCount; i++) {
            layoutArray[i] = options.layout[i].type;
        }
        const heap32 = new Int32Array(m.HEAPU8.buffer, layoutPtr, layoutCount);
        heap32.set(layoutArray);

        m.geometry_init(
            handle,
            vertexPtr,
            vertexCount,
            layoutPtr,
            layoutCount,
            options.dynamic ?? false
        );

        if (options.indices) {
            const indexCount = options.indices.length;
            if (indexCount * 4 > INDEX_BUFFER_SIZE * 4) {
                throw new Error(`Index data too large: ${indexCount} indices (max ${INDEX_BUFFER_SIZE})`);
            }

            if (options.indices instanceof Uint16Array) {
                const heap16 = new Uint16Array(m.HEAPU8.buffer, indexPtr, indexCount);
                heap16.set(options.indices);
                m.geometry_setIndices16(handle, indexPtr, indexCount);
            } else {
                const heap32 = new Uint32Array(m.HEAPU8.buffer, indexPtr, indexCount);
                heap32.set(options.indices);
                m.geometry_setIndices32(handle, indexPtr, indexCount);
            }
        }

        return handle;
    },

    /**
     * Updates vertices of a dynamic geometry.
     * @param handle Geometry handle
     * @param vertices New vertex data
     * @param offset Offset in floats
     */
    updateVertices(handle: GeometryHandle, vertices: Float32Array, offset = 0): void {
        const m = getModule();

        const vertexCount = vertices.length;
        if (vertexCount * 4 > VERTEX_BUFFER_SIZE * 4) {
            throw new Error(`Vertex data too large: ${vertexCount} floats (max ${VERTEX_BUFFER_SIZE})`);
        }

        m.HEAPF32.set(vertices, vertexPtr / 4);
        m.geometry_updateVertices(handle, vertexPtr, vertexCount, offset);
    },

    /**
     * Releases a geometry.
     * @param handle Geometry handle
     */
    release(handle: GeometryHandle): void {
        if (handle > 0) {
            getModule().geometry_release(handle);
        }
    },

    /**
     * Checks if a geometry handle is valid.
     * @param handle Geometry handle
     * @returns True if valid
     */
    isValid(handle: GeometryHandle): boolean {
        if (!module || handle <= 0) return false;
        return module.geometry_isValid(handle);
    },

    // =========================================================================
    // Helper Functions
    // =========================================================================

    /**
     * Creates a unit quad geometry (1x1, centered at origin).
     * @returns Geometry handle
     */
    createQuad(width = 1, height = 1): GeometryHandle {
        const hw = width / 2;
        const hh = height / 2;

        return Geometry.create({
            vertices: new Float32Array([
                // x, y, u, v
                -hw, -hh, 0, 0,
                 hw, -hh, 1, 0,
                 hw,  hh, 1, 1,
                -hw,  hh, 0, 1,
            ]),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array([0, 1, 2, 2, 3, 0]),
        });
    },

    /**
     * Creates a circle geometry.
     * @param radius Circle radius
     * @param segments Number of segments
     * @returns Geometry handle
     */
    createCircle(radius = 1, segments = 32): GeometryHandle {
        const vertices: number[] = [];
        const indices: number[] = [];

        vertices.push(0, 0, 0.5, 0.5);

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const u = (Math.cos(angle) + 1) / 2;
            const v = (Math.sin(angle) + 1) / 2;
            vertices.push(x, y, u, v);
        }

        for (let i = 1; i <= segments; i++) {
            indices.push(0, i, i + 1);
        }

        return Geometry.create({
            vertices: new Float32Array(vertices),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array(indices),
        });
    },

    /**
     * Creates a polygon geometry from vertices.
     * @param points Array of {x, y} points
     * @returns Geometry handle
     */
    createPolygon(points: Array<{ x: number; y: number }>): GeometryHandle {
        if (points.length < 3) {
            throw new Error('Polygon must have at least 3 points');
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        const vertices: number[] = [];
        for (const p of points) {
            const u = (p.x - minX) / (maxX - minX);
            const v = (p.y - minY) / (maxY - minY);
            vertices.push(p.x, p.y, u, v);
        }

        const indices: number[] = [];
        for (let i = 1; i < points.length - 1; i++) {
            indices.push(0, i, i + 1);
        }

        return Geometry.create({
            vertices: new Float32Array(vertices),
            layout: [
                { name: 'a_position', type: DataType.Float2 },
                { name: 'a_texCoord', type: DataType.Float2 },
            ],
            indices: new Uint16Array(indices),
        });
    },
};
