import { icons } from '../utils/icons';
import { getEditorContainer } from '../container';
import { ASSET_TYPE, ASSET_EDITOR_TYPE } from '../container/tokens';

export function getDisplayType(editorType: string): string {
    return getEditorContainer().get(ASSET_EDITOR_TYPE, editorType) ?? editorType;
}

export function getAssetTypeIcon(displayType: string, size: number = 16): string {
    const desc = getEditorContainer().get(ASSET_TYPE, displayType);
    if (desc) {
        return desc.icon(size);
    }
    return icons.file(size);
}
