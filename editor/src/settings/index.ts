export {
    type SettingsItemType,
    type SettingsSectionDescriptor,
    type SettingsGroupDescriptor,
    type SettingsItemDescriptor,
    registerSettingsSection,
    registerSettingsGroup,
    registerSettingsItem,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    getAllSections,
    getSectionItems,
    getSectionGroups,
    getGroupItems,
    getUngroupedSectionItems,
    searchSettings,
    sectionHasModifiedValues,
    resetSection,
    exportSettings,
    importSettings,
    getItemDescriptor,
    getGroupDescriptor,
    lockBuiltinSettings,
    clearExtensionSettings,
} from './SettingsRegistry';

export { showSettingsDialog } from './SettingsDialog';
export { registerBuiltinSettings } from './builtinSettings';
export { ProjectSettingsSync } from './ProjectSettingsSync';
export {
    MAX_COLLISION_LAYERS,
    getLayerName,
    getNamedLayers,
    layerIndexFromBits,
    bitsFromLayerIndex,
} from './collisionLayers';
