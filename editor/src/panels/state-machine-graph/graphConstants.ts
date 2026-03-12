export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 44;
export const NODE_HEADER_HEIGHT = 22;
export const NODE_BORDER_RADIUS = 10;
export const NODE_FONT_SIZE = 12;
export const NODE_SUBTITLE_FONT_SIZE = 10;

export const ENTRY_NODE_WIDTH = 72;
export const ENTRY_NODE_HEIGHT = 30;

export const GRID_SIZE = 20;
export const GRID_DOT_RADIUS = 1;

export const CONNECTION_HIT_TOLERANCE = 6;
export const CONNECTOR_RADIUS = 5;
export const CONNECTOR_HOVER_MARGIN = 12;
export const ARROW_SIZE = 8;

export const BEZIER_CONTROL_X = 0.3;
export const BEZIER_CONTROL_Y = 0.05;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_SPEED = 0.001;

export const COLORS = {
    background: '#1a1a1a',
    gridDot: '#2a2a2a',

    nodeFill: '#3d3d3d',
    nodeHeader: '#4a4a4a',
    nodeText: '#e0e0e0',
    nodeSubtext: '#999999',
    nodeBorder: '#555555',
    nodeSelectedBorder: '#57a5ff',

    entryFill: '#2a5a3a',
    entryHeader: '#2a5a3a',
    entryBorder: '#4a9a5a',
    entryText: '#a0dda0',

    anyFill: '#3a2a5a',
    anyBorder: '#6a4a9a',
    anyText: '#b0a0dd',

    exitFill: '#4a2a2a',
    exitBorder: '#9a4a4a',
    exitText: '#dda0a0',

    connectionLine: '#777777',
    connectionSelected: '#57a5ff',
    connectionPending: '#57a5ff',

    connectorFill: '#57a5ff',
    connectorStroke: '#ffffff',

    playModeActive: '#ff8833',
} as const;

export const AUTO_LAYOUT_SPACING_X = 220;
export const AUTO_LAYOUT_SPACING_Y = 80;
export const AUTO_LAYOUT_START_X = 120;
export const AUTO_LAYOUT_START_Y = 100;
