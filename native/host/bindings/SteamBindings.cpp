// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SteamBindings.cpp
 * @brief   `es_steam_*` — the store's half of the achievements service.
 * @details Bound only where a Steam client can exist (desktop). The SDK installs
 *          its Steam provider when `es_steam_available()` says yes, and keeps the
 *          local one otherwise, so a game's code is the same either way.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"
#include "steam/SteamApi.hpp"

namespace eshost {
namespace {

// es_steam_init(appId) -> bool. Called by the SDK, which is where game.config.json
// is read — the host has no JSON parser and no reason to grow one.
JSValue js_steam_init(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int32_t appId = 0;
    if (argc < 1 || JS_ToInt32(ctx, &appId, argv[0]) < 0 || appId <= 0) return JS_NewBool(ctx, false);
    const bool ok = steam().init(static_cast<uint32_t>(appId));
    if (!ok && !steam().lastError().empty()) {
        // Not an error: no client, signed out, or a build that does not ship to
        // Steam. It reaches the boot record so "achievements did nothing" has an
        // answer that is not a guess.
        ESHOST_LOGI("steam: unavailable — %s", steam().lastError().c_str());
    }
    return JS_NewBool(ctx, ok);
}

JSValue js_steam_available(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewBool(ctx, steam().available());
}

// es_steam_identity() -> { id, name }: the signed-in account. The id is a STRING
// because a 64-bit account id does not survive a double.
JSValue js_steam_identity(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewString(ctx, steam().steamId().c_str()));
    JS_SetPropertyStr(ctx, o, "name", JS_NewString(ctx, steam().personaName().c_str()));
    return o;
}

const char* argString(JSContext* ctx, JSValueConst v, std::string& keep) {
    const char* s = JS_ToCString(ctx, v);
    keep = s ? s : "";
    if (s) JS_FreeCString(ctx, s);
    return keep.c_str();
}

JSValue js_steam_unlock(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::string id;
    if (argc < 1) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, steam().unlock(argString(ctx, argv[0], id)));
}

JSValue js_steam_unlocked(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::string id;
    if (argc < 1) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, steam().unlocked(argString(ctx, argv[0], id)));
}

JSValue js_steam_setStat(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::string name;
    int32_t value = 0;
    if (argc < 2 || JS_ToInt32(ctx, &value, argv[1]) < 0) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, steam().setStat(argString(ctx, argv[0], name), value));
}

JSValue js_steam_getStat(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    std::string name;
    if (argc < 1) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, steam().stat(argString(ctx, argv[0], name)));
}

JSValue js_steam_store(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewBool(ctx, steam().store());
}

JSValue js_steam_reset(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewBool(ctx, steam().reset());
}

}  // namespace

void registerSteamBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_steam_init", js_steam_init, 1);
    bindGlobal(h, global, "es_steam_available", js_steam_available, 0);
    bindGlobal(h, global, "es_steam_identity", js_steam_identity, 0);
    bindGlobal(h, global, "es_steam_unlock", js_steam_unlock, 1);
    bindGlobal(h, global, "es_steam_unlocked", js_steam_unlocked, 1);
    bindGlobal(h, global, "es_steam_setStat", js_steam_setStat, 2);
    bindGlobal(h, global, "es_steam_getStat", js_steam_getStat, 1);
    bindGlobal(h, global, "es_steam_store", js_steam_store, 0);
    bindGlobal(h, global, "es_steam_reset", js_steam_reset, 0);
}

}  // namespace eshost
