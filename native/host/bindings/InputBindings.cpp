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

esjs::Val floatArray(const float* values, int count) {
    esjs::Val arr = esjs::array();
    for (int i = 0; i < count; ++i) {
        esjs::setAt(arr, (uint32_t)i, esjs::number(values[i]));
    }
    return arr;
}

// es_pollGamepads() -> [{ index, connected, buttons[], axes[] }]. `mapping` is
// added by the adapter, which is where the claim that this IS the standard
// layout belongs.
esjs::Val js_pollGamepads(const esjs::Args& a) {
    esjs::Val arr = esjs::array();
    if (!hostAlive() || !host().platform) return arr;

    std::vector<GamepadState> pads;
    host().platform->pollGamepads(pads);
    uint32_t n = 0;
    for (const GamepadState& pad : pads) {
        esjs::Val o = esjs::object();
        esjs::set(o, "index", esjs::int32(pad.index));
        esjs::set(o, "connected", esjs::boolean(pad.connected));
        esjs::set(o, "buttons", floatArray(pad.buttons, 17));
        esjs::set(o, "axes", floatArray(pad.axes, 4));
        esjs::setAt(arr, n++, o);
    }
    return arr;
}

}  // namespace

void registerInputBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_pollGamepads", js_pollGamepads, 0);
}

}  // namespace eshost
