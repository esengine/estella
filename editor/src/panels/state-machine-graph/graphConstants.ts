export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 48;
export const NODE_HEADER_HEIGHT = 24;
export const NODE_BORDER_RADIUS = 6;
export const NODE_FONT_SIZE = 12;
export const NODE_SUBTITLE_FONT_SIZE = 10;

export const ENTRY_NODE_WIDTH = 80;
export const ENTRY_NODE_HEIGHT = 32;

export const GRID_SIZE = 20;
export const GRID_DOT_RADIUS = 1;

export const CONNECTION_HIT_TOLERANCE = 6;
export const CONNECTOR_RADIUS = 5;
export const CONNECTOR_HOVER_MARGIN = 12;
export const ARROW_SIZE = 8;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_SPEED = 0.001;

export const COLORS = {
    background: '#1e1e1e',
    gridDot: '#333333',

    nodeFill: '#2d2d2d',
    nodeHeader: '#3c3c3c',
    nodeText: '#cccccc',
    nodeSubtext: '#888888',
    nodeBorder: '#444444',
    nodeSelectedBorder: '#4a9eff',

    entryFill: '#1b3a2a',
    entryHeader: '#2a5a3a',
    entryBorder: '#3a7a4a',
    entryText: '#88cc88',

    connectionLine: '#666666',
    connectionSelected: '#4a9eff',
    connectionPending: '#4a9eff',

    connectorFill: '#4a9eff',
    connectorStroke: '#ffffff',

    playModeActive: '#ff8833',
} as const;

export const AUTO_LAYOUT_SPACING_X = 220;
export const AUTO_LAYOUT_SPACING_Y = 80;
export const AUTO_LAYOUT_START_X = 120;
export const AUTO_LAYOUT_START_Y = 100;
