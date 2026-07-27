// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Manifest attributes whose values are NAMES of numbers.
//
// `android:configChanges="orientation|keyboardHidden"` and
// `android:screenOrientation="sensorPortrait"` are written as words and read as
// integers: the platform's parser does `Integer.parseInt` on whatever the compiled
// manifest holds. Shipping the words is not a smaller mistake than shipping the
// wrong number — an APK whose configChanges is a string fails to install at all:
//
//     INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION: Failed to read manifest ...
//     For input string: "orientation|keyboardHidden|screenSize|..."
//
// which is how this was found: on a phone, after every structural check passed.
// A decoder reads the string back happily; only the platform insists.
//
// Values are AOSP's (attrs_manifest.xml). Both manifest encoders — binary XML for
// the APK, protobuf for the App Bundle — resolve through here, so the two cannot
// disagree about what a word means.

/** Flag attributes: `|`-separated names, OR-ed into one int. */
const FLAG_ATTRS = {
    configChanges: {
        mcc: 0x0001,
        mnc: 0x0002,
        locale: 0x0004,
        touchscreen: 0x0008,
        keyboard: 0x0010,
        keyboardHidden: 0x0020,
        navigation: 0x0040,
        orientation: 0x0080,
        screenLayout: 0x0100,
        uiMode: 0x0200,
        screenSize: 0x0400,
        smallestScreenSize: 0x0800,
        density: 0x1000,
        layoutDirection: 0x2000,
        colorMode: 0x4000,
        grammaticalGender: 0x8000,
        fontWeightAdjustment: 0x10000000,
    },
};

/** Enum attributes: one name, one int. */
const ENUM_ATTRS = {
    screenOrientation: {
        unspecified: -1,
        landscape: 0,
        portrait: 1,
        user: 2,
        behind: 3,
        sensor: 4,
        nosensor: 5,
        sensorLandscape: 6,
        sensorPortrait: 7,
        reverseLandscape: 8,
        reversePortrait: 9,
        fullSensor: 10,
        userLandscape: 11,
        userPortrait: 12,
        fullUser: 13,
        locked: 14,
    },
};

/**
 * The integer an attribute's symbolic text means, or null when the attribute is
 * not one of these (the caller then types the text by its shape, as before).
 *
 * An unknown NAME inside a known attribute throws rather than passing through:
 * a typo would otherwise reach a device as an install failure, which is a long
 * way from where it was written.
 *
 * @param {string} name  The attribute's local name, e.g. `configChanges`.
 * @param {string} text  Its authored value.
 * @returns {number|null}
 */
export function symbolicAttrValue(name, text) {
    const flags = FLAG_ATTRS[name];
    if (flags) {
        return text.split('|').reduce((acc, part) => {
            const key = part.trim();
            if (!(key in flags)) throw new Error(`Unknown android:${name} flag "${key}"`);
            return acc | flags[key];
        }, 0) >>> 0;
    }

    const values = ENUM_ATTRS[name];
    if (values) {
        const key = text.trim();
        if (!(key in values)) throw new Error(`Unknown android:${name} value "${key}"`);
        return values[key];
    }

    return null;
}

/** Whether an attribute's value is a name for a number (for tests and callers). */
export function isSymbolicAttr(name) {
    return name in FLAG_ATTRS || name in ENUM_ATTRS;
}
