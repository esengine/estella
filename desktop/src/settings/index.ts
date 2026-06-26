// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — settings barrel. Importing this registers the built-in
 *        settings (./editorSettings side effect) and exposes the registry + types.
 */
import './editorSettings';
import './projectSettings';

export { settingsRegistry } from './registry';
export type {
  Setting,
  SettingsSection,
  SettingScope,
  SettingCategory,
  SettingValue,
} from './types';
