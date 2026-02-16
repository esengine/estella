export {
    type SettingsItemType,
    type SettingsSectionDescriptor,
    type SettingsItemDescriptor,
    registerSettingsSection,
    registerSettingsItem,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    getAllSections,
    getSectionItems,
    getItemDescriptor,
    lockBuiltinSettings,
    clearExtensionSettings,
} from './SettingsRegistry';

export { showSettingsDialog } from './SettingsDialog';
export { registerBuiltinSettings } from './builtinSettings';
