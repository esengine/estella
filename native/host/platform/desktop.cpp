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

#include "media/text_edit.hpp"
#include "platform/desktop_keymap.hpp"

#if defined(__APPLE__)
#include "platform/apple_common.hpp"
#elif defined(_WIN32)
#include "platform/windows_common.hpp"
#endif

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;
using eshost::kGamepadButtonToStandard;
using eshost::kScancodeNames;
using eshost::kStandardLeftTrigger;
using eshost::kStandardRightTrigger;
using eshost::ScancodeName;

namespace {

/** The window a game opens in before it has said otherwise. 720p: the smallest
 *  size every desktop display and every Steam Deck can show without scaling. */
constexpr int kDefaultWidth = 1280;
constexpr int kDefaultHeight = 720;

/** Pixels per wheel notch. The same number the web adapter multiplies a
 *  line-mode wheel event by, so a scroll moves a list equally far in both. */
constexpr float kWheelLineHeight = 16.0f;

/** SDL numbers mouse buttons from 1, the DOM from 0, and they disagree about the
 *  middle and right order — hence a mapping rather than a subtraction. */
int domButton(Uint8 sdlButton) {
    switch (sdlButton) {
        case SDL_BUTTON_LEFT: return 0;
        case SDL_BUTTON_MIDDLE: return 1;
        case SDL_BUTTON_RIGHT: return 2;
        case SDL_BUTTON_X1: return 3;
        case SDL_BUTTON_X2: return 4;
        default: return 0;
    }
}

/** The DOM `code` for a physical key, or null for one the tables do not name. */
const char* domCode(SDL_Scancode scancode) {
    for (const ScancodeName& entry : kScancodeNames) {
        if (entry.scancode == scancode) return entry.code;
    }
    return nullptr;
}

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
    /** Win32 only: the HWND's HINSTANCE, which the surface descriptor also wants. */
    void* windowInstance = nullptr;
    /** Where the packaged game's files are — see resolveContentRoot. */
    std::string contentRoot;
    /** SDL_GetPrefPath's directory, kept because every call allocates. */
    std::string prefPath;
    /** The directory holding this binary — see resolveExecutableDir. */
    std::string exeDir;

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

    std::string executableDir() override { return exeDir; }

    // The editing surface, which on desktop is US: a phone hands its keyboard the
    // value and gets edits back, and SDL supplies only committed text and an IME
    // preedit. The model in media/text_edit.hpp is the rest.
    bool hasTextEditor() const override { return true; }

    void textEditorFocus(const std::string& value, int selectionStart, int selectionEnd,
                         bool multiline, int maxLength, bool password) override {
        editor.focus(value, selectionStart, selectionEnd, multiline, maxLength, password);
        // Without this SDL delivers no SDL_EVENT_TEXT_INPUT at all, and on the
        // platforms with a compositor-side IME it is also what opens it.
        if (window) SDL_StartTextInput(window);
        reportEditor();
    }

    void textEditorBlur() override {
        editor.blur();
        if (window) SDL_StopTextInput(window);
    }

    void textEditorWrite(const std::string& value, int selectionStart, int selectionEnd) override {
        editor.write(value, selectionStart, selectionEnd);
        // NOT reported back: this edit came FROM the app, and echoing it would be
        // a second truth racing the one it already has.
    }

    /** Push the model's state across the seam — after every change, because the
     *  SDK's mirror is what a field reads while it renders. */
    void reportEditor() {
        eshost::deliverTextEditorState(editor.value(), editor.selectionStart(),
                                       editor.selectionEnd(), editor.composing());
    }

    eshost::TextEditModel editor;

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
#elif defined(_WIN32)
        return {WebGPUDevice::NativeWindowKind::Win32Hwnd, nativeWindow, windowInstance};
#else
#error "The desktop host has no Linux surface yet — see docs/REARCH_STEAM.md S3c."
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

    // SDL only surfaces a device as a gamepad once it has a mapping for it, so
    // every pad here really is in the standard layout the SDK assumes.
    void pollGamepads(std::vector<eshost::GamepadState>& out) override {
        out.clear();
        int count = 0;
        SDL_JoystickID* ids = SDL_GetGamepads(&count);
        if (!ids) return;
        for (int i = 0; i < count; ++i) {
            SDL_Gamepad* pad = SDL_GetGamepadFromID(ids[i]);
            if (!pad) continue;
            eshost::GamepadState state;
            state.index = i;
            state.connected = true;
            for (int b = 0; b < (int)(sizeof(kGamepadButtonToStandard) / sizeof(int)); ++b) {
                if (SDL_GetGamepadButton(pad, (SDL_GamepadButton)b)) {
                    state.buttons[kGamepadButtonToStandard[b]] = 1.0f;
                }
            }
            // Triggers are axes to SDL and analog BUTTONS to the standard layout,
            // in [0,32767] rather than the sticks' signed range.
            state.buttons[kStandardLeftTrigger] =
                SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER) / 32767.0f;
            state.buttons[kStandardRightTrigger] =
                SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER) / 32767.0f;
            for (int a = 0; a < 4; ++a) {
                const float raw = SDL_GetGamepadAxis(pad, (SDL_GamepadAxis)a);
                // 32768 negative vs 32767 positive: dividing by the smaller
                // magnitude would let a stick read past -1.
                state.axes[a] = raw < 0 ? raw / 32768.0f : raw / 32767.0f;
            }
            out.push_back(state);
        }
        SDL_free(ids);
    }

#if defined(__APPLE__)
    eshost::FontFile loadFont(const std::string& family, u32 codepoint, int style) override {
        return eshost::appleLoadFont(family, codepoint, style);
    }

    void startFetch(const eshost::FetchRequest& req) override { eshost::appleStartFetch(req); }
#elif defined(_WIN32)
    eshost::FontFile loadFont(const std::string& family, u32 codepoint, int style) override {
        return eshost::windowsLoadFont(family, codepoint, style);
    }

    void startFetch(const eshost::FetchRequest& req) override { eshost::windowsStartFetch(req); }
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

/**
 * A key that edits the focused field, if there is one.
 *
 * Only the keys a field OWNS: printable ones arrive as SDL_EVENT_TEXT_INPUT,
 * already through the layout and the IME. While an IME composes, nothing but
 * cancel — stealing its arrows is how a candidate list stops working.
 */
void editKey(const SDL_KeyboardEvent& key) {
    eshost::TextEditModel& editor = g_platform.editor;
    if (!editor.focused()) return;

    const bool shift = (key.mod & SDL_KMOD_SHIFT) != 0;
    // The word-jump chord: Alt on macOS, Ctrl elsewhere — as every text field on
    // each platform does it.
#if defined(__APPLE__)
    const bool word = (key.mod & SDL_KMOD_ALT) != 0;
    const bool command = (key.mod & SDL_KMOD_GUI) != 0;
#else
    const bool word = (key.mod & SDL_KMOD_CTRL) != 0;
    const bool command = (key.mod & SDL_KMOD_CTRL) != 0;
#endif

    if (editor.composing() && key.scancode != SDL_SCANCODE_ESCAPE) return;

    switch (key.scancode) {
        case SDL_SCANCODE_BACKSPACE: editor.backspace(); break;
        case SDL_SCANCODE_DELETE: editor.deleteForward(); break;
        case SDL_SCANCODE_LEFT: editor.moveLeft(shift, word); break;
        case SDL_SCANCODE_RIGHT: editor.moveRight(shift, word); break;
        // A single-line field has one line, so Up/Down are its ends — which is
        // where a caret goes when there is nowhere else to go.
        case SDL_SCANCODE_UP:
        case SDL_SCANCODE_HOME: editor.moveToStart(shift); break;
        case SDL_SCANCODE_DOWN:
        case SDL_SCANCODE_END: editor.moveToEnd(shift); break;
        case SDL_SCANCODE_RETURN:
        case SDL_SCANCODE_KP_ENTER:
            if (editor.multiline()) editor.insert("\n");
            else { eshost::deliverTextEditorSubmit(); return; }
            break;
        case SDL_SCANCODE_ESCAPE:
            if (editor.composing()) editor.setComposition("");
            else { eshost::deliverTextEditorCancel(); return; }
            break;
        case SDL_SCANCODE_A:
            if (!command) return;
            editor.selectAll();
            break;
        case SDL_SCANCODE_C:
        case SDL_SCANCODE_X: {
            if (!command) return;
            const std::string selected = editor.selectedText();
            if (selected.empty()) return;
            SDL_SetClipboardText(selected.c_str());
            if (key.scancode == SDL_SCANCODE_X) editor.deleteSelection();
            break;
        }
        case SDL_SCANCODE_V: {
            if (!command) return;
            char* text = SDL_GetClipboardText();
            if (!text) return;
            // Newlines in a single-line field are what a paste from a document
            // brings; a field that took them would render one line and hold two.
            std::string paste = text;
            SDL_free(text);
            if (!editor.multiline()) {
                std::string flat;
                flat.reserve(paste.size());
                for (const char c : paste) flat.push_back(c == '\n' || c == '\r' ? ' ' : c);
                paste.swap(flat);
            }
            editor.insert(paste);
            break;
        }
        default: return;
    }
    g_platform.reportEditor();
}

/**
 * The directory this binary is in, with a trailing separator.
 *
 * From argv[0]: SDL_GetBasePath answers `Contents/Resources/` inside a macOS
 * bundle, which holds the game's FILES and not its libraries. Falls back to it
 * when argv[0] carries no directory.
 */
std::string resolveExecutableDir(int argc, char** argv) {
    if (argc > 0 && argv[0] && argv[0][0]) {
        const std::string path = argv[0];
        const size_t slash = path.find_last_of("/\\");
        if (slash != std::string::npos) return path.substr(0, slash + 1);
    }
    const char* base = SDL_GetBasePath();
    return base ? std::string(base) : std::string();
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
    g_platform.exeDir = resolveExecutableDir(argc, argv);
    // The directory a store's cloud save syncs. Its shape per OS is written down a
    // second time in build-tools/utils/steamChannel.js (CLOUD_ROOTS), because the
    // backend has to be told it in its own words — change one and change that.
    if (char* pref = SDL_GetPrefPath("Estella", name.c_str())) {
        g_platform.prefPath = pref;
        SDL_free(pref);
    }

    // SDL_WINDOW_METAL only where Metal is the backend: elsewhere it is a request
    // for a surface the platform does not have, and window creation fails.
    SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
#if defined(__APPLE__)
    flags |= SDL_WINDOW_METAL;
#endif
    SDL_Window* window = SDL_CreateWindow(name.c_str(), kDefaultWidth, kDefaultHeight, flags);
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
#elif defined(_WIN32)
    // D3D12 draws straight into the window, so there is no view to make: the
    // HWND and its HINSTANCE are what the surface descriptor asks for.
    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    g_platform.nativeWindow = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr);
    g_platform.windowInstance = SDL_GetPointerProperty(props, SDL_PROP_WINDOW_WIN32_INSTANCE_POINTER, nullptr);
    if (!g_platform.nativeWindow) {
        SDL_Log("SDL gave no HWND for the window — cannot create a D3D12 surface.");
        SDL_Quit();
        return 1;
    }
#endif

    if (!eshost::boot(g_platform)) {
        SDL_Log("Estella host failed to boot — see the log above.");
        SDL_Quit();
        return 1;
    }

    bool running = true;
    // SDL reports mouse positions in window coordinates; the host contract is
    // surface pixels, as it is for touch.
    auto pixelScale = [&] { return SDL_GetWindowPixelDensity(window); };

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
            case SDL_EVENT_MOUSE_BUTTON_DOWN:
                eshost::pointer(0, domButton(e.button.button),
                                e.button.x * pixelScale(), e.button.y * pixelScale());
                break;
            case SDL_EVENT_MOUSE_MOTION:
                // Unconditionally, as the web does: hover is an event there and a
                // game that only heard about motion while a button was held could
                // not implement one.
                eshost::pointer(1, 0, e.motion.x * pixelScale(), e.motion.y * pixelScale());
                break;
            case SDL_EVENT_MOUSE_BUTTON_UP:
                eshost::pointer(2, domButton(e.button.button),
                                e.button.x * pixelScale(), e.button.y * pixelScale());
                break;
            case SDL_EVENT_MOUSE_WHEEL: {
                // SDL counts notches, positive AWAY from the user; the DOM counts
                // pixels, positive TOWARD the content's end. So the vertical sign
                // flips and both scale by the same line height the web adapter uses.
                const float flip = e.wheel.direction == SDL_MOUSEWHEEL_FLIPPED ? -1.0f : 1.0f;
                eshost::wheel(e.wheel.x * flip * kWheelLineHeight,
                              -e.wheel.y * flip * kWheelLineHeight);
                break;
            }
            case SDL_EVENT_KEY_DOWN:
            case SDL_EVENT_KEY_UP:
                // Repeats included: the DOM fires them too, and a game that reads
                // the key's state is unaffected either way.
                if (const char* code = domCode(e.key.scancode)) {
                    eshost::key(e.type == SDL_EVENT_KEY_DOWN, code);
                }
                // AND to the field, if one is focused — not instead. A browser
                // does the same: the hidden textarea takes the key and it still
                // bubbles to the game's own listener, so play == ship.
                if (e.type == SDL_EVENT_KEY_DOWN) editKey(e.key);
                break;
            case SDL_EVENT_TEXT_INPUT:
                if (g_platform.editor.focused()) {
                    g_platform.editor.insert(e.text.text ? e.text.text : "");
                    g_platform.reportEditor();
                }
                break;
            // The IME's preedit. It is NOT in the value yet, and a field that
            // ignored it would show nothing at all while a CJK user types.
            case SDL_EVENT_TEXT_EDITING:
                if (g_platform.editor.focused()) {
                    g_platform.editor.setComposition(e.edit.text ? e.edit.text : "");
                    g_platform.reportEditor();
                }
                break;
            // A pad appears as a joystick first; opening it is what makes SDL
            // report it as a gamepad, and pollGamepads only sees opened ones.
            case SDL_EVENT_GAMEPAD_ADDED:
                SDL_OpenGamepad(e.gdevice.which);
                break;
            case SDL_EVENT_GAMEPAD_REMOVED:
                if (SDL_Gamepad* pad = SDL_GetGamepadFromID(e.gdevice.which)) SDL_CloseGamepad(pad);
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
