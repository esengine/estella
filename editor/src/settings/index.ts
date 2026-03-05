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
} from './SettingsRegistry';

export { showSettingsDialog } from './SettingsDialog';
export { ProjectSettingsSync } from './ProjectSettingsSync';
export {
    MAX_COLLISION_LAYERS,
    getLayerName,
    getNamedLayers,
    layerIndexFromBits,
    bitsFromLayerIndex,
} from './collisionLayers';
