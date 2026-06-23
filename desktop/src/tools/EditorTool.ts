// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorTool.ts
 * @brief The viewport interactive-tool contract (the editor's Interactive Tools
 *        Framework). Every pointer interaction — select/move/rotate/scale, tile
 *        brush/erase/rect/eyedropper, and future tools — is an EditorTool, so the
 *        Viewport is a thin router (resolve active tool, dispatch the stroke)
 *        instead of one growing if-cascade. A tool owns its per-stroke state and
 *        drives one undo transaction per stroke; the host owns pointer capture.
 */

/** A pointer event normalized to what tools need (no React/DOM coupling). */
export interface PointerInput {
  clientX: number;
  clientY: number;
  pointerId: number;
  button: number;
  shift: boolean;
  alt: boolean;
}

/** Host-owned services a tool needs during a stroke (everything else — picking,
 *  commands, stores — are app singletons the tools import directly). */
export interface ToolContext {
  /** Capture the pointer on the viewport stage so the stroke keeps receiving
   *  move/up events outside the element. */
  capture(pointerId: number): void;
  release(pointerId: number): void;
}

export interface EditorTool {
  readonly id: string;
  /**
   * Begin a stroke. Return true if the tool took it — the host then routes this
   * stroke's move/up to this tool. Return false for a one-shot action (e.g. the
   * eyedropper) or a no-op (clicked empty space).
   */
  onPointerDown(p: PointerInput, ctx: ToolContext): boolean;
  onPointerMove(p: PointerInput, ctx: ToolContext): void;
  onPointerUp(p: PointerInput, ctx: ToolContext): void;
  /** Cancel an in-progress stroke (tool switch / Esc), rolling back live edits. */
  cancel?(ctx: ToolContext): void;
}
