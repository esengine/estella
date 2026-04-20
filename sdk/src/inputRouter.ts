/**
 * @file    inputRouter.ts
 * @brief   Chain-of-responsibility input routing (editor → UI → game)
 *
 * The platform layer delivers raw events (key, pointer, wheel, touch) into
 * the SDK. Before those events land in the `InputState` that gameplay code
 * polls, they pass through the router's tier-1 (editor) and tier-2 (UI)
 * handlers. Either tier can return `true` from a callback to consume the
 * event; consumed events do not update InputState and do not propagate to
 * later tiers.
 *
 * Tier-3 (game) is implicit — it is the InputState resource itself. Code
 * that calls `state.isKeyDown(...)` / `state.isMouseButtonDown(...)` sees
 * only events that no upstream handler claimed.
 *
 * Chain-of-responsibility (rather than a boolean editor-is-active flag)
 * lets a tool consume only the events it actually cares about: a marquee
 * drag claims mouse-move while pressed but lets wheel scroll through to
 * the viewport camera; a modal dialog consumes Escape but ignores the
 * arrow keys.
 */

// =============================================================================
// Types
// =============================================================================

export interface Modifiers {
    readonly shift: boolean;
    readonly ctrl: boolean;
    readonly alt: boolean;
    readonly meta: boolean;
}

const NO_MODS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });

/**
 * An input handler. All methods are optional; return `true` to consume an
 * event (stops propagation to later tiers and to InputState), `false` /
 * `void` to let it fall through.
 */
export interface InputHandler {
    onKeyDown?(code: string, mods: Modifiers): boolean | void;
    onKeyUp?(code: string, mods: Modifiers): boolean | void;
    onPointerMove?(x: number, y: number, mods: Modifiers): boolean | void;
    onPointerDown?(button: number, x: number, y: number, mods: Modifiers): boolean | void;
    onPointerUp?(button: number, mods: Modifiers): boolean | void;
    onWheel?(deltaX: number, deltaY: number, mods: Modifiers): boolean | void;
    onTouchStart?(id: number, x: number, y: number): boolean | void;
    onTouchMove?(id: number, x: number, y: number): boolean | void;
    onTouchEnd?(id: number): boolean | void;
    onTouchCancel?(id: number): boolean | void;
}

// =============================================================================
// Router
// =============================================================================

export class InputRouter {
    private editorHandler_: InputHandler | null = null;
    private uiHandler_: InputHandler | null = null;
    private mods_: Modifiers = NO_MODS;

    /** Registers the editor-tier handler and returns an unregister thunk. */
    setEditorHandler(handler: InputHandler | null): () => void {
        this.editorHandler_ = handler;
        return () => {
            if (this.editorHandler_ === handler) this.editorHandler_ = null;
        };
    }

    /** Registers the UI-tier handler and returns an unregister thunk. */
    setUIHandler(handler: InputHandler | null): () => void {
        this.uiHandler_ = handler;
        return () => {
            if (this.uiHandler_ === handler) this.uiHandler_ = null;
        };
    }

    get currentMods(): Modifiers {
        return this.mods_;
    }

    // ── Dispatch (called by InputPlugin) ────────────────────────────────

    dispatchKeyDown(code: string): boolean {
        this.updateModsFromKey(code, true);
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onKeyDown), this.editorHandler_, code, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onKeyDown), this.uiHandler_, code, this.mods_)
        );
    }

    dispatchKeyUp(code: string): boolean {
        const consumed =
            invokeBool(asHandlerFn(this.editorHandler_?.onKeyUp), this.editorHandler_, code, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onKeyUp), this.uiHandler_, code, this.mods_);
        // Update mods AFTER dispatch so handlers see the modifier as still-held
        // on the key-up edge that released it — matches DOM `event.shiftKey`
        // semantics for keyup events.
        this.updateModsFromKey(code, false);
        return consumed;
    }

    dispatchPointerMove(x: number, y: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onPointerMove), this.editorHandler_, x, y, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onPointerMove), this.uiHandler_, x, y, this.mods_)
        );
    }

    dispatchPointerDown(button: number, x: number, y: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onPointerDown), this.editorHandler_, button, x, y, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onPointerDown), this.uiHandler_, button, x, y, this.mods_)
        );
    }

    dispatchPointerUp(button: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onPointerUp), this.editorHandler_, button, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onPointerUp), this.uiHandler_, button, this.mods_)
        );
    }

    dispatchWheel(deltaX: number, deltaY: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onWheel), this.editorHandler_, deltaX, deltaY, this.mods_) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onWheel), this.uiHandler_, deltaX, deltaY, this.mods_)
        );
    }

    dispatchTouchStart(id: number, x: number, y: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onTouchStart), this.editorHandler_, id, x, y) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onTouchStart), this.uiHandler_, id, x, y)
        );
    }

    dispatchTouchMove(id: number, x: number, y: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onTouchMove), this.editorHandler_, id, x, y) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onTouchMove), this.uiHandler_, id, x, y)
        );
    }

    dispatchTouchEnd(id: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onTouchEnd), this.editorHandler_, id) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onTouchEnd), this.uiHandler_, id)
        );
    }

    dispatchTouchCancel(id: number): boolean {
        return (
            invokeBool(asHandlerFn(this.editorHandler_?.onTouchCancel), this.editorHandler_, id) ||
            invokeBool(asHandlerFn(this.uiHandler_?.onTouchCancel), this.uiHandler_, id)
        );
    }

    // ── Internal ────────────────────────────────────────────────────────

    private updateModsFromKey(code: string, pressed: boolean): void {
        let { shift, ctrl, alt, meta } = this.mods_;
        if (code === 'ShiftLeft' || code === 'ShiftRight') shift = pressed;
        else if (code === 'ControlLeft' || code === 'ControlRight') ctrl = pressed;
        else if (code === 'AltLeft' || code === 'AltRight') alt = pressed;
        else if (code === 'MetaLeft' || code === 'MetaRight' || code === 'OSLeft' || code === 'OSRight')
            meta = pressed;
        else return;
        this.mods_ = { shift, ctrl, alt, meta };
    }
}

// A module-level singleton parallels the existing `inputPlugin` singleton:
// editors attach their handler once at startup regardless of how many Apps
// may exist. Tests that need isolation can construct their own InputRouter.
export const inputRouter = new InputRouter();

// =============================================================================
// Helpers
// =============================================================================

// Invoke a handler callback with the supplied args. Returns true iff the
// handler explicitly returned `true` (the "I consumed it" signal). A
// handler that returns undefined / false / throws is treated as not
// consuming — broken handlers should not stop dispatch.
function invokeBool(
    fn: ((...args: unknown[]) => boolean | void) | undefined,
    thisArg: unknown,
    ...args: unknown[]
): boolean {
    if (typeof fn !== 'function') return false;
    try {
        return fn.apply(thisArg, args) === true;
    } catch {
        return false;
    }
}

// Cast helper — each InputHandler method has its own concrete signature,
// but from the dispatch loop we treat them uniformly. The type system
// can't infer this across heterogeneous methods, so we cast at the call
// site. The cast is safe because the method's own parameters line up
// with the args we pass.
type HandlerFn = ((...args: unknown[]) => boolean | void) | undefined;
function asHandlerFn(fn: unknown): HandlerFn {
    return fn as HandlerFn;
}
