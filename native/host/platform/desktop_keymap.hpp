// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    desktop_keymap.hpp
 * @brief   SDL scancode → DOM `KeyboardEvent.code`, and SDL gamepad → the W3C
 *          standard mapping. The two tables that decide whether a game's input
 *          means the same thing here as it does in a browser.
 * @details Both are the silent-failure kind: a wrong entry does not error, the
 *          key or button simply never arrives — so `tools/check-key-codes.mjs`
 *          checks this file against the W3C list rather than trusting it.
 *
 *          SDL scancodes ARE USB HID usage-page-0x07 numbers (SDL_scancode.h says
 *          so), and the W3C `code` table is defined over those same numbers, so
 *          the mapping below is a transcription with an authority, not a guess.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <SDL3/SDL.h>

namespace eshost {

struct ScancodeName {
    SDL_Scancode scancode;
    const char* code;
};

/** Every key a game binds. Media and browser keys are left out deliberately: a
 *  key with no DOM `code` would have to be invented one, and an invented name is
 *  a name no input map is written against. */
constexpr ScancodeName kScancodeNames[] = {
    {SDL_SCANCODE_A, "KeyA"}, {SDL_SCANCODE_B, "KeyB"}, {SDL_SCANCODE_C, "KeyC"},
    {SDL_SCANCODE_D, "KeyD"}, {SDL_SCANCODE_E, "KeyE"}, {SDL_SCANCODE_F, "KeyF"},
    {SDL_SCANCODE_G, "KeyG"}, {SDL_SCANCODE_H, "KeyH"}, {SDL_SCANCODE_I, "KeyI"},
    {SDL_SCANCODE_J, "KeyJ"}, {SDL_SCANCODE_K, "KeyK"}, {SDL_SCANCODE_L, "KeyL"},
    {SDL_SCANCODE_M, "KeyM"}, {SDL_SCANCODE_N, "KeyN"}, {SDL_SCANCODE_O, "KeyO"},
    {SDL_SCANCODE_P, "KeyP"}, {SDL_SCANCODE_Q, "KeyQ"}, {SDL_SCANCODE_R, "KeyR"},
    {SDL_SCANCODE_S, "KeyS"}, {SDL_SCANCODE_T, "KeyT"}, {SDL_SCANCODE_U, "KeyU"},
    {SDL_SCANCODE_V, "KeyV"}, {SDL_SCANCODE_W, "KeyW"}, {SDL_SCANCODE_X, "KeyX"},
    {SDL_SCANCODE_Y, "KeyY"}, {SDL_SCANCODE_Z, "KeyZ"},

    {SDL_SCANCODE_1, "Digit1"}, {SDL_SCANCODE_2, "Digit2"}, {SDL_SCANCODE_3, "Digit3"},
    {SDL_SCANCODE_4, "Digit4"}, {SDL_SCANCODE_5, "Digit5"}, {SDL_SCANCODE_6, "Digit6"},
    {SDL_SCANCODE_7, "Digit7"}, {SDL_SCANCODE_8, "Digit8"}, {SDL_SCANCODE_9, "Digit9"},
    {SDL_SCANCODE_0, "Digit0"},

    {SDL_SCANCODE_RETURN, "Enter"}, {SDL_SCANCODE_ESCAPE, "Escape"},
    {SDL_SCANCODE_BACKSPACE, "Backspace"}, {SDL_SCANCODE_TAB, "Tab"},
    {SDL_SCANCODE_SPACE, "Space"}, {SDL_SCANCODE_CAPSLOCK, "CapsLock"},

    {SDL_SCANCODE_MINUS, "Minus"}, {SDL_SCANCODE_EQUALS, "Equal"},
    {SDL_SCANCODE_LEFTBRACKET, "BracketLeft"}, {SDL_SCANCODE_RIGHTBRACKET, "BracketRight"},
    {SDL_SCANCODE_BACKSLASH, "Backslash"}, {SDL_SCANCODE_SEMICOLON, "Semicolon"},
    {SDL_SCANCODE_APOSTROPHE, "Quote"}, {SDL_SCANCODE_GRAVE, "Backquote"},
    {SDL_SCANCODE_COMMA, "Comma"}, {SDL_SCANCODE_PERIOD, "Period"},
    {SDL_SCANCODE_SLASH, "Slash"}, {SDL_SCANCODE_NONUSBACKSLASH, "IntlBackslash"},
    {SDL_SCANCODE_INTERNATIONAL1, "IntlRo"}, {SDL_SCANCODE_INTERNATIONAL3, "IntlYen"},

    {SDL_SCANCODE_F1, "F1"}, {SDL_SCANCODE_F2, "F2"}, {SDL_SCANCODE_F3, "F3"},
    {SDL_SCANCODE_F4, "F4"}, {SDL_SCANCODE_F5, "F5"}, {SDL_SCANCODE_F6, "F6"},
    {SDL_SCANCODE_F7, "F7"}, {SDL_SCANCODE_F8, "F8"}, {SDL_SCANCODE_F9, "F9"},
    {SDL_SCANCODE_F10, "F10"}, {SDL_SCANCODE_F11, "F11"}, {SDL_SCANCODE_F12, "F12"},
    {SDL_SCANCODE_F13, "F13"}, {SDL_SCANCODE_F14, "F14"}, {SDL_SCANCODE_F15, "F15"},
    {SDL_SCANCODE_F16, "F16"}, {SDL_SCANCODE_F17, "F17"}, {SDL_SCANCODE_F18, "F18"},
    {SDL_SCANCODE_F19, "F19"}, {SDL_SCANCODE_F20, "F20"}, {SDL_SCANCODE_F21, "F21"},
    {SDL_SCANCODE_F22, "F22"}, {SDL_SCANCODE_F23, "F23"}, {SDL_SCANCODE_F24, "F24"},

    {SDL_SCANCODE_PRINTSCREEN, "PrintScreen"}, {SDL_SCANCODE_SCROLLLOCK, "ScrollLock"},
    {SDL_SCANCODE_PAUSE, "Pause"}, {SDL_SCANCODE_INSERT, "Insert"},
    {SDL_SCANCODE_HOME, "Home"}, {SDL_SCANCODE_PAGEUP, "PageUp"},
    {SDL_SCANCODE_DELETE, "Delete"}, {SDL_SCANCODE_END, "End"},
    {SDL_SCANCODE_PAGEDOWN, "PageDown"},

    {SDL_SCANCODE_RIGHT, "ArrowRight"}, {SDL_SCANCODE_LEFT, "ArrowLeft"},
    {SDL_SCANCODE_DOWN, "ArrowDown"}, {SDL_SCANCODE_UP, "ArrowUp"},

    {SDL_SCANCODE_NUMLOCKCLEAR, "NumLock"}, {SDL_SCANCODE_KP_DIVIDE, "NumpadDivide"},
    {SDL_SCANCODE_KP_MULTIPLY, "NumpadMultiply"}, {SDL_SCANCODE_KP_MINUS, "NumpadSubtract"},
    {SDL_SCANCODE_KP_PLUS, "NumpadAdd"}, {SDL_SCANCODE_KP_ENTER, "NumpadEnter"},
    {SDL_SCANCODE_KP_1, "Numpad1"}, {SDL_SCANCODE_KP_2, "Numpad2"},
    {SDL_SCANCODE_KP_3, "Numpad3"}, {SDL_SCANCODE_KP_4, "Numpad4"},
    {SDL_SCANCODE_KP_5, "Numpad5"}, {SDL_SCANCODE_KP_6, "Numpad6"},
    {SDL_SCANCODE_KP_7, "Numpad7"}, {SDL_SCANCODE_KP_8, "Numpad8"},
    {SDL_SCANCODE_KP_9, "Numpad9"}, {SDL_SCANCODE_KP_0, "Numpad0"},
    {SDL_SCANCODE_KP_PERIOD, "NumpadDecimal"}, {SDL_SCANCODE_KP_EQUALS, "NumpadEqual"},

    {SDL_SCANCODE_APPLICATION, "ContextMenu"},
    {SDL_SCANCODE_LCTRL, "ControlLeft"}, {SDL_SCANCODE_LSHIFT, "ShiftLeft"},
    {SDL_SCANCODE_LALT, "AltLeft"}, {SDL_SCANCODE_LGUI, "MetaLeft"},
    {SDL_SCANCODE_RCTRL, "ControlRight"}, {SDL_SCANCODE_RSHIFT, "ShiftRight"},
    {SDL_SCANCODE_RALT, "AltRight"}, {SDL_SCANCODE_RGUI, "MetaRight"},
};

/**
 * SDL's gamepad button order is NOT the standard mapping's — SDL counts
 * back/guide/start before the shoulders, the W3C layout counts the shoulders and
 * triggers first — so the two are related by this table and by nothing else.
 * Index into it with an SDL button; the value is the SDK's GamepadButton.
 */
constexpr int kGamepadButtonToStandard[] = {
    0,   // SOUTH
    1,   // EAST
    2,   // WEST
    3,   // NORTH
    8,   // BACK
    16,  // GUIDE
    9,   // START
    10,  // LEFT_STICK
    11,  // RIGHT_STICK
    4,   // LEFT_SHOULDER
    5,   // RIGHT_SHOULDER
    12,  // DPAD_UP
    13,  // DPAD_DOWN
    14,  // DPAD_LEFT
    15,  // DPAD_RIGHT
};

/** The standard layout's analog triggers, which SDL reports as axes. */
constexpr int kStandardLeftTrigger = 6;
constexpr int kStandardRightTrigger = 7;

}  // namespace eshost
