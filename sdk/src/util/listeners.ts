// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    listeners.ts
 * @brief   Host event listeners, counted — because nothing else can count them.
 *
 * @details `addEventListener` is write-only: having called it, there is no way
 *          to ask a target what is attached to it. So a plugin that subscribes
 *          to `resize` on install and forgets to detach on cleanup leaks one
 *          listener per Play/Stop, every one of them still firing, and no
 *          instrument in the engine or the browser will say so. It shows up as
 *          "the editor got slow after lunch".
 *
 *          Subscribing through {@link addTrackedListener} makes the total
 *          readable, which is all the resource census needs: the count is
 *          conserved across a Play/Stop round trip, so drift IS the bug report.
 *          The disposer it returns is idempotent, so a cleanup path that runs
 *          twice cannot push the count below what is really attached.
 */

type Target = {
    addEventListener(type: string, handler: (ev: never) => void, options?: unknown): void;
    removeEventListener(type: string, handler: (ev: never) => void, options?: unknown): void;
};

let live = 0;

/** Host listeners attached through {@link addTrackedListener} and not yet removed. */
export function liveDomListeners(): number {
    return live;
}

/**
 * `target.addEventListener`, plus the bookkeeping. Returns the detach — call it
 * instead of `removeEventListener` so the count stays honest.
 */
export function addTrackedListener<E>(
    target: Target,
    type: string,
    handler: (ev: E) => void,
    options?: AddEventListenerOptions | boolean,
): () => void {
    target.addEventListener(type, handler as (ev: never) => void, options);
    live++;
    let detached = false;
    return () => {
        if (detached) return;
        detached = true;
        live--;
        target.removeEventListener(type, handler as (ev: never) => void, options);
    };
}
