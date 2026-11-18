// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    draw.ts
 * @brief   Immediate mode 2D drawing API
 * @details Provides simple drawing primitives (lines, rectangles, circles)
 *          with automatic batching. All draw commands are cleared each frame.
 */

import type { ESEngineModule } from '../wasm';
import type { Vec2, Vec3, Color } from '../types';
import type { GeometryHandle } from './geometry';
import type { ShaderHandle, MaterialHandle } from './material';
import { Material, isTextureRef, classifyUniformArity, type UniformValue, type TextureRef } from './material';
import { BlendMode } from './blend';
import { CoreApiBridge } from '../wasm/CoreApiBridge';
import { handleWasmError } from '../wasm/wasmError';
import { log } from '../util/logger';

export { BlendMode } from './blend';

// =============================================================================
// Internal State
// =============================================================================

const bridge = new CoreApiBridge('draw');
let module: ESEngineModule | null = null;
let viewProjectionPtr: number = 0;
let transformPtr: number = 0;
let uniformsPtr: number = 0;

const UNIFORMS_BUFFER_SIZE = 256;

/** The heap block Draw.triangles copies a mesh into, grown to the largest mesh drawn and kept. */
let trianglesPtr = 0;
let trianglesBytes = 0;

function trianglesBlock(m: ESEngineModule, bytes: number): number {
    if (bytes <= trianglesBytes) return trianglesPtr;
    if (trianglesPtr) m._free(trianglesPtr);
    trianglesBytes = Math.max(bytes, trianglesBytes * 2, 4096);
    trianglesPtr = m._malloc(trianglesBytes);
    return trianglesPtr;
}

/**
 * Triangles a {@link DrawAPI.triangles} call draws: an x, y pair a vertex, three indices a triangle, and an r, g, b, a quadruple a
 * vertex (0 to 1; absent, every vertex is white). `buildPathGeometry` makes this shape from a path.
 */
export interface DrawTriangles {
    positions: ArrayLike<number>;
    indices: ArrayLike<number>;
    colors?: ArrayLike<number>;
}

/** Where and how a {@link DrawTriangles} is drawn: a 2D affine and a colour every vertex is multiplied by. */
export interface DrawTrianglesOptions {
    /** Multiplies every vertex colour; its alpha fades the whole shape. Default white. */
    tint?: Color;
    /**
     * x' = xx x + yx y + tx, y' = xy x + yy y + ty, as `[xx, xy, yx, yy, tx, ty]`. Default: the points as they are.
     */
    transform?: readonly [number, number, number, number, number, number];
}
const uniformBuffer = new Float32Array(UNIFORMS_BUFFER_SIZE);

// Identity model matrix for legacy material draws that omit `transform`.
const IDENTITY_TRANSFORM = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// =============================================================================
// Initialization
// =============================================================================

/** @internal Wired by the engine plugins — not part of the public API. */
/**
 * Whether an engine core with a Draw API is installed. A core built without one
 * (a headless or minimal build) still runs every plugin, and a plugin that
 * registers a draw callback must not turn that into a thrown frame.
 */
export function isDrawAPIReady(): boolean {
    return module !== null;
}

export function initDrawAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
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
        if (trianglesPtr) {
            module._free(trianglesPtr);
            trianglesPtr = 0;
            trianglesBytes = 0;
        }
    }
    bridge.disconnect();
    module = null;
}

/** @internal Collect primitive batches for the owning renderer pass. */
export function beginPresentedDraw(viewProjection: Float32Array, width: number, height: number): void {
    Draw.begin(viewProjection, width, height);
    getModule().draw_deferBegin?.();
}

/** @internal Close custom overlay collection for the owning renderer pass. */
export function endPresentedDraw(): void {
    try {
        getModule().draw_deferEnd();
    } catch (e) {
        handleWasmError(e, 'Draw.endPresented');
    }
}

// =============================================================================
// Draw API Interface
// =============================================================================

export interface DrawAPI {
    /**
     * Begins a new draw frame with the given view-projection matrix.
     * Must be called before any draw commands.
     * @param viewportWidth Framebuffer width used by screen-sized 3D primitives
     * @param viewportHeight Framebuffer height used by screen-sized 3D primitives
     */
    begin(viewProjection: Float32Array, viewportWidth?: number, viewportHeight?: number): void;

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
     * Draws a line between two points in space.
     *
     * The ribbon is widened across the view, so it reads as a line from wherever
     * the camera is. Thickness is in WORLD units rather than pixels — a distant
     * line thins out the way the geometry beside it does.
     */
    line3D(from: Vec3, to: Vec3, color: Color, thickness?: number): void;

    /**
     * Draws a world-space line with a stable framebuffer-pixel thickness.
     * The active draw frame must include its framebuffer dimensions.
     */
    line3DScreen(from: Vec3, to: Vec3, color: Color, thickness?: number): void;

    /** Draws a framebuffer-sized line at one world anchor. Offsets are pixels, +Y up. */
    line3DScreenOffset(anchor: Vec3, fromOffset: Vec2, toOffset: Vec2,
                       color: Color, thickness?: number): void;

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
     * Draws triangles with a colour a vertex, batched with the rest of the frame's shapes: a shape tessellated once (a path's
     * `buildPathGeometry`, a `Graphics`) and drawn as often as needed, moved by `transform` and faded by `tint`, with no geometry
     * built and no texture made for it. A mesh whose indices name a vertex it does not hold draws nothing.
     */
    triangles(mesh: DrawTriangles, options?: DrawTrianglesOptions): void;

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

    /** Runs synchronous drawing with scoped depth state, restored even on throw.
     * Returns false without drawing on older cores without scoped depth support. */
    withDepthState(state: { test: boolean; write: boolean }, draw: () => void): boolean;

    /**
     * Draws a custom mesh with a shader.
     * @param geometry Geometry handle
     * @param shader Shader handle
     * @param transform Transform matrix (4x4, column-major)
     */
    drawMesh(geometry: GeometryHandle, shader: ShaderHandle, transform: Float32Array): void;

    /**
     * Draws a custom mesh with a material.
     *
     * A material whose shader was compiled from a `.esshader` (Material.compileShader)
     * draws through the reflected MaterialConstants path: its `#pragma param` values and
     * render state come straight from the engine material store, the shader positions
     * itself via the injected FrameConstants (and params), and `transform` is unused —
     * this path runs on every backend. A raw-GLSL material (Material.createShader) uses
     * the legacy loose-uniform stream with `u_projection`/`u_model` and `transform`
     * (identity when omitted).
     * @param geometry Geometry handle
     * @param material Material handle
     * @param transform Transform matrix (4x4, column-major) — legacy raw-GLSL path only
     */
    drawMeshWithMaterial(geometry: GeometryHandle, material: MaterialHandle, transform?: Float32Array): void;
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
const IDENTITY_2D = [1, 0, 0, 1, 0, 0] as const;

export const Draw: DrawAPI = {
    begin(viewProjection: Float32Array, viewportWidth = 0, viewportHeight = 0): void {
        const m = getModule();
        try {
            m.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
            m.draw_begin(viewProjectionPtr, viewportWidth, viewportHeight);
        } catch (e) {
            handleWasmError(e, 'Draw.begin');
        }
    },

    end(): void {
        try {
            getModule().draw_end();
        } catch (e) {
            handleWasmError(e, 'Draw.end');
        }
    },

    line(from: Vec2, to: Vec2, color: Color, thickness = 1): void {
        try {
            getModule().draw_line(
                from.x, from.y,
                to.x, to.y,
                color.r, color.g, color.b, color.a,
                thickness
            );
        } catch (e) {
            handleWasmError(e, 'Draw.line');
        }
    },

    line3D(from: Vec3, to: Vec3, color: Color, thickness = 1): void {
        try {
            getModule().draw_line3D(
                from.x, from.y, from.z,
                to.x, to.y, to.z,
                color.r, color.g, color.b, color.a,
                thickness
            );
        } catch (e) {
            handleWasmError(e, 'Draw.line3D');
        }
    },

    line3DScreen(from: Vec3, to: Vec3, color: Color, thickness = 1): void {
        try {
            getModule().draw_line3DScreen(
                from.x, from.y, from.z,
                to.x, to.y, to.z,
                color.r, color.g, color.b, color.a,
                thickness
            );
        } catch (e) {
            handleWasmError(e, 'Draw.line3DScreen');
        }
    },

    line3DScreenOffset(anchor: Vec3, fromOffset: Vec2, toOffset: Vec2,
                       color: Color, thickness = 1): void {
        try {
            getModule().draw_line3DScreenOffset(
                anchor.x, anchor.y, anchor.z,
                fromOffset.x, fromOffset.y, toOffset.x, toOffset.y,
                color.r, color.g, color.b, color.a,
                thickness,
            );
        } catch (e) {
            handleWasmError(e, 'Draw.line3DScreenOffset');
        }
    },

    rect(position: Vec2, size: Vec2, color: Color, filled = true): void {
        try {
            getModule().draw_rect(
                position.x, position.y,
                size.x, size.y,
                color.r, color.g, color.b, color.a,
                filled
            );
        } catch (e) {
            handleWasmError(e, 'Draw.rect');
        }
    },

    rectOutline(position: Vec2, size: Vec2, color: Color, thickness = 1): void {
        try {
            getModule().draw_rectOutline(
                position.x, position.y,
                size.x, size.y,
                color.r, color.g, color.b, color.a,
                thickness
            );
        } catch (e) {
            handleWasmError(e, 'Draw.rectOutline');
        }
    },

    circle(center: Vec2, radius: number, color: Color, filled = true, segments = 32): void {
        try {
            getModule().draw_circle(
                center.x, center.y,
                radius,
                color.r, color.g, color.b, color.a,
                filled,
                segments
            );
        } catch (e) {
            handleWasmError(e, 'Draw.circle');
        }
    },

    circleOutline(center: Vec2, radius: number, color: Color, thickness = 1, segments = 32): void {
        try {
            getModule().draw_circleOutline(
                center.x, center.y,
                radius,
                color.r, color.g, color.b, color.a,
                thickness,
                segments
            );
        } catch (e) {
            handleWasmError(e, 'Draw.circleOutline');
        }
    },

    texture(position: Vec2, size: Vec2, textureHandle: number, tint: Color = WHITE): void {
        try {
            getModule().draw_texture(
                position.x, position.y,
                size.x, size.y,
                textureHandle,
                tint.r, tint.g, tint.b, tint.a
            );
        } catch (e) {
            handleWasmError(e, 'Draw.texture');
        }
    },

    triangles(mesh: DrawTriangles, options: DrawTrianglesOptions = {}): void {
        const vertexCount = Math.floor(mesh.positions.length / 2);
        const indexCount = mesh.indices.length - mesh.indices.length % 3;
        if (vertexCount === 0 || indexCount === 0) return;
        const colorCount = mesh.colors && mesh.colors.length >= vertexCount * 4 ? vertexCount * 4 : 0;
        try {
            const m = getModule();
            // One block: positions, then colours, then indices, each 4 bytes a number.
            const base = trianglesBlock(m, (vertexCount * 2 + colorCount + indexCount) * 4);
            const positionsAt = base, colorsAt = base + vertexCount * 8, indicesAt = colorsAt + colorCount * 4;
            const f32 = m.HEAPF32, u32 = m.HEAPU32;
            const pAt = positionsAt / 4;
            for (let i = 0; i < vertexCount * 2; i++) f32[pAt + i] = mesh.positions[i];
            if (colorCount) {
                const cAt = colorsAt / 4;
                for (let i = 0; i < colorCount; i++) f32[cAt + i] = mesh.colors![i];
            }
            const iAt = indicesAt / 4;
            for (let i = 0; i < indexCount; i++) u32[iAt + i] = mesh.indices[i];
            const t = options.tint ?? WHITE;
            const x = options.transform ?? IDENTITY_2D;
            m.draw_triangles(positionsAt, vertexCount, colorCount ? colorsAt : 0, indicesAt, indexCount,
                t.r, t.g, t.b, t.a, x[0], x[1], x[2], x[3], x[4], x[5]);
        } catch (e) {
            handleWasmError(e, 'Draw.triangles');
        }
    },

    textureRotated(position: Vec2, size: Vec2, rotation: number, textureHandle: number, tint: Color = WHITE): void {
        try {
            getModule().draw_textureRotated(
                position.x, position.y,
                size.x, size.y,
                rotation,
                textureHandle,
                tint.r, tint.g, tint.b, tint.a
            );
        } catch (e) {
            handleWasmError(e, 'Draw.textureRotated');
        }
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

    withDepthState(state: { test: boolean; write: boolean }, draw: () => void): boolean {
        const m = getModule();
        if (!m.draw_getDepthState || !m.draw_setDepthState) return false;
        const previous = m.draw_getDepthState();
        m.draw_setDepthState((state.test ? 1 : 0) | (state.write ? 2 : 0));
        try {
            draw();
        } finally {
            m.draw_setDepthState(previous);
        }
        return true;
    },

    drawMesh(geometry: GeometryHandle, shader: ShaderHandle, transform: Float32Array): void {
        try {
            const m = getModule();
            m.HEAPF32.set(transform, transformPtr / 4);
            m.draw_mesh(geometry, shader, transformPtr);
        } catch (e) {
            handleWasmError(e, `Draw.drawMesh(geometry=${geometry}, shader=${shader})`);
        }
    },

    drawMeshWithMaterial(geometry: GeometryHandle, material: MaterialHandle, transform?: Float32Array): void {
        try {
            const m = getModule();
            const matData = Material.get(material);
            if (!matData) return;

            // Reflected path first: a compileEsshader material draws entirely from the
            // engine material store (params + render state + pipeline), backend-neutral.
            // False means the shader has no #pragma-param layout — legacy stream below.
            if (m.draw_meshWithMaterial(geometry, material)) return;

            const state = Material.getRenderState(material);
            if (!state) return;
            Draw.setBlendMode(state.blendMode);
            Draw.setDepthTest(state.depthTest);

            if (transform) m.HEAPF32.set(transform, transformPtr / 4);
            else m.HEAPF32.set(IDENTITY_TRANSFORM, transformPtr / 4);

            let idx: number;
            if (!matData.dirty_ && matData.cachedBuffer_) {
                idx = matData.cachedIdx_;
            } else {
                idx = 0;
                let autoTextureSlot = 0;
                for (const [name, value] of Material.getUniforms(material)) {
                    if (idx > UNIFORMS_BUFFER_SIZE - 6) {
                        log.warn('draw', 'Uniform buffer overflow, some uniforms will be ignored');
                        break;
                    }

                    const nameId = getUniformNameId(name);
                    if (nameId < 0) continue;

                    if (isTextureRef(value)) {
                        // Texture refs use a separate type code (10) since
                        // they carry slot + textureId rather than packed floats.
                        uniformBuffer[idx++] = 10;
                        uniformBuffer[idx++] = nameId;
                        uniformBuffer[idx++] = value.slot ?? autoTextureSlot++;
                        uniformBuffer[idx++] = value.textureId;
                    } else {
                        // Scalar/vec uniforms: type code in this layout is
                        // one-indexed arity (1=float, 2=vec2, 3=vec3, 4=vec4).
                        const { arity, values } = classifyUniformArity(
                            value as Exclude<UniformValue, TextureRef>,
                        );
                        uniformBuffer[idx++] = arity;
                        uniformBuffer[idx++] = nameId;
                        for (let i = 0; i < arity; i++) {
                            uniformBuffer[idx++] = values[i];
                        }
                    }

                }

                if (!matData.cachedBuffer_ || matData.cachedBuffer_.length < idx) {
                    matData.cachedBuffer_ = new Float32Array(idx);
                }
                matData.cachedBuffer_.set(uniformBuffer.subarray(0, idx));
                matData.cachedIdx_ = idx;
                matData.dirty_ = false;
            }

            if (idx === 0) {
                m.draw_mesh(geometry, state.shader, transformPtr);
                return;
            }

            m.HEAPF32.set(matData.cachedBuffer_!.subarray(0, idx), uniformsPtr / 4);
            m.draw_meshWithUniforms(geometry, state.shader, transformPtr, uniformsPtr, idx);
        } catch (e) {
            handleWasmError(e, `Draw.drawMeshWithMaterial(geometry=${geometry}, material=${material})`);
        }
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

const warnedUniforms = new Set<string>();

function getUniformNameId(name: string): number {
    const id = UNIFORM_NAME_MAP[name];
    if (id !== undefined) return id;
    if (!warnedUniforms.has(name)) {
        warnedUniforms.add(name);
        log.warn(
            'draw',
            `Unknown uniform name "${name}" - supported: ${Object.keys(UNIFORM_NAME_MAP).join(', ')}`,
        );
    }
    return -1;
}
