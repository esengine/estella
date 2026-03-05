import { UIRect, type UIRectData } from '../ui/UIRect';
import { Transform } from '../component';

export function redirectPositionToUIRect(
    world: any,
    entity: any,
    posValues: Map<string, number>,
): void {
    const currentTransform = world.get(entity, Transform);
    const currentPos = currentTransform.position;
    const rect = world.get(entity, UIRect) as UIRectData;

    const dx = (posValues.has('position.x') ? posValues.get('position.x')! : currentPos.x) - currentPos.x;
    const dy = (posValues.has('position.y') ? posValues.get('position.y')! : currentPos.y) - currentPos.y;

    if (dx === 0 && dy === 0) return;

    world.set(entity, UIRect, {
        ...rect,
        offsetMin: { x: rect.offsetMin.x + dx, y: rect.offsetMin.y + dy },
        offsetMax: { x: rect.offsetMax.x + dx, y: rect.offsetMax.y + dy },
    });
}
