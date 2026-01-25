/**
 * ESEngine TypeScript SDK - Core Type Definitions
 *
 * Provides fundamental types used throughout the engine.
 */

// Entity type - unique identifier for game objects
export type Entity = number;

// Invalid entity constant
export const INVALID_ENTITY: Entity = 0xffffffff;

// Component type identifier
export type ComponentType = number;

// 2D Vector
export interface Vec2 {
  x: number;
  y: number;
}

// 3D Vector
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// 4D Vector
export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

// RGBA Color (0-1 range)
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Matrix 4x4 (column-major, compatible with WebGL)
export type Mat4 = Float32Array;

// Touch event types
export enum TouchType {
  Begin = 0,
  Move = 1,
  End = 2,
  Cancel = 3,
}

// Touch point data
export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

// Keyboard key codes
export enum KeyCode {
  Unknown = 0,

  // Special keys
  Backspace = 8,
  Tab = 9,
  Enter = 13,
  Shift = 16,
  Control = 17,
  Alt = 18,
  Escape = 27,
  Space = 32,

  // Arrow keys
  Left = 37,
  Up = 38,
  Right = 39,
  Down = 40,

  // Number keys
  Digit0 = 48,
  Digit1 = 49,
  Digit2 = 50,
  Digit3 = 51,
  Digit4 = 52,
  Digit5 = 53,
  Digit6 = 54,
  Digit7 = 55,
  Digit8 = 56,
  Digit9 = 57,

  // Letter keys
  A = 65,
  B = 66,
  C = 67,
  D = 68,
  E = 69,
  F = 70,
  G = 71,
  H = 72,
  I = 73,
  J = 74,
  K = 75,
  L = 76,
  M = 77,
  N = 78,
  O = 79,
  P = 80,
  Q = 81,
  R = 82,
  S = 83,
  T = 84,
  U = 85,
  V = 86,
  W = 87,
  X = 88,
  Y = 89,
  Z = 90,
}

// Renderer mode
export enum RendererBackend {
  /** Use C++ WASM backend (recommended for production) */
  Wasm = 'wasm',
  /** Use pure TypeScript/WebGL (fallback, no WASM required) */
  Native = 'native',
}

// Application configuration
export interface ApplicationConfig {
  title?: string;
  width?: number;
  height?: number;
  canvas?: HTMLCanvasElement | string;
  vsync?: boolean;
  /** Path to WASM module (e.g., 'esengine.js'). Required for Wasm backend. */
  wasmPath?: string;
  /** Renderer backend. Defaults to Wasm if wasmPath is provided, otherwise Native. */
  renderer?: RendererBackend;
}

// Renderer statistics
export interface RendererStats {
  drawCalls: number;
  triangleCount: number;
  vertexCount: number;
}

// Utility functions for creating vectors and colors
export function vec2(x: number = 0, y: number = 0): Vec2 {
  return { x, y };
}

export function vec3(x: number = 0, y: number = 0, z: number = 0): Vec3 {
  return { x, y, z };
}

export function vec4(
  x: number = 0,
  y: number = 0,
  z: number = 0,
  w: number = 0
): Vec4 {
  return { x, y, z, w };
}

export function color(
  r: number = 1,
  g: number = 1,
  b: number = 1,
  a: number = 1
): Color {
  return { r, g, b, a };
}

// Create identity matrix
export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

// Create orthographic projection matrix
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number
): Mat4 {
  const m = new Float32Array(16);
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);

  m[0] = -2 * lr;
  m[5] = -2 * bt;
  m[10] = 2 * nf;
  m[12] = (left + right) * lr;
  m[13] = (top + bottom) * bt;
  m[14] = (far + near) * nf;
  m[15] = 1;

  return m;
}
