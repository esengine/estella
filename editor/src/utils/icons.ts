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
    LockOpen,
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
    RefreshCw,
    Layers,
    Code,
    Volume2,
    Braces,
    MousePointer2,
    Tag,
    Cog,
    Play,
    Square,
    Grid3X3,
    Upload,
    Download,
    LayoutTemplate,
    Bone,
    EyeOff,
} from 'lucide';

// =============================================================================
// Types
// =============================================================================

type IconNode = [string, Record<string, string | number>][];

// =============================================================================
// Icon Rendering
// =============================================================================

const DEFAULT_SIZE = 14;

const ES_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2d2d2d"/>
      <stop offset="100%" style="stop-color:#1a1a1a"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#e5c07b"/>
      <stop offset="100%" style="stop-color:#d19a66"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="64" fill="url(#bgGrad)"/>
  <g>
    <polygon points="72,120 72,392 240,392 240,340 140,340 140,282 220,282 220,230 140,230 140,172 240,172 240,120" fill="url(#textGrad)"/>
    <path d="M 280 172 Q 280 120 340 120 L 420 120 Q 450 120 450 160 L 450 186 L 398 186 L 398 168 Q 398 158 384 158 L 350 158 Q 320 158 320 188 Q 320 218 350 218 L 400 218 Q 450 218 450 274 L 450 332 Q 450 392 390 392 L 310 392 Q 270 392 270 340 L 270 314 L 322 314 L 322 340 Q 322 354 340 354 L 384 354 Q 404 354 404 324 L 404 290 Q 404 260 380 260 L 330 260 Q 280 260 280 208 Z" fill="url(#textGrad)"/>
  </g>
  <rect x="72" y="424" width="368" height="4" fill="#d19a66" opacity="0.6"/>
</svg>`;

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
    logo: (size = 64) => ES_LOGO_SVG.replace('viewBox="0 0 512 512"', `viewBox="0 0 512 512" width="${size}" height="${size}"`),
    menu: (size?: number) => renderIcon(Menu as IconNode, size),
    plus: (size?: number) => renderIcon(Plus as IconNode, size),
    copy: (size?: number) => renderIcon(Copy as IconNode, size),
    settings: (size?: number) => renderIcon(Settings as IconNode, size),
    eye: (size?: number) => renderIcon(Eye as IconNode, size),
    eyeOff: (size?: number) => renderIcon(EyeOff as IconNode, size),
    star: (size?: number) => renderIcon(Star as IconNode, size),
    chevronRight: (size?: number) => renderIcon(ChevronRight as IconNode, size),
    chevronDown: (size?: number) => renderIcon(ChevronDown as IconNode, size),
    box: (size?: number) => renderIcon(Box as IconNode, size),
    camera: (size?: number) => renderIcon(Camera as IconNode, size),
    type: (size?: number) => renderIcon(Type as IconNode, size),
    image: (size?: number) => renderIcon(Image as IconNode, size),
    circle: (size?: number) => renderIcon(Circle as IconNode, size),
    lock: (size?: number) => renderIcon(Lock as IconNode, size),
    lockOpen: (size?: number) => renderIcon(LockOpen as IconNode, size),
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
    refresh: (size?: number) => renderIcon(RefreshCw as IconNode, size),
    layers: (size?: number) => renderIcon(Layers as IconNode, size),
    code: (size?: number) => renderIcon(Code as IconNode, size),
    volume: (size?: number) => renderIcon(Volume2 as IconNode, size),
    braces: (size?: number) => renderIcon(Braces as IconNode, size),
    pointer: (size?: number) => renderIcon(MousePointer2 as IconNode, size),
    rotateCw: (size?: number) => renderIcon(RotateCw as IconNode, size),
    maximize: (size?: number) => renderIcon(Maximize as IconNode, size),
    tag: (size?: number) => renderIcon(Tag as IconNode, size),
    cog: (size?: number) => renderIcon(Cog as IconNode, size),
    play: (size?: number) => renderIcon(Play as IconNode, size),
    stop: (size?: number) => renderIcon(Square as IconNode, size),
    grid: (size?: number) => renderIcon(Grid3X3 as IconNode, size),
    rect: (size?: number) => renderIcon(Square as IconNode, size),
    upload: (size?: number) => renderIcon(Upload as IconNode, size),
    download: (size?: number) => renderIcon(Download as IconNode, size),
    template: (size?: number) => renderIcon(LayoutTemplate as IconNode, size),
    bone: (size?: number) => renderIcon(Bone as IconNode, size),
};

export type IconName = keyof typeof icons;

export function icon(name: IconName, size?: number): string {
    return icons[name](size);
}
