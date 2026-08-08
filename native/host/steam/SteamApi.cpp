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

/** Steam's error buffer is a fixed 1024 bytes (SteamErrMsg). */
constexpr int kErrMsgSize = 1024;

struct Fns {
    PfnRunCallbacks runCallbacks = nullptr;
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
    if (g_fns.runCallbacks) g_fns.runCallbacks();
}

}  // namespace eshost
