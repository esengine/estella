export interface GraphNodeLayout {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ViewTransform {
    x: number;
    y: number;
    zoom: number;
}

export interface SelectedTransition {
    from: string;
    index: number;
}

export interface PendingConnection {
    from: string;
    mouseX: number;
    mouseY: number;
}

export interface TransitionInfo {
    from: string;
    target: string;
    index: number;
}

export interface GraphState {
    nodeLayouts: Map<string, GraphNodeLayout>;
    viewTransform: ViewTransform;
    selectedNodes: Set<string>;
    selectedTransition: SelectedTransition | null;
    pendingConnection: PendingConnection | null;
    initialStateName: string | null;
    transitions: TransitionInfo[];
    activeStateName: string | null;
    isPlayMode: boolean;
}

export function createGraphState(): GraphState {
    return {
        nodeLayouts: new Map(),
        viewTransform: { x: 0, y: 0, zoom: 1 },
        selectedNodes: new Set(),
        selectedTransition: null,
        pendingConnection: null,
        initialStateName: null,
        transitions: [],
        activeStateName: null,
        isPlayMode: false,
    };
}
