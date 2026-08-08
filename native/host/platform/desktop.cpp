// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    desktop.cpp
 * @brief   The desktop glue for the JS host: an SDL3 window, the loose files
 *          beside the executable, and a poll loop. One file for Windows, macOS
 *          and Linux.
 * @details The mobile siblings (android.cpp / ios.mm) are one file per OS because
 *          each OS supplies its own event loop, window and lifecycle, and they
 *          agree on nothing. The desktop three DO agree — through SDL — so what
 *          would have been three files is this one plus the two things SDL does
 *          not do: matching a font file and performing an HTTP request. Those go
 *          through a per-OS seam (apple_common.hpp today).
 *
 *          Notably NOT here: writable directories. SDL_GetPrefPath answers that
 *          on all three, and its answer is the same directory a store's cloud
 *          save syncs, so there is nothing per-OS left to decide.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "Host.hpp"

#if defined(__APPLE__)
#include "platform/apple_common.hpp"
#endif

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

namespace {

/** The window a game opens in before it has said otherwise. 720p: the smallest
 *  size every desktop display and every Steam Deck can show without scaling. */
constexpr int kDefaultWidth = 1280;
constexpr int kDefaultHeight = 720;

/** Read a whole file, or an empty vector. */
std::vector<u8> readFileBytes(const std::string& path) {
    SDL_IOStream* io = SDL_IOFromFile(path.c_str(), "rb");
    if (!io) return {};
    const Sint64 size = SDL_GetIOSize(io);
    std::vector<u8> out;
    if (size > 0) {
        out.resize(static_cast<size_t>(size));
        if (SDL_ReadIO(io, out.data(), out.size()) != out.size()) out.clear();
    }
    SDL_CloseIO(io);
    return out;
}

struct DesktopPlatform final : eshost::Platform {
    SDL_Window* window = nullptr;
    /** The CAMetalLayer / HWND / Wayland surface Dawn draws into, from SDL. */
    void* nativeWindow = nullptr;
    /** Where the packaged game's files are — see resolveContentRoot. */
    std::string contentRoot;
    /** SDL_GetPrefPath's directory, kept because every call allocates. */
    std::string prefPath;

    // Loose files in a directory, not an APK's assets or a bundle: that is what a
    // depot ships and what an export already is, so packaging copies rather than
    // repackages.
    std::vector<u8> readAsset(const char* path) override {
        if (contentRoot.empty() || !path) return {};
        return readFileBytes(contentRoot + path);
    }

    /** Regenerable state, under the same per-user root as the saves — a store
     *  syncs that root, and a cache that syncs is merely slow where a save that
     *  does not is a lost game. */
    std::string cacheDir() override {
        if (prefPath.empty()) return {};
        const std::string dir = prefPath + "cache";
        if (!SDL_CreateDirectory(dir.c_str())) return {};
        return dir;
    }

    std::string dataDir() override { return prefPath; }

    /** The same directory: on desktop the player can open it, which is the whole
     *  reason the mobile platforms distinguish a log dir from a private one. */
    std::string logDir() override { return prefPath; }

    std::vector<std::string> publicDirs() override {
        return prefPath.empty() ? std::vector<std::string>{} : std::vector<std::string>{prefPath};
    }

    std::string describe() override {
        std::string out = std::string(SDL_GetPlatform()) + ", ";
        // Version at RUN time, not build time: the first question about a failure
        // on someone else's machine is which OS it was.
        const int v = SDL_GetSystemRAM();
        out += std::to_string(v) + " MB RAM, ";
        out += std::to_string(SDL_GetNumLogicalCPUCores()) + " cores, ";
#if defined(__aarch64__) || defined(_M_ARM64)
        out += "arm64";
#elif defined(__x86_64__) || defined(_M_X64)
        out += "x86_64";
#else
        out += "unknown arch";
#endif
        return out;
    }

    WGPUBackendType backend() const override {
#if defined(__APPLE__)
        return WGPUBackendType_Metal;
#elif defined(_WIN32)
        return WGPUBackendType_D3D12;
#else
        return WGPUBackendType_Vulkan;
#endif
    }

    WebGPUDevice::NativeSurface surface() override {
#if defined(__APPLE__)
        return {WebGPUDevice::NativeWindowKind::MetalLayer, nativeWindow};
#else
#error "The desktop host has only its Apple surface so far — see docs/REARCH_STEAM.md S1."
#endif
    }

    void surfaceSize(u32& width, u32& height) override {
        int w = 0, h = 0;
        if (window) SDL_GetWindowSizeInPixels(window, &w, &h);
        width = static_cast<u32>(w < 0 ? 0 : w);
        height = static_cast<u32>(h < 0 ? 0 : h);
    }

    void log(bool error, const char* message) override {
        SDL_LogMessage(SDL_LOG_CATEGORY_APPLICATION,
                       error ? SDL_LOG_PRIORITY_ERROR : SDL_LOG_PRIORITY_INFO,
                       "[Estella] %s", message);
    }

#if defined(__APPLE__)
    eshost::FontFile loadFont(const std::string& family, u32 codepoint, int style) override {
        return eshost::appleLoadFont(family, codepoint, style);
    }

    void startFetch(const eshost::FetchRequest& req) override { eshost::appleStartFetch(req); }
#endif
};

DesktopPlatform g_platform;

/**
 * Where the game's files are.
 *
 * The argument and the environment variable run an export straight out of the
 * editor's output directory. A SHIPPED game takes the third branch: content
 * beside the executable, put there by the assembler.
 */
std::string resolveContentRoot(int argc, char** argv) {
    auto withSlash = [](std::string p) {
        if (!p.empty() && p.back() != '/' && p.back() != '\\') p += '/';
        return p;
    };
    if (argc > 1 && argv[1] && argv[1][0]) return withSlash(argv[1]);
    if (const char* env = SDL_getenv("ESTELLA_CONTENT"); env && env[0]) return withSlash(env);

    const char* base = SDL_GetBasePath();
    if (!base) return {};
    // `Content/` first, so a bundle that also holds the runtime's own files can
    // keep the game's separate — the layout the macOS .app and the Steam depot use.
    const std::string content = std::string(base) + "Content/";
    return readFileBytes(content + "game.config.json").empty() ? std::string(base) : content;
}

/** The app's name, for the window and for the saves directory.
 *
 *  From the executable, which on desktop IS the identity the assembler set.
 *  Deliberately not app.config.json: that is the PACKAGER's input, and a runtime
 *  reading it too would be a second opinion about this app's name. */
std::string appName(int argc, char** argv) {
    if (argc < 1 || !argv[0] || !argv[0][0]) return "Estella";
    std::string path = argv[0];
    const size_t slash = path.find_last_of("/\\");
    std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
#if defined(_WIN32)
    if (name.size() > 4 && name.compare(name.size() - 4, 4, ".exe") == 0) name.resize(name.size() - 4);
#endif
    return name.empty() ? "Estella" : name;
}

}  // namespace

int main(int argc, char** argv) {
    // Video and gamepads; NOT audio — the host's audio is miniaudio, which opens
    // the device itself, and a second audio subsystem would be a second claim on it.
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMEPAD)) {
        SDL_Log("SDL_Init failed: %s", SDL_GetError());
        return 1;
    }

    const std::string name = appName(argc, argv);
    g_platform.contentRoot = resolveContentRoot(argc, argv);
    if (char* pref = SDL_GetPrefPath("Estella", name.c_str())) {
        g_platform.prefPath = pref;
        SDL_free(pref);
    }

    SDL_Window* window = SDL_CreateWindow(name.c_str(), kDefaultWidth, kDefaultHeight,
                                          SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY
                                              | SDL_WINDOW_METAL);
    if (!window) {
        SDL_Log("SDL_CreateWindow failed: %s", SDL_GetError());
        SDL_Quit();
        return 1;
    }
    g_platform.window = window;

#if defined(__APPLE__)
    // Dawn's Metal backend draws into a CAMetalLayer; SDL owns the view that
    // carries it, including its contents scale.
    SDL_MetalView view = SDL_Metal_CreateView(window);
    if (!view) {
        SDL_Log("SDL_Metal_CreateView failed: %s", SDL_GetError());
        SDL_Quit();
        return 1;
    }
    g_platform.nativeWindow = SDL_Metal_GetLayer(view);
#endif

    if (!eshost::boot(g_platform)) {
        SDL_Log("Estella host failed to boot — see the log above.");
        SDL_Quit();
        return 1;
    }

    bool running = true;
    bool pointerDown = false;

    auto handleEvent = [&](const SDL_Event& e) {
        switch (e.type) {
            case SDL_EVENT_QUIT:
                running = false;
                break;
            case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
                eshost::bindSurface();
                break;
            case SDL_EVENT_WINDOW_MINIMIZED:
            case SDL_EVENT_WINDOW_HIDDEN:
                eshost::surfaceLost();
                eshost::setVisible(false);
                break;
            case SDL_EVENT_WINDOW_RESTORED:
            case SDL_EVENT_WINDOW_SHOWN:
                eshost::setVisible(true);
                eshost::bindSurface();
                break;
            // Mouse as the primary pointer, so a touch-built game is playable.
            // The real desktop surface (other buttons, wheel, keyboard, gamepads)
            // is S2 — Host.hpp takes only touch today.
            case SDL_EVENT_MOUSE_BUTTON_DOWN:
                if (e.button.button == SDL_BUTTON_LEFT) {
                    pointerDown = true;
                    const float s = SDL_GetWindowPixelDensity(window);
                    eshost::touch(0, 0, e.button.x * s, e.button.y * s);
                }
                break;
            case SDL_EVENT_MOUSE_MOTION:
                if (pointerDown) {
                    const float s = SDL_GetWindowPixelDensity(window);
                    eshost::touch(1, 0, e.motion.x * s, e.motion.y * s);
                }
                break;
            case SDL_EVENT_MOUSE_BUTTON_UP:
                if (e.button.button == SDL_BUTTON_LEFT && pointerDown) {
                    pointerDown = false;
                    const float s = SDL_GetWindowPixelDensity(window);
                    eshost::touch(2, 0, e.button.x * s, e.button.y * s);
                }
                break;
            default:
                break;
        }
    };

    while (running) {
        SDL_Event e;
        // A hidden or minimized window has no surface to present to, so the loop
        // blocks for an event rather than spinning at the display's refresh rate.
        if (!eshost::surfaceBound() && SDL_WaitEvent(&e)) handleEvent(e);
        while (SDL_PollEvent(&e)) handleEvent(e);
        if (running && eshost::surfaceBound()) eshost::frame();
        if (eshost::quitRequested()) running = false;
    }

    SDL_Quit();
    return 0;
}
