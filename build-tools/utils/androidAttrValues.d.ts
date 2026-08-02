// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Symbolic android:* attribute values (enums and flag sets) as their integers. */

/** The integer for `android:<name>="<text>"`, or null when it is not symbolic. */
export function symbolicAttrValue(name: string, text: string): number | null;
export function isSymbolicAttr(name: string): boolean;
