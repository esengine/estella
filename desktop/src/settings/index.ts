/**
 * @file  index.ts — settings barrel. Importing this registers the built-in
 *        settings (./editorSettings side effect) and exposes the registry + types.
 */
import './editorSettings';

export { settingsRegistry } from './registry';
export type {
  Setting,
  SettingsSection,
  SettingScope,
  SettingCategory,
  SettingValue,
} from './types';
