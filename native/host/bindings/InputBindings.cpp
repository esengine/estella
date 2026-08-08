// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    InputBindings.cpp
 * @brief   `es_pollGamepads` — the one half of input the engine PULLS.
 * @details Everything else about input is pushed by the platform's event loop
 *          (es_onNativeTouch / Pointer / Wheel / Key, see Host.hpp). A gamepad
 *          has no events, only a state per frame, so it is polled exactly as
 *          navigator.getGamepads() is on the web.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include <vector>

#include "Bindings.hpp"
#include "Host.hpp"

namespace eshost {
namespace {

JSValue floatArray(JSContext* ctx, const float* values, int count) {
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < count; ++i) {
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewFloat64(ctx, values[i]));
    }
    return arr;
}

// es_pollGamepads() -> [{ index, connected, buttons[], axes[] }]. `mapping` is
// added by the adapter, which is where the claim that this IS the standard
// layout belongs.
JSValue js_pollGamepads(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    JSValue arr = JS_NewArray(ctx);
    if (!hostAlive() || !host().platform) return arr;

    std::vector<GamepadState> pads;
    host().platform->pollGamepads(pads);
    uint32_t n = 0;
    for (const GamepadState& pad : pads) {
        JSValue o = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, o, "index", JS_NewInt32(ctx, pad.index));
        JS_SetPropertyStr(ctx, o, "connected", JS_NewBool(ctx, pad.connected));
        JS_SetPropertyStr(ctx, o, "buttons", floatArray(ctx, pad.buttons, 17));
        JS_SetPropertyStr(ctx, o, "axes", floatArray(ctx, pad.axes, 4));
        JS_SetPropertyUint32(ctx, arr, n++, o);
    }
    return arr;
}

}  // namespace

void registerInputBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_pollGamepads", js_pollGamepads, 0);
}

}  // namespace eshost
