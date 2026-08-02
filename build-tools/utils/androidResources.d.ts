// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The one resource an exported app carries: its launcher icon. */

export const APP_PACKAGE_ID: number;
export const ICON_RESOURCE_ID: number;
export const ICON_REFERENCE: string;
export const ICON_PATH: string;

export function appResources(iconPng: Buffer): {
  references: Record<string, number>;
  files: { name: string; data: Buffer }[];
  /** resources.arsc, for an APK. */
  arsc: Buffer;
  /** The protobuf table, for an AAB. */
  pb: Buffer;
};
