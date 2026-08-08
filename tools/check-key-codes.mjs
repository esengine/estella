#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-key-codes.mjs — the desktop host's input tables, checked against
 *        the specs rather than against themselves.
 *
 * Both tables in `native/host/platform/desktop_keymap.hpp` fail SILENTLY: a
 * misnamed key or a wrong gamepad index does not error, the input simply never
 * arrives, and a game's WASD works everywhere but one platform. That is the same
 * failure mode ANDROID_ATTR_IDS has, and it gets the same treatment — an
 * independent list here, written from the spec, not derived from the header.
 *
 * The key names are W3C UI Events `code` values; the gamepad indices are the
 * "standard mapping" the SDK's GamepadButton enum spells out.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'native/host/platform/desktop_keymap.hpp'), 'utf8');

/**
 * Every `code` the W3C UI Events spec defines for a key on the USB HID keyboard
 * page — written out here so this file is a SECOND source. Media, browser and
 * power keys are omitted: the header deliberately does not map them.
 */
const W3C_CODES = new Set([
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
    ...'0123456789'.split('').map((d) => `Digit${d}`),
    'Enter', 'Escape', 'Backspace', 'Tab', 'Space', 'CapsLock',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
    'Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'IntlRo', 'IntlYen',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
    'PrintScreen', 'ScrollLock', 'Pause', 'Insert', 'Home', 'PageUp',
    'Delete', 'End', 'PageDown',
    'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp',
    'NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'NumpadAdd',
    'NumpadEnter', 'NumpadDecimal', 'NumpadEqual',
    ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
    'ContextMenu',
    'ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft',
    'ControlRight', 'ShiftRight', 'AltRight', 'MetaRight',
]);

/** SDL's button order (the keys, in order) against the standard mapping's index
 *  (the values). Written from the two specs, NOT copied from the header. */
const EXPECTED_PAD = {
    SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3,
    BACK: 8, GUIDE: 16, START: 9,
    LEFT_STICK: 10, RIGHT_STICK: 11,
    LEFT_SHOULDER: 4, RIGHT_SHOULDER: 5,
    DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};
const EXPECTED_PAD_ORDER = Object.values(EXPECTED_PAD);
const SDL_BUTTON_NAMES = Object.keys(EXPECTED_PAD);

const problems = [];

// -- keys ---------------------------------------------------------------------
const entries = [...source.matchAll(/\{\s*(SDL_SCANCODE_[A-Z0-9_]+)\s*,\s*"([^"]+)"\s*\}/g)]
    .map(([, scancode, code]) => ({ scancode, code }));
if (entries.length < 100) {
    problems.push(`only ${entries.length} key entries parsed — the table's shape changed`);
}
const seenScancode = new Map();
const seenCode = new Map();
for (const { scancode, code } of entries) {
    if (!W3C_CODES.has(code)) problems.push(`"${code}" (${scancode}) is not a W3C code`);
    if (seenScancode.has(scancode)) problems.push(`${scancode} mapped twice`);
    if (seenCode.has(code)) problems.push(`"${code}" produced by ${seenCode.get(code)} and ${scancode}`);
    seenScancode.set(scancode, code);
    seenCode.set(code, scancode);
}
// Anchors: a table that parsed and is internally consistent can still be shifted
// by one, which these catch and nothing else does.
for (const [scancode, code] of [
    ['SDL_SCANCODE_A', 'KeyA'], ['SDL_SCANCODE_Z', 'KeyZ'], ['SDL_SCANCODE_1', 'Digit1'],
    ['SDL_SCANCODE_SPACE', 'Space'], ['SDL_SCANCODE_LEFT', 'ArrowLeft'],
    ['SDL_SCANCODE_LSHIFT', 'ShiftLeft'], ['SDL_SCANCODE_KP_0', 'Numpad0'],
]) {
    const got = seenScancode.get(scancode);
    if (got !== code) problems.push(`${scancode} should be "${code}", is ${got ? `"${got}"` : 'absent'}`);
}

// -- gamepad ------------------------------------------------------------------
const padBlock = source.match(/kGamepadButtonToStandard\[\]\s*=\s*\{([\s\S]*?)\};/);
if (!padBlock) {
    problems.push('kGamepadButtonToStandard not found');
} else {
    const got = [...padBlock[1].matchAll(/^\s*(\d+),/gm)].map(([, n]) => Number(n));
    if (got.length !== EXPECTED_PAD_ORDER.length) {
        problems.push(`gamepad table has ${got.length} entries, expected ${EXPECTED_PAD_ORDER.length}`);
    }
    got.forEach((value, i) => {
        if (value !== EXPECTED_PAD_ORDER[i]) {
            problems.push(`${SDL_BUTTON_NAMES[i]} maps to ${value}, `
                + `the standard layout says ${EXPECTED_PAD_ORDER[i]}`);
        }
    });
    // Every standard button reachable exactly once. The triggers are the two the
    // table cannot carry — SDL reports them as axes — so they are added here; if
    // this fails, some button is unreachable and its game action never fires.
    const covered = [...got, 6, 7].sort((a, b) => a - b);
    const complete = Array.from({ length: 17 }, (_, i) => i);
    if (JSON.stringify(covered) !== JSON.stringify(complete)) {
        problems.push(`the standard buttons are not covered exactly once: ${covered.join(',')}`);
    }
}

if (problems.length) {
    console.log('check-key-codes: the desktop input tables disagree with the specs.\n');
    for (const p of problems) console.log(`  ${p}`);
    console.log('\nSee native/host/platform/desktop_keymap.hpp.');
    process.exit(1);
}
console.log(`check-key-codes: ${entries.length} keys and the gamepad layout match the specs.`);
