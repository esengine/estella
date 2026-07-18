// Gesture handlers write here; the ship and HUD systems read it. Keeps the
// GestureDetector callbacks decoupled from the ECS world.
export const gestureState = {
    /** Pending swipe displacement in world units; consumed by the ship system. */
    stepX: 0,
    stepY: 0,
    /** Ship scale, driven by pinch. */
    scale: 1,
    /** Last recognized gesture, for the pad HUD. */
    last: '-',
};
