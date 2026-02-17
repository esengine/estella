import { defineComponent } from '../component';

export interface DraggableData {
    enabled: boolean;
    dragThreshold: number;
    lockX: boolean;
    lockY: boolean;
    constraintMin: { x: number; y: number } | null;
    constraintMax: { x: number; y: number } | null;
}

export const Draggable = defineComponent<DraggableData>('Draggable', {
    enabled: true,
    dragThreshold: 5,
    lockX: false,
    lockY: false,
    constraintMin: null,
    constraintMax: null,
});

export interface DragStateData {
    isDragging: boolean;
    startWorldPos: { x: number; y: number };
    currentWorldPos: { x: number; y: number };
    deltaWorld: { x: number; y: number };
    totalDeltaWorld: { x: number; y: number };
    pointerStartWorld: { x: number; y: number };
}

export const DragState = defineComponent<DragStateData>('DragState', {
    isDragging: false,
    startWorldPos: { x: 0, y: 0 },
    currentWorldPos: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    totalDeltaWorld: { x: 0, y: 0 },
    pointerStartWorld: { x: 0, y: 0 },
});
