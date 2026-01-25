/**
 * ESEngine TypeScript SDK - Input Management
 *
 * Provides unified input handling for touch and keyboard.
 */

import { Vec2, KeyCode, TouchType, TouchPoint, vec2 } from '../core/Types';

// Touch state
interface TouchState {
  id: number;
  position: Vec2;
  startPosition: Vec2;
  isDown: boolean;
  justPressed: boolean;
  justReleased: boolean;
}

// Key state
interface KeyState {
  isDown: boolean;
  justPressed: boolean;
  justReleased: boolean;
}

/**
 * Input - Static class for input management.
 */
export class Input {
  private static touches: Map<number, TouchState> = new Map();
  private static keys: Map<KeyCode, KeyState> = new Map();
  private static mousePosition: Vec2 = { x: 0, y: 0 };
  private static mouseButtons: Map<number, KeyState> = new Map();
  private static initialized: boolean = false;

  /**
   * Initialize the input system.
   */
  static init(): void {
    if (this.initialized) return;
    this.touches.clear();
    this.keys.clear();
    this.mouseButtons.clear();
    this.initialized = true;
  }

  /**
   * Shut down the input system.
   */
  static shutdown(): void {
    this.touches.clear();
    this.keys.clear();
    this.mouseButtons.clear();
    this.initialized = false;
  }

  /**
   * Update input state. Call once per frame after processing events.
   */
  static update(): void {
    // Reset "just" states for touches
    for (const touch of this.touches.values()) {
      touch.justPressed = false;
      touch.justReleased = false;
    }

    // Remove released touches
    for (const [id, touch] of this.touches) {
      if (!touch.isDown && !touch.justReleased) {
        this.touches.delete(id);
      }
    }

    // Reset "just" states for keys
    for (const key of this.keys.values()) {
      key.justPressed = false;
      key.justReleased = false;
    }

    // Reset "just" states for mouse buttons
    for (const button of this.mouseButtons.values()) {
      button.justPressed = false;
      button.justReleased = false;
    }
  }

  // ========== Touch Input ==========

  /**
   * Handle touch event from platform.
   */
  static onTouchEvent(type: TouchType, point: TouchPoint): void {
    let touch = this.touches.get(point.id);

    switch (type) {
      case TouchType.Begin:
        touch = {
          id: point.id,
          position: { x: point.x, y: point.y },
          startPosition: { x: point.x, y: point.y },
          isDown: true,
          justPressed: true,
          justReleased: false,
        };
        this.touches.set(point.id, touch);
        break;

      case TouchType.Move:
        if (touch) {
          touch.position = { x: point.x, y: point.y };
        }
        break;

      case TouchType.End:
      case TouchType.Cancel:
        if (touch) {
          touch.position = { x: point.x, y: point.y };
          touch.isDown = false;
          touch.justReleased = true;
        }
        break;
    }
  }

  /**
   * Check if a touch is currently down.
   */
  static isTouchDown(index: number = 0): boolean {
    const touch = this.getTouchByIndex(index);
    return touch !== undefined && touch.isDown;
  }

  /**
   * Check if a touch just started this frame.
   */
  static isTouchPressed(index: number = 0): boolean {
    const touch = this.getTouchByIndex(index);
    return touch !== undefined && touch.justPressed;
  }

  /**
   * Check if a touch just ended this frame.
   */
  static isTouchReleased(index: number = 0): boolean {
    const touch = this.getTouchByIndex(index);
    return touch !== undefined && touch.justReleased;
  }

  /**
   * Get the current touch position.
   */
  static getTouchPosition(index: number = 0): Vec2 {
    const touch = this.getTouchByIndex(index);
    return touch ? { ...touch.position } : { x: 0, y: 0 };
  }

  /**
   * Get the touch delta from start position.
   */
  static getTouchDelta(index: number = 0): Vec2 {
    const touch = this.getTouchByIndex(index);
    if (!touch) return { x: 0, y: 0 };
    return {
      x: touch.position.x - touch.startPosition.x,
      y: touch.position.y - touch.startPosition.y,
    };
  }

  /**
   * Get the number of active touches.
   */
  static getTouchCount(): number {
    let count = 0;
    for (const touch of this.touches.values()) {
      if (touch.isDown) count++;
    }
    return count;
  }

  private static getTouchByIndex(index: number): TouchState | undefined {
    let i = 0;
    for (const touch of this.touches.values()) {
      if (i === index) return touch;
      i++;
    }
    return undefined;
  }

  // ========== Keyboard Input ==========

  /**
   * Handle key event from platform.
   */
  static onKeyEvent(key: KeyCode, pressed: boolean): void {
    let state = this.keys.get(key);

    if (!state) {
      state = { isDown: false, justPressed: false, justReleased: false };
      this.keys.set(key, state);
    }

    if (pressed && !state.isDown) {
      state.isDown = true;
      state.justPressed = true;
    } else if (!pressed && state.isDown) {
      state.isDown = false;
      state.justReleased = true;
    }
  }

  /**
   * Check if a key is currently down.
   */
  static isKeyDown(key: KeyCode): boolean {
    const state = this.keys.get(key);
    return state !== undefined && state.isDown;
  }

  /**
   * Check if a key was just pressed this frame.
   */
  static isKeyPressed(key: KeyCode): boolean {
    const state = this.keys.get(key);
    return state !== undefined && state.justPressed;
  }

  /**
   * Check if a key was just released this frame.
   */
  static isKeyReleased(key: KeyCode): boolean {
    const state = this.keys.get(key);
    return state !== undefined && state.justReleased;
  }

  // ========== Mouse Input ==========

  /**
   * Handle mouse move event from platform.
   */
  static onMouseMove(x: number, y: number): void {
    this.mousePosition = { x, y };
  }

  /**
   * Handle mouse button event from platform.
   */
  static onMouseButton(button: number, pressed: boolean): void {
    let state = this.mouseButtons.get(button);

    if (!state) {
      state = { isDown: false, justPressed: false, justReleased: false };
      this.mouseButtons.set(button, state);
    }

    if (pressed && !state.isDown) {
      state.isDown = true;
      state.justPressed = true;
    } else if (!pressed && state.isDown) {
      state.isDown = false;
      state.justReleased = true;
    }
  }

  /**
   * Get the current mouse position.
   */
  static getMousePosition(): Vec2 {
    return { ...this.mousePosition };
  }

  /**
   * Check if a mouse button is currently down.
   */
  static isMouseButtonDown(button: number = 0): boolean {
    const state = this.mouseButtons.get(button);
    return state !== undefined && state.isDown;
  }

  /**
   * Check if a mouse button was just pressed.
   */
  static isMouseButtonPressed(button: number = 0): boolean {
    const state = this.mouseButtons.get(button);
    return state !== undefined && state.justPressed;
  }

  /**
   * Check if a mouse button was just released.
   */
  static isMouseButtonReleased(button: number = 0): boolean {
    const state = this.mouseButtons.get(button);
    return state !== undefined && state.justReleased;
  }
}
