/**
 * @file    draw.ts
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple drawing primitives (lines, rectangles, circles)
 *          with automatic batching. All draw commands are cleared each frame.
 */

import type { ESEngineModule } from './wasm';
import type { Vec2, Color } from './types';
import type { GeometryHandle } from './geometry';
import type { ShaderHandle, MaterialHandle } from './material';
import { Material, isTextureRef } from './material';
import { BlendMode } from './blend';

export { BlendMode } from './blend';

// =============================================================================
// Internal State
// =============================================================================

let module: ESEngineModule | null = null;
let viewProjectionPtr: number = 0;
let transformPtr: number = 0;
let uniformsPtr: number = 0;

const UNIFORMS_BUFFER_SIZE = 256;
const uniformBuffer = new Float32Array(UNIFORMS_BUFFER_SIZE);

// =============================================================================
// Initialization
// =============================================================================

export function initDrawAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
    viewProjectionPtr = module._malloc(16 * 4);
    transformPtr = module._malloc(16 * 4);
    uniformsPtr = module._malloc(UNIFORMS_BUFFER_SIZE * 4);
}

export function shutdownDrawAPI(): void {
    if (module) {
        if (viewProjectionPtr) {
            module._free(viewProjectionPtr);
            viewProjectionPtr = 0;
        }
        if (transformPtr) {
            module._free(transformPtr);
            transformPtr = 0;
        }
        if (uniformsPtr) {
            module._free(uniformsPtr);
            uniformsPtr = 0;
        }
    }
    module = null;
}

// =============================================================================
// Draw API Interface
// =============================================================================

export interface DrawAPI {
    /**
     * Begins a new draw frame with the given view-projection matrix.
     * Must be called before any draw commands.
     */
    begin(viewProjection: Float32Array): void;

    /**
     * Ends the current draw frame and submits all commands.
     * Must be called after all draw commands.
     */
    end(): void;

    /**
     * Draws a line between two points.
     * @param from Start point
     * @param to End point
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     */
    line(from: Vec2, to: Vec2, color: Color, thickness?: number): void;

    /**
     * Draws a filled or outlined rectangle.
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param filled If true draws filled, if false draws outline (default: true)
     */
    rect(position: Vec2, size: Vec2, color: Color, filled?: boolean): void;

    /**
     * Draws a rectangle outline.
     * @param position Center position
     * @param size Width and height
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     */
    rectOutline(position: Vec2, size: Vec2, color: Color, thickness?: number): void;

    /**
     * Draws a filled or outlined circle.
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param filled If true draws filled, if false draws outline (default: true)
     * @param segments Number of segments for approximation (default: 32)
     */
    circle(center: Vec2, radius: number, color: Color, filled?: boolean, segments?: number): void;

    /**
     * Draws a circle outline.
     * @param center Center position
     * @param radius Circle radius
     * @param color RGBA color
     * @param thickness Line thickness in pixels (default: 1)
     * @param segments Number of segments for approximation (default: 32)
     */
    circleOutline(center: Vec2, radius: number, color: Color, thickness?: number, segments?: number): void;

    /**
     * Draws a textured quad.
     * @param position Center position
     * @param size Width and height
     * @param textureHandle GPU texture handle
     * @param tint Color tint (default: white)
     */
    texture(position: Vec2, size: Vec2, textureHandle: number, tint?: Color): void;

    /**
     * Draws a rotated textured quad.
     * @param position Center position
     * @param size Width and height
     * @param rotation Rotation angle in radians
     * @param textureHandle GPU texture handle
     * @param tint Color tint (default: white)
     */
    textureRotated(position: Vec2, size: Vec2, rotation: number, textureHandle: number, tint?: Color): void;

    /**
     * Sets the current render layer.
     * @param layer Layer index (higher layers render on top)
     */
    setLayer(layer: number): void;

    /**
     * Sets the current depth for sorting within a layer.
     * @param depth Z depth value
     */
    setDepth(depth: number): void;

    /**
     * Gets the number of draw calls in the current/last frame.
     */
    getDrawCallCount(): number;

    /**
     * Gets the number of primitives drawn in the current/last frame.
     */
    getPrimitiveCount(): number;

    /**
     * Sets the blend mode for subsequent draw operations.
     * @param mode The blend mode to use
     */
    setBlendMode(mode: BlendMode): void;

    /**
     * Enables or disables depth testing.
     * @param enabled True to enable depth testing
     */
    setDepthTest(enabled: boolean): void;

    /**
     * Draws a custom mesh with a shader.
     * @param geometry Geometry handle
     * @param shader Shader handle
     * @param transform Transform matrix (4x4, column-major)
     */
    drawMesh(geometry: GeometryHandle, shader: ShaderHandle, transform: Float32Array): void;

    /**
     * Draws a custom mesh with a material.
     * @param geometry Geometry handle
     * @param material Material handle
     * @param transform Transform matrix (4x4, column-major)
     */
    drawMeshWithMaterial(geometry: GeometryHandle, material: MaterialHandle, transform: Float32Array): void;
}

// =============================================================================
// Draw Implementation
// =============================================================================

function getModule(): ESEngineModule {
    if (!module) {
        throw new Error('Draw API not initialized. Call initDrawAPI() first.');
    }
    return module;
}

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

export const Draw: DrawAPI = {
    begin(viewProjection: Float32Array): void {
        const m = getModule();
        m.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
        m.draw_begin(viewProjectionPtr);
    },

    end(): void {
        getModule().draw_end();
    },

    line(from: Vec2, to: Vec2, color: Color, thickness = 1): void {
        getModule().draw_line(
            from.x, from.y,
            to.x, to.y,
            color.r, color.g, color.b, color.a,
            thickness
        );
    },

    rect(position: Vec2, size: Vec2, color: Color, filled = true): void {
        getModule().draw_rect(
            position.x, position.y,
            size.x, size.y,
            color.r, color.g, color.b, color.a,
            filled
        );
    },

    rectOutline(position: Vec2, size: Vec2, color: Color, thickness = 1): void {
        getModule().draw_rectOutline(
            position.x, position.y,
            size.x, size.y,
            color.r, color.g, color.b, color.a,
            thickness
        );
    },

    circle(center: Vec2, radius: number, color: Color, filled = true, segments = 32): void {
        getModule().draw_circle(
            center.x, center.y,
            radius,
            color.r, color.g, color.b, color.a,
            filled,
            segments
        );
    },

    circleOutline(center: Vec2, radius: number, color: Color, thickness = 1, segments = 32): void {
        getModule().draw_circleOutline(
            center.x, center.y,
            radius,
            color.r, color.g, color.b, color.a,
            thickness,
            segments
        );
    },

    texture(position: Vec2, size: Vec2, textureHandle: number, tint: Color = WHITE): void {
        getModule().draw_texture(
            position.x, position.y,
            size.x, size.y,
            textureHandle,
            tint.r, tint.g, tint.b, tint.a
        );
    },

    textureRotated(position: Vec2, size: Vec2, rotation: number, textureHandle: number, tint: Color = WHITE): void {
        getModule().draw_textureRotated(
            position.x, position.y,
            size.x, size.y,
            rotation,
            textureHandle,
            tint.r, tint.g, tint.b, tint.a
        );
    },

    setLayer(layer: number): void {
        getModule().draw_setLayer(layer);
    },

    setDepth(depth: number): void {
        getModule().draw_setDepth(depth);
    },

    getDrawCallCount(): number {
        if (!module) return 0;
        return module.draw_getDrawCallCount();
    },

    getPrimitiveCount(): number {
        if (!module) return 0;
        return module.draw_getPrimitiveCount();
    },

    setBlendMode(mode: BlendMode): void {
        getModule().draw_setBlendMode(mode);
    },

    setDepthTest(enabled: boolean): void {
        getModule().draw_setDepthTest(enabled);
    },

    drawMesh(geometry: GeometryHandle, shader: ShaderHandle, transform: Float32Array): void {
        const m = getModule();
        m.HEAPF32.set(transform, transformPtr / 4);
        m.draw_mesh(geometry, shader, transformPtr);
    },

    drawMeshWithMaterial(geometry: GeometryHandle, material: MaterialHandle, transform: Float32Array): void {
        const m = getModule();
        const matData = Material.get(material);
        if (!matData) return;

        Draw.setBlendMode(matData.blendMode);
        Draw.setDepthTest(matData.depthTest);

        if (matData.uniforms.size === 0) {
            Draw.drawMesh(geometry, matData.shader, transform);
            return;
        }

        m.HEAPF32.set(transform, transformPtr / 4);

        let idx = 0;
        let autoTextureSlot = 0;
        for (const [name, value] of matData.uniforms) {
            const nameId = getUniformNameId(name);
            if (nameId < 0) continue;

            if (isTextureRef(value)) {
                uniformBuffer[idx++] = 10;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.slot ?? autoTextureSlot++;
                uniformBuffer[idx++] = value.textureId;
            } else if (typeof value === 'number') {
                uniformBuffer[idx++] = 1;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value;
            } else if (Array.isArray(value)) {
                uniformBuffer[idx++] = value.length;
                uniformBuffer[idx++] = nameId;
                for (let i = 0; i < value.length; i++) {
                    uniformBuffer[idx++] = value[i];
                }
            } else if ('w' in value) {
                uniformBuffer[idx++] = 4;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
                uniformBuffer[idx++] = value.z;
                uniformBuffer[idx++] = value.w;
            } else if ('z' in value) {
                uniformBuffer[idx++] = 3;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
                uniformBuffer[idx++] = value.z;
            } else {
                uniformBuffer[idx++] = 2;
                uniformBuffer[idx++] = nameId;
                uniformBuffer[idx++] = value.x;
                uniformBuffer[idx++] = value.y;
            }

            if (idx > UNIFORMS_BUFFER_SIZE - 6) {
                console.warn('Uniform buffer overflow, some uniforms will be ignored');
                break;
            }
        }

        if (idx === 0) {
            m.draw_mesh(geometry, matData.shader, transformPtr);
            return;
        }

        m.HEAPF32.set(uniformBuffer.subarray(0, idx), uniformsPtr / 4);
        m.draw_meshWithUniforms(geometry, matData.shader, transformPtr, uniformsPtr, idx);
    },
};

const UNIFORM_NAME_MAP: Record<string, number> = {
    'u_time': 0,
    'u_color': 1,
    'u_intensity': 2,
    'u_scale': 3,
    'u_offset': 4,
    'u_param0': 5,
    'u_param1': 6,
    'u_param2': 7,
    'u_param3': 8,
    'u_param4': 9,
    'u_vec0': 10,
    'u_vec1': 11,
    'u_vec2': 12,
    'u_vec3': 13,
    'u_texture0': 14,
    'u_texture1': 15,
    'u_texture2': 16,
    'u_texture3': 17,
};

function getUniformNameId(name: string): number {
    return UNIFORM_NAME_MAP[name] ?? -1;
}
