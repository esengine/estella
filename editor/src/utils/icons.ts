/**
 * @file    icons.ts
 * @brief   Lucide icon utilities for the editor
 */

import {
    Menu,
    Plus,
    Copy,
    Settings,
    Eye,
    Star,
    ChevronRight,
    ChevronDown,
    Box,
    Camera,
    Type,
    Image,
    Circle,
    Lock,
    Bug,
    X,
    Check,
    Move,
    RotateCw,
    Maximize,
    Palette,
    Hash,
    ToggleLeft,
    List,
    Folder,
    FolderOpen,
    File,
    Search,
    Trash2,
} from 'lucide';

// =============================================================================
// Types
// =============================================================================

type IconNode = [string, Record<string, string | number>][];

// =============================================================================
// Icon Rendering
// =============================================================================

const DEFAULT_SIZE = 14;

function renderIcon(iconNode: IconNode, size = DEFAULT_SIZE): string {
    const children = iconNode
        .map(([tag, attrs]) => {
            const attrsStr = Object.entries(attrs)
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ');
            return `<${tag} ${attrsStr}/>`;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

// =============================================================================
// Icon Exports
// =============================================================================

export const icons = {
    menu: (size?: number) => renderIcon(Menu as IconNode, size),
    plus: (size?: number) => renderIcon(Plus as IconNode, size),
    copy: (size?: number) => renderIcon(Copy as IconNode, size),
    settings: (size?: number) => renderIcon(Settings as IconNode, size),
    eye: (size?: number) => renderIcon(Eye as IconNode, size),
    star: (size?: number) => renderIcon(Star as IconNode, size),
    chevronRight: (size?: number) => renderIcon(ChevronRight as IconNode, size),
    chevronDown: (size?: number) => renderIcon(ChevronDown as IconNode, size),
    box: (size?: number) => renderIcon(Box as IconNode, size),
    camera: (size?: number) => renderIcon(Camera as IconNode, size),
    type: (size?: number) => renderIcon(Type as IconNode, size),
    image: (size?: number) => renderIcon(Image as IconNode, size),
    circle: (size?: number) => renderIcon(Circle as IconNode, size),
    lock: (size?: number) => renderIcon(Lock as IconNode, size),
    bug: (size?: number) => renderIcon(Bug as IconNode, size),
    x: (size?: number) => renderIcon(X as IconNode, size),
    check: (size?: number) => renderIcon(Check as IconNode, size),
    move: (size?: number) => renderIcon(Move as IconNode, size),
    rotate: (size?: number) => renderIcon(RotateCw as IconNode, size),
    scale: (size?: number) => renderIcon(Maximize as IconNode, size),
    palette: (size?: number) => renderIcon(Palette as IconNode, size),
    hash: (size?: number) => renderIcon(Hash as IconNode, size),
    toggle: (size?: number) => renderIcon(ToggleLeft as IconNode, size),
    list: (size?: number) => renderIcon(List as IconNode, size),
    folder: (size?: number) => renderIcon(Folder as IconNode, size),
    folderOpen: (size?: number) => renderIcon(FolderOpen as IconNode, size),
    file: (size?: number) => renderIcon(File as IconNode, size),
    search: (size?: number) => renderIcon(Search as IconNode, size),
    trash: (size?: number) => renderIcon(Trash2 as IconNode, size),
};

export type IconName = keyof typeof icons;

export function icon(name: IconName, size?: number): string {
    return icons[name](size);
}
