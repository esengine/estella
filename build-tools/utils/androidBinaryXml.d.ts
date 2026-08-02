// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Android binary XML (AXML) encoding — the shape the TS side consumes. */

export const ANDROID_NS: string;
export const ANDROID_ATTR_IDS: Record<string, number>;
export const ANDROID_STYLE_IDS: Record<string, number>;

export function parseXml(text: string): unknown;
export function encodeBinaryXml(root: unknown, references?: Record<string, number>): Buffer;
/** Parse + encode in one step: the manifest as an APK carries it. */
export function compileManifest(xml: string, references?: Record<string, number>): Buffer;
