// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SteamApi.hpp
 * @brief   Steam, reached by loading its library at run time and resolving the
 *          flat C API — so this binary contains no Valve code and no Valve header.
 * @details The engine ships as ONE prebuilt runtime template that every desktop
 *          game is assembled around. Linking steam_api would put Valve code in
 *          that template, and every user of the engine — including everyone who
 *          never ships to Steam — would inherit its licensing. Unreal can link it
 *          because its users compile the engine; we cannot, because ours do not.
 *
 *          So: the declarations below are OURS, written from the flat API's
 *          signatures, and the library is opened only if it is beside the
 *          executable. Absent, {@link SteamApi::available} is false and the game
 *          runs exactly as it does off Steam.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>
#include <string>

namespace eshost {

/**
 * The Steam client, or nothing.
 *
 * One instance, brought up during boot and shut down with the host. Every call is
 * safe when Steam is absent: it answers as though nothing is unlocked and nothing
 * is signed in, which is what a game off Steam sees.
 */
class SteamApi {
  public:
    /**
     * Load the library out of @p directory and initialise.
     *
     * The directory is required, not assumed: `dlopen` given a leaf name never
     * looks beside the executable, so a macOS app shipping the redistributable
     * next to its binary would report Steam absent forever.
     *
     * @param appId     The Steam application id, for the ownership check.
     * @param directory Where the redistributable was shipped, with a trailing
     *                  separator. Empty ⇒ nothing to load.
     * @returns false when there is no library, no running client, or no session —
     *          all of which are ordinary, and none of which is an error.
     */
    bool init(std::uint32_t appId, const std::string& directory);
    void shutdown();

    /** Whether a Steam session is behind this. Everything below is a no-op
     *  otherwise, so nothing has to branch on it except a UI deciding whose
     *  notification to draw. */
    bool available() const { return stats_ != nullptr; }

    /** The signed-in account, as a decimal string — 64 bits does not survive a
     *  double, and this crosses into JS. Empty when signed out. */
    std::string steamId() const;
    /** The account's display name, for a "signed in as" line. */
    std::string personaName() const;

    bool unlock(const char* id);
    bool unlocked(const char* id) const;
    bool setStat(const char* name, std::int32_t value);
    std::int32_t stat(const char* name) const;
    /** Push everything set since the last call; Steam batches behind this. */
    bool store();
    /** Clear every achievement and stat. Development only. */
    bool reset();

    /** Run Steam's callbacks, once per frame. Without it the client never learns
     *  the game is alive and the overlay never opens. */
    void pump();

    /** Why {@link init} answered false, for the boot record. Empty on success. */
    const std::string& lastError() const { return error_; }

  private:
    void* library_ = nullptr;
    void* stats_ = nullptr;
    void* user_ = nullptr;
    void* friends_ = nullptr;
    std::string error_;
};

/** The process's Steam client. */
SteamApi& steam();

}  // namespace eshost
