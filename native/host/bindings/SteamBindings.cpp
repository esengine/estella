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

#include <cstdlib>

namespace eshost {
namespace {

/** Push the overlay's state into JS, where the services layer pauses the game. */
void deliverSteamOverlay(bool covered) {
    if (!hostAlive() || !esjs::alive()) return;
    esjs::Enter enter;
    const esjs::Val arg = esjs::boolean(covered);
    callJs(host(), "es_onSteamOverlay", 1, &arg);
}

// es_steam_init(appId) -> bool. Called by the SDK, which is where game.config.json
// is read — the host has no JSON parser and no reason to grow one.
esjs::Val js_steam_init(const esjs::Args& a) {
    const int32_t appId = a.size() < 1 ? 0 : esjs::toInt32(a[0]);
    if (appId <= 0) return esjs::boolean(false);
    // The platform says where the redistributable was shipped. A leaf name would
    // do on Windows and silently never resolve on macOS (see SteamApi::init).
    const std::string dir = host().platform ? host().platform->executableDir() : std::string();
    const bool ok = steam().init(static_cast<uint32_t>(appId), dir);
    if (ok) {
        // The overlay covers the game without changing anything a host can see —
        // the window keeps its focus and stays visible — so this push is the only
        // way the services layer learns to pause.
        steam().onOverlay([](bool covered) { deliverSteamOverlay(covered); });
        if (const char* self = std::getenv("ESTELLA_STEAM_SELFCHECK"); self && self[0] == '1') {
            steam().traceCallbacks(true);
        }
    }
    if (!ok && !steam().lastError().empty()) {
        // Not an error: no client, signed out, or a build that does not ship to
        // Steam. It reaches the boot record so "achievements did nothing" has an
        // answer that is not a guess.
        ESHOST_LOGI("steam: unavailable — %s", steam().lastError().c_str());
    }
    return esjs::boolean(ok);
}

esjs::Val js_steam_available(const esjs::Args& a) {
    return esjs::boolean(steam().available());
}

// es_steam_identity() -> { id, name }: the signed-in account. The id is a STRING
// because a 64-bit account id does not survive a double.
esjs::Val js_steam_identity(const esjs::Args& a) {
    esjs::Val o = esjs::object();
    esjs::set(o, "id", esjs::string(steam().steamId().c_str()));
    esjs::set(o, "name", esjs::string(steam().personaName().c_str()));
    return o;
}

const char* argString(esjs::Val v, std::string& keep) {
    keep = esjs::toString(v);
    return keep.c_str();
}

esjs::Val js_steam_unlock(const esjs::Args& a) {
    std::string id;
    if (a.size() < 1) return esjs::boolean(false);
    return esjs::boolean(steam().unlock(argString(a[0], id)));
}

esjs::Val js_steam_unlocked(const esjs::Args& a) {
    std::string id;
    if (a.size() < 1) return esjs::boolean(false);
    return esjs::boolean(steam().unlocked(argString(a[0], id)));
}

esjs::Val js_steam_setStat(const esjs::Args& a) {
    std::string name;
    if (a.size() < 2) return esjs::boolean(false);
    const int32_t value = esjs::toInt32(a[1]);
    return esjs::boolean(steam().setStat(argString(a[0], name), value));
}

esjs::Val js_steam_getStat(const esjs::Args& a) {
    std::string name;
    if (a.size() < 1) return esjs::int32(0);
    return esjs::int32(steam().stat(argString(a[0], name)));
}

esjs::Val js_steam_store(const esjs::Args& a) {
    return esjs::boolean(steam().store());
}

esjs::Val js_steam_reset(const esjs::Args& a) {
    return esjs::boolean(steam().reset());
}

}  // namespace

void registerSteamBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_steam_init", js_steam_init, 1);
    bindGlobal(global, "es_steam_available", js_steam_available, 0);
    bindGlobal(global, "es_steam_identity", js_steam_identity, 0);
    bindGlobal(global, "es_steam_unlock", js_steam_unlock, 1);
    bindGlobal(global, "es_steam_unlocked", js_steam_unlocked, 1);
    bindGlobal(global, "es_steam_setStat", js_steam_setStat, 2);
    bindGlobal(global, "es_steam_getStat", js_steam_getStat, 1);
    bindGlobal(global, "es_steam_store", js_steam_store, 0);
    bindGlobal(global, "es_steam_reset", js_steam_reset, 0);
}

}  // namespace eshost
