// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SteamApi.cpp
 * @brief   The dynamic load and the flat-API calls. See the header for why this
 *          is loaded rather than linked.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "steam/SteamApi.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>

#include "Runtime.hpp"   // ESHOST_LOGI / ESHOST_LOGE

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace eshost {
namespace {

/** The library's name, per platform — the redistributable's own filename. */
#if defined(_WIN32)
constexpr const char* kSteamLibrary = "steam_api64.dll";
#elif defined(__APPLE__)
constexpr const char* kSteamLibrary = "libsteam_api.dylib";
#else
constexpr const char* kSteamLibrary = "libsteam_api.so";
#endif

/**
 * The accessor names to try, newest first.
 *
 * ★ The accessor carries the INTERFACE VERSION in its name, so one hard-coded
 * name means a newer redistributable silently has no achievements. A window is
 * tried, and none resolving is reported rather than vanishing.
 */
constexpr const char* kUserStatsAccessors[] = {
    "SteamAPI_SteamUserStats_v014", "SteamAPI_SteamUserStats_v013",
    "SteamAPI_SteamUserStats_v012", "SteamAPI_SteamUserStats_v011",
};
constexpr const char* kUserAccessors[] = {
    "SteamAPI_SteamUser_v024", "SteamAPI_SteamUser_v023", "SteamAPI_SteamUser_v022",
};
constexpr const char* kFriendsAccessors[] = {
    "SteamAPI_SteamFriends_v018", "SteamAPI_SteamFriends_v017", "SteamAPI_SteamFriends_v016",
};
constexpr const char* kUtilsAccessors[] = {
    "SteamAPI_SteamUtils_v011", "SteamAPI_SteamUtils_v010", "SteamAPI_SteamUtils_v009",
};

void* openLibrary(const char* name) {
#if defined(_WIN32)
    return reinterpret_cast<void*>(LoadLibraryA(name));
#else
    return dlopen(name, RTLD_LAZY | RTLD_LOCAL);
#endif
}

void closeLibrary(void* handle) {
    if (!handle) return;
#if defined(_WIN32)
    FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
    dlclose(handle);
#endif
}

void* symbol(void* handle, const char* name) {
    if (!handle) return nullptr;
#if defined(_WIN32)
    return reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(handle), name));
#else
    return dlsym(handle, name);
#endif
}

/** The subset of the flat API this host calls, declared here because the point is
 *  to carry no Valve header. Signatures transcribed from steam_api_flat.h. */
using PfnInitFlat = int (*)(char* outErrMsg);          // ESteamAPIInitResult; 0 == OK
using PfnShutdown = void (*)();
using PfnRunCallbacks = void (*)();
using PfnRestartAppIfNecessary = bool (*)(std::uint32_t appId);
using PfnAccessor = void* (*)();
using PfnSetAchievement = bool (*)(void* self, const char* name);
using PfnGetAchievement = bool (*)(void* self, const char* name, bool* achieved);
using PfnClearAchievement = bool (*)(void* self, const char* name);
using PfnStoreStats = bool (*)(void* self);
using PfnResetAllStats = bool (*)(void* self, bool alsoAchievements);
using PfnSetStatInt32 = bool (*)(void* self, const char* name, std::int32_t value);
using PfnGetStatInt32 = bool (*)(void* self, const char* name, std::int32_t* out);
using PfnGetSteamID = std::uint64_t (*)(void* self);
using PfnGetPersonaName = const char* (*)(void* self);
using PfnActivateGameOverlay = void (*)(void* self, const char* dialog);
using PfnIsOverlayEnabled = bool (*)(void* self);

/**
 * Manual dispatch — how a binding that carries no Valve header reads callbacks.
 *
 * The header's own mechanism is a C++ class whose vtable Steam writes into, which
 * cannot be declared without the header. Valve added these four for exactly this
 * case, and every non-C++ binding uses them.
 */
using PfnManualDispatchInit = void (*)();
using PfnGetHSteamPipe = std::int32_t (*)();
using PfnManualDispatchRunFrame = void (*)(std::int32_t pipe);
using PfnManualDispatchFreeLastCallback = void (*)(std::int32_t pipe);

/** CallbackMsg_t, field for field — the layout the dispatcher writes into. */
struct CallbackMsg {
    std::int32_t steamUser;
    std::int32_t callback;
    std::uint8_t* param;
    std::int32_t paramSize;
};
using PfnManualDispatchGetNextCallback = bool (*)(std::int32_t pipe, CallbackMsg* out);

/**
 * GameOverlayActivated_t — `k_iSteamFriendsCallbacks (300) + 31`.
 *
 * A number, so getting it wrong is a pause that silently never happens. It is
 * checked by a run rather than by reading: ESTELLA_STEAM_SELFCHECK opens the
 * overlay and reports which ids arrived (see Host.cpp).
 */
constexpr std::int32_t kGameOverlayActivated = 331;

/** Its first byte: non-zero while the overlay covers the game. */
constexpr int kOverlayActiveOffset = 0;

/** How long after Steam comes up the self-check opens the overlay.
 *
 *  Seconds, not frames: an uncapped host runs a thousand frames in the first one,
 *  so a frame count fires before the window is on screen — and opening the overlay
 *  then is a refusal that looks exactly like a callback that never came. */
constexpr std::chrono::seconds kSelfCheckDelay{25};

/** Steam's error buffer is a fixed 1024 bytes (SteamErrMsg). */
constexpr int kErrMsgSize = 1024;

struct Fns {
    PfnRunCallbacks runCallbacks = nullptr;
    PfnManualDispatchInit dispatchInit = nullptr;
    PfnGetHSteamPipe getPipe = nullptr;
    PfnManualDispatchRunFrame dispatchRunFrame = nullptr;
    PfnManualDispatchGetNextCallback dispatchNext = nullptr;
    PfnManualDispatchFreeLastCallback dispatchFree = nullptr;
    PfnActivateGameOverlay activateOverlay = nullptr;
    PfnIsOverlayEnabled isOverlayEnabled = nullptr;
    PfnSetAchievement setAchievement = nullptr;
    PfnGetAchievement getAchievement = nullptr;
    PfnClearAchievement clearAchievement = nullptr;
    PfnStoreStats storeStats = nullptr;
    PfnResetAllStats resetAllStats = nullptr;
    PfnSetStatInt32 setStat = nullptr;
    PfnGetStatInt32 getStat = nullptr;
    PfnGetSteamID getSteamID = nullptr;
    PfnGetPersonaName getPersonaName = nullptr;
    PfnShutdown shutdown = nullptr;
};
Fns g_fns;

/** Resolve the first accessor that exists, and say which. */
void* resolveInterface(void* lib, const char* const* names, int count, const char** chosen) {
    for (int i = 0; i < count; ++i) {
        if (auto fn = reinterpret_cast<PfnAccessor>(symbol(lib, names[i]))) {
            *chosen = names[i];
            return fn();
        }
    }
    return nullptr;
}

}  // namespace

SteamApi& steam() {
    static SteamApi instance;
    return instance;
}

bool SteamApi::init(std::uint32_t appId, const std::string& directory) {
    if (library_) return available();
    error_.clear();

    if (directory.empty()) {
        error_ = "this host does not know where its own libraries are";
        return false;
    }
    const std::string libraryPath = directory + kSteamLibrary;
    library_ = openLibrary(libraryPath.c_str());
    if (!library_) {
        // Ordinary: a build that does not ship to Steam has no reason to carry it.
        // The PATH is named, not the leaf: "it is not there" and "it is there and
        // the loader looked somewhere else" read identically otherwise.
        error_ = libraryPath + " is not there";
        return false;
    }

    auto initFlat = reinterpret_cast<PfnInitFlat>(symbol(library_, "SteamAPI_InitFlat"));
    g_fns.shutdown = reinterpret_cast<PfnShutdown>(symbol(library_, "SteamAPI_Shutdown"));
    g_fns.runCallbacks = reinterpret_cast<PfnRunCallbacks>(symbol(library_, "SteamAPI_RunCallbacks"));
    if (!initFlat) {
        error_ = "SteamAPI_InitFlat is missing — the library is not a Steamworks redistributable";
        closeLibrary(library_);
        library_ = nullptr;
        return false;
    }

    char message[kErrMsgSize] = {};
    const int result = initFlat(message);
    if (result != 0) {
        // No client running, not signed in, or the app is not owned. None of these
        // is a defect, and each has to reach the boot record in Steam's own words.
        error_ = message[0] ? message : "SteamAPI_InitFlat failed";
        closeLibrary(library_);
        library_ = nullptr;
        return false;
    }

    const char* statsVersion = "";
    const char* userVersion = "";
    const char* friendsVersion = "";
    stats_ = resolveInterface(library_, kUserStatsAccessors,
                              (int)(sizeof(kUserStatsAccessors) / sizeof(char*)), &statsVersion);
    user_ = resolveInterface(library_, kUserAccessors,
                             (int)(sizeof(kUserAccessors) / sizeof(char*)), &userVersion);
    friends_ = resolveInterface(library_, kFriendsAccessors,
                                (int)(sizeof(kFriendsAccessors) / sizeof(char*)), &friendsVersion);
    if (!stats_) {
        error_ = "no ISteamUserStats accessor resolved — this redistributable is newer than the "
                 "versions this host knows (see kUserStatsAccessors)";
        ESHOST_LOGE("steam: %s", error_.c_str());
        shutdown();
        return false;
    }

    g_fns.setAchievement = reinterpret_cast<PfnSetAchievement>(
        symbol(library_, "SteamAPI_ISteamUserStats_SetAchievement"));
    g_fns.getAchievement = reinterpret_cast<PfnGetAchievement>(
        symbol(library_, "SteamAPI_ISteamUserStats_GetAchievement"));
    g_fns.clearAchievement = reinterpret_cast<PfnClearAchievement>(
        symbol(library_, "SteamAPI_ISteamUserStats_ClearAchievement"));
    g_fns.storeStats = reinterpret_cast<PfnStoreStats>(
        symbol(library_, "SteamAPI_ISteamUserStats_StoreStats"));
    g_fns.resetAllStats = reinterpret_cast<PfnResetAllStats>(
        symbol(library_, "SteamAPI_ISteamUserStats_ResetAllStats"));
    g_fns.setStat = reinterpret_cast<PfnSetStatInt32>(
        symbol(library_, "SteamAPI_ISteamUserStats_SetStatInt32"));
    g_fns.getStat = reinterpret_cast<PfnGetStatInt32>(
        symbol(library_, "SteamAPI_ISteamUserStats_GetStatInt32"));
    g_fns.getSteamID = reinterpret_cast<PfnGetSteamID>(
        symbol(library_, "SteamAPI_ISteamUser_GetSteamID"));
    g_fns.getPersonaName = reinterpret_cast<PfnGetPersonaName>(
        symbol(library_, "SteamAPI_ISteamFriends_GetPersonaName"));
    g_fns.activateOverlay = reinterpret_cast<PfnActivateGameOverlay>(
        symbol(library_, "SteamAPI_ISteamFriends_ActivateGameOverlay"));
    const char* utilsVersion = "";
    utils_ = resolveInterface(library_, kUtilsAccessors,
                              (int)(sizeof(kUtilsAccessors) / sizeof(char*)), &utilsVersion);
    g_fns.isOverlayEnabled = reinterpret_cast<PfnIsOverlayEnabled>(
        symbol(library_, "SteamAPI_ISteamUtils_IsOverlayEnabled"));

    // Manual dispatch, AFTER init and before any other dispatch call — that order
    // is Valve's, and the wrong one leaves a pipe that answers nothing.
    g_fns.dispatchInit = reinterpret_cast<PfnManualDispatchInit>(
        symbol(library_, "SteamAPI_ManualDispatch_Init"));
    g_fns.getPipe = reinterpret_cast<PfnGetHSteamPipe>(symbol(library_, "SteamAPI_GetHSteamPipe"));
    g_fns.dispatchRunFrame = reinterpret_cast<PfnManualDispatchRunFrame>(
        symbol(library_, "SteamAPI_ManualDispatch_RunFrame"));
    g_fns.dispatchNext = reinterpret_cast<PfnManualDispatchGetNextCallback>(
        symbol(library_, "SteamAPI_ManualDispatch_GetNextCallback"));
    g_fns.dispatchFree = reinterpret_cast<PfnManualDispatchFreeLastCallback>(
        symbol(library_, "SteamAPI_ManualDispatch_FreeLastCallback"));
    if (g_fns.dispatchInit && g_fns.getPipe) {
        g_fns.dispatchInit();
        pipe_ = g_fns.getPipe();
    }

    ESHOST_LOGI("steam: up for app %u (%s, %s, %s)", appId, statsVersion, userVersion, friendsVersion);
    return true;
}

void SteamApi::shutdown() {
    if (g_fns.shutdown) g_fns.shutdown();
    closeLibrary(library_);
    library_ = nullptr;
    stats_ = user_ = friends_ = nullptr;
    g_fns = Fns{};
}

std::string SteamApi::steamId() const {
    if (!user_ || !g_fns.getSteamID) return {};
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%llu",
                  static_cast<unsigned long long>(g_fns.getSteamID(user_)));
    return buf;
}

std::string SteamApi::personaName() const {
    if (!friends_ || !g_fns.getPersonaName) return {};
    const char* name = g_fns.getPersonaName(friends_);
    return name ? name : "";
}

bool SteamApi::unlock(const char* id) {
    return stats_ && g_fns.setAchievement && g_fns.setAchievement(stats_, id);
}

bool SteamApi::unlocked(const char* id) const {
    bool achieved = false;
    if (stats_ && g_fns.getAchievement) g_fns.getAchievement(stats_, id, &achieved);
    return achieved;
}

bool SteamApi::setStat(const char* name, std::int32_t value) {
    return stats_ && g_fns.setStat && g_fns.setStat(stats_, name, value);
}

std::int32_t SteamApi::stat(const char* name) const {
    std::int32_t value = 0;
    if (stats_ && g_fns.getStat) g_fns.getStat(stats_, name, &value);
    return value;
}

bool SteamApi::store() {
    return stats_ && g_fns.storeStats && g_fns.storeStats(stats_);
}

bool SteamApi::reset() {
    return stats_ && g_fns.resetAllStats && g_fns.resetAllStats(stats_, true);
}

void SteamApi::pump() {
    // Manual dispatch REPLACES RunCallbacks — calling both would run each
    // callback twice, once through a queue the other already drained.
    if (pipe_ == 0 || !g_fns.dispatchRunFrame || !g_fns.dispatchNext || !g_fns.dispatchFree) {
        if (g_fns.runCallbacks) g_fns.runCallbacks();
        return;
    }
    // The self-check opens the overlay from the FRAME, not from boot: Steam
    // refuses to draw over a window that does not exist yet, and a refusal looks
    // exactly like a callback that never came.
    if (traceCallbacks_ && !selfCheckDone_) {
        // Whether the overlay CAN draw. It answers false while still being
        // injected AND when disabled, so this waits rather than reading once —
        // the two are identical from outside and only one explains no callback.
        const bool enabled = utils_ && g_fns.isOverlayEnabled && g_fns.isOverlayEnabled(utils_);
        const auto waited = std::chrono::steady_clock::now() - traceStart_;
        if (enabled || waited >= kSelfCheckDelay) {
            selfCheckDone_ = true;
            ESHOST_LOGI("steam: self-check opening the overlay after %llds (IsOverlayEnabled=%d)",
                        (long long)std::chrono::duration_cast<std::chrono::seconds>(waited).count(),
                        enabled ? 1 : 0);
            activateOverlay();
        }
    }
    g_fns.dispatchRunFrame(pipe_);
    CallbackMsg msg{};
    while (g_fns.dispatchNext(pipe_, &msg)) {
        if (traceCallbacks_) {
            ESHOST_LOGI("steam: callback user=%d id=%d bytes=%d first=%d",
                        msg.steamUser, msg.callback, msg.paramSize,
                        msg.param && msg.paramSize > 0 ? (int)msg.param[0] : -1);
        }
        if (msg.callback == kGameOverlayActivated && msg.param && msg.paramSize > kOverlayActiveOffset) {
            const bool covered = msg.param[kOverlayActiveOffset] != 0;
            if (overlay_) overlay_(covered);
        }
        // Every callback, on every path: the dispatcher hands out ONE at a time
        // and will not advance until the last is released.
        g_fns.dispatchFree(pipe_);
    }
}

void SteamApi::activateOverlay() {
    if (!friends_ || !g_fns.activateOverlay) {
        ESHOST_LOGI("steam: ActivateGameOverlay did not resolve (friends=%p fn=%p)",
                    friends_, reinterpret_cast<void*>(g_fns.activateOverlay));
        return;
    }
    g_fns.activateOverlay(friends_, "Friends");
}

}  // namespace eshost
