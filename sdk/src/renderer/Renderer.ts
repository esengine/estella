/**
 * ESEngine TypeScript SDK - Renderer
 *
 * Provides rendering functionality using either native WebGL or WASM backend.
 */

import { Vec2, Vec3, Color, Mat4, RendererStats, mat4Identity, mat4Ortho } from '../core/Types';
import { isWasmLoaded, getWasmModule, withFloat32Array } from '../core/WasmBridge';

/**
 * Renderer mode - determines which backend to use.
 */
export enum RendererMode {
  /** Use native WebGL (TypeScript implementation) */
  Native = 'native',
  /** Use WASM backend (C++ implementation) */
  Wasm = 'wasm',
}

/**
 * Quad drawing options.
 */
export interface DrawQuadOptions {
  position: Vec2 | Vec3;
  size: Vec2;
  color?: Color;
  textureId?: number;
  rotation?: number;
}

/**
 * Renderer - Static class for 2D rendering.
 */
export class Renderer {
  private static gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private static mode: RendererMode = RendererMode.Native;
  private static initialized: boolean = false;
  private static viewProjection: Mat4 = mat4Identity();
  private static clearColor: Color = { r: 0, g: 0, b: 0, a: 1 };
  private static stats: RendererStats = { drawCalls: 0, triangleCount: 0, vertexCount: 0 };

  // Native rendering resources
  private static quadShader: WebGLProgram | null = null;
  private static quadVAO: WebGLVertexArrayObject | null = null;
  private static quadVBO: WebGLBuffer | null = null;
  private static quadIBO: WebGLBuffer | null = null;

  /**
   * Initialize the renderer.
   * @param gl WebGL context (null for WASM mode where C++ owns the context)
   * @param mode Renderer mode
   */
  static init(gl: WebGLRenderingContext | WebGL2RenderingContext | null, mode: RendererMode = RendererMode.Native): void {
    if (this.initialized) return;

    this.gl = gl;
    this.mode = mode;

    if (mode === RendererMode.Native && gl) {
      this.initNative();
    }

    this.initialized = true;
  }

  /**
   * Shut down the renderer.
   */
  static shutdown(): void {
    if (!this.initialized) return;

    if (this.mode === RendererMode.Native) {
      this.shutdownNative();
    }

    this.gl = null;
    this.initialized = false;
  }

  /**
   * Begin a new frame.
   */
  static beginFrame(): void {
    this.resetStats();
  }

  /**
   * End the current frame.
   */
  static endFrame(): void {
    // Flush any pending operations
  }

  /**
   * Set the viewport.
   */
  static setViewport(x: number, y: number, width: number, height: number): void {
    if (!this.gl) return;
    this.gl.viewport(x, y, width, height);
  }

  /**
   * Set the clear color.
   */
  static setClearColor(color: Color): void {
    this.clearColor = { ...color };
    if (this.gl) {
      this.gl.clearColor(color.r, color.g, color.b, color.a);
    }
  }

  /**
   * Clear the screen.
   */
  static clear(): void {
    if (!this.gl) return;

    if (this.mode === RendererMode.Wasm && isWasmLoaded()) {
      const module = getWasmModule();
      if (module._es_renderer_clear) {
        module._es_renderer_clear(
          this.clearColor.r,
          this.clearColor.g,
          this.clearColor.b,
          this.clearColor.a
        );
        return;
      }
    }

    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Begin a scene with the given view-projection matrix.
   */
  static beginScene(viewProjection: Mat4): void {
    this.viewProjection = viewProjection;

    if (this.mode === RendererMode.Wasm && isWasmLoaded()) {
      const module = getWasmModule();
      if (module._es_renderer_begin_scene) {
        withFloat32Array(viewProjection, (ptr) => {
          module._es_renderer_begin_scene!(ptr);
        });
        return;
      }
    }

    // Native mode - set shader uniform
    if (this.quadShader && this.gl) {
      this.gl.useProgram(this.quadShader);
      const loc = this.gl.getUniformLocation(this.quadShader, 'u_ViewProjection');
      this.gl.uniformMatrix4fv(loc, false, viewProjection);
    }
  }

  /**
   * End the current scene.
   */
  static endScene(): void {
    if (this.mode === RendererMode.Wasm && isWasmLoaded()) {
      const module = getWasmModule();
      if (module._es_renderer_end_scene) {
        module._es_renderer_end_scene();
      }
    }
  }

  /**
   * Draw a colored quad.
   */
  static drawQuad(position: Vec2 | Vec3, size: Vec2, color: Color): void {
    const x = position.x;
    const y = position.y;
    const z = 'z' in position ? position.z : 0;

    if (this.mode === RendererMode.Wasm && isWasmLoaded()) {
      const module = getWasmModule();
      if (module._es_renderer_draw_quad) {
        module._es_renderer_draw_quad(
          x, y, size.x, size.y,
          color.r, color.g, color.b, color.a
        );
        this.stats.drawCalls++;
        this.stats.triangleCount += 2;
        this.stats.vertexCount += 4;
        return;
      }
    }

    // Native drawing
    this.drawQuadNative(x, y, z, size.x, size.y, color, -1);
  }

  /**
   * Draw a textured quad.
   */
  static drawTexturedQuad(
    position: Vec2 | Vec3,
    size: Vec2,
    textureId: number,
    tintColor: Color = { r: 1, g: 1, b: 1, a: 1 }
  ): void {
    const x = position.x;
    const y = position.y;
    const z = 'z' in position ? position.z : 0;

    if (this.mode === RendererMode.Wasm && isWasmLoaded()) {
      const module = getWasmModule();
      if (module._es_renderer_draw_quad_textured) {
        module._es_renderer_draw_quad_textured(
          x, y, size.x, size.y, textureId,
          tintColor.r, tintColor.g, tintColor.b, tintColor.a
        );
        this.stats.drawCalls++;
        this.stats.triangleCount += 2;
        this.stats.vertexCount += 4;
        return;
      }
    }

    // Native drawing
    this.drawQuadNative(x, y, z, size.x, size.y, tintColor, textureId);
  }

  /**
   * Get renderer statistics.
   */
  static getStats(): RendererStats {
    return { ...this.stats };
  }

  /**
   * Reset renderer statistics.
   */
  static resetStats(): void {
    this.stats = { drawCalls: 0, triangleCount: 0, vertexCount: 0 };
  }

  /**
   * Create an orthographic projection for 2D rendering.
   */
  static createOrtho2D(width: number, height: number): Mat4 {
    return mat4Ortho(0, width, height, 0, -1, 1);
  }

  // ========== Native WebGL Implementation ==========

  private static initNative(): void {
    const gl = this.gl;
    if (!gl) return;

    // Create shader program
    this.quadShader = this.createShaderProgram(QUAD_VERTEX_SHADER, QUAD_FRAGMENT_SHADER);

    // Create quad geometry
    const vertices = new Float32Array([
      // Position (x, y)   // UV
      0.0, 0.0,           0.0, 0.0,
      1.0, 0.0,           1.0, 0.0,
      1.0, 1.0,           1.0, 1.0,
      0.0, 1.0,           0.0, 1.0,
    ]);

    const indices = new Uint16Array([0, 1, 2, 2, 3, 0]);

    // Check for WebGL2
    const gl2 = gl as WebGL2RenderingContext;
    if (typeof gl2.createVertexArray === 'function') {
      this.quadVAO = gl2.createVertexArray();
      gl2.bindVertexArray(this.quadVAO);
    }

    // Create VBO
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // Create IBO
    this.quadIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // Set up vertex attributes
    const stride = 4 * 4; // 4 floats * 4 bytes
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);

    if (typeof gl2.bindVertexArray === 'function') {
      gl2.bindVertexArray(null);
    }

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private static shutdownNative(): void {
    const gl = this.gl;
    if (!gl) return;

    if (this.quadShader) {
      gl.deleteProgram(this.quadShader);
      this.quadShader = null;
    }

    if (this.quadVBO) {
      gl.deleteBuffer(this.quadVBO);
      this.quadVBO = null;
    }

    if (this.quadIBO) {
      gl.deleteBuffer(this.quadIBO);
      this.quadIBO = null;
    }

    const gl2 = gl as WebGL2RenderingContext;
    if (this.quadVAO && typeof gl2.deleteVertexArray === 'function') {
      gl2.deleteVertexArray(this.quadVAO);
      this.quadVAO = null;
    }
  }

  private static drawQuadNative(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: Color,
    textureId: number
  ): void {
    const gl = this.gl;
    if (!gl || !this.quadShader) return;

    gl.useProgram(this.quadShader);

    // Set uniforms
    const uTransform = gl.getUniformLocation(this.quadShader, 'u_Transform');
    const uColor = gl.getUniformLocation(this.quadShader, 'u_Color');
    const uUseTexture = gl.getUniformLocation(this.quadShader, 'u_UseTexture');

    // Simple transform: translate and scale
    const transform = new Float32Array([
      w, 0, 0, 0,
      0, h, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]);

    gl.uniformMatrix4fv(uTransform, false, transform);
    gl.uniform4f(uColor, color.r, color.g, color.b, color.a);
    gl.uniform1i(uUseTexture, textureId >= 0 ? 1 : 0);

    // Bind texture if needed
    if (textureId >= 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureId as unknown as WebGLTexture);
      const uTexture = gl.getUniformLocation(this.quadShader, 'u_Texture');
      gl.uniform1i(uTexture, 0);
    }

    // Draw
    const gl2 = gl as WebGL2RenderingContext;
    if (this.quadVAO && typeof gl2.bindVertexArray === 'function') {
      gl2.bindVertexArray(this.quadVAO);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    }

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    if (typeof gl2.bindVertexArray === 'function') {
      gl2.bindVertexArray(null);
    }

    this.stats.drawCalls++;
    this.stats.triangleCount += 2;
    this.stats.vertexCount += 4;
  }

  private static createShaderProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const gl = this.gl;
    if (!gl) return null;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  private static compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;

    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }
}

// ========== Shader Sources ==========

const QUAD_VERTEX_SHADER = `
attribute vec2 a_Position;
attribute vec2 a_TexCoord;

uniform mat4 u_ViewProjection;
uniform mat4 u_Transform;

varying vec2 v_TexCoord;

void main() {
  v_TexCoord = a_TexCoord;
  gl_Position = u_ViewProjection * u_Transform * vec4(a_Position, 0.0, 1.0);
}
`;

const QUAD_FRAGMENT_SHADER = `
precision mediump float;

varying vec2 v_TexCoord;

uniform vec4 u_Color;
uniform sampler2D u_Texture;
uniform int u_UseTexture;

void main() {
  if (u_UseTexture == 1) {
    gl_FragColor = texture2D(u_Texture, v_TexCoord) * u_Color;
  } else {
    gl_FragColor = u_Color;
  }
}
`;
