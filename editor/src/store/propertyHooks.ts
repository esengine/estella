import { ButtonState } from 'esengine';
import type { EntityData, SceneData } from '../types/SceneTypes';
import type { PropertyWritePipeline } from './PropertyWritePipeline';

export interface PropertyHookHost {
    getEntityData(entityId: number): EntityData | undefined;
    readonly scene: SceneData;
}

export function registerBuiltinTransformHooks(
    pipeline: PropertyWritePipeline,
    host: PropertyHookHost,
): void {
    pipeline.registerTransformHook('Transform', 'position', (event, entityData, p) => {
        if (!entityData.components.some(c => c.type === 'UIRect')) return;

        const uiRect = entityData.components.find(c => c.type === 'UIRect');
        if (!uiRect) return;

        const oldPos = event.oldValue as { x: number; y: number };
        const newPos = event.newValue as { x: number; y: number };
        const dx = newPos.x - oldPos.x;
        const dy = newPos.y - oldPos.y;
        if (dx === 0 && dy === 0) return;

        const offsetMin = uiRect.data.offsetMin as { x: number; y: number };
        const offsetMax = uiRect.data.offsetMax as { x: number; y: number };

        p.writeDirect(event.entity, 'UIRect', 'offsetMin', {
            x: offsetMin.x + dx, y: offsetMin.y + dy,
        });
        p.writeDirect(event.entity, 'UIRect', 'offsetMax', {
            x: offsetMax.x + dx, y: offsetMax.y + dy,
        });
    });

    pipeline.registerTransformHook('TextInput', 'backgroundColor', (event, _entityData, p) => {
        p.writeDirect(event.entity, 'Sprite', 'color', event.newValue);
    });

    pipeline.registerTransformHook('Button', '*', (event, entityData, p) => {
        const buttonComp = entityData.components.find(c => c.type === 'Button');
        const spriteComp = entityData.components.find(c => c.type === 'Sprite');
        if (!buttonComp || !spriteComp) return;

        const transition = buttonComp.data.transition as {
            normalColor: { r: number; g: number; b: number; a: number };
            hoveredColor: { r: number; g: number; b: number; a: number };
            pressedColor: { r: number; g: number; b: number; a: number };
            disabledColor: { r: number; g: number; b: number; a: number };
        } | null;
        if (!transition) return;

        const state = (buttonComp.data.state as number) ?? ButtonState.Normal;
        const colorMap: Record<number, { r: number; g: number; b: number; a: number }> = {
            [ButtonState.Normal]: transition.normalColor,
            [ButtonState.Hovered]: transition.hoveredColor,
            [ButtonState.Pressed]: transition.pressedColor,
            [ButtonState.Disabled]: transition.disabledColor,
        };
        const color = colorMap[state] ?? transition.normalColor;

        p.writeDirect(event.entity, 'Sprite', 'color', { ...color });
    });

    pipeline.registerTransformHook('Canvas', '*', (event, entityData, p) => {
        const canvasComp = entityData.components.find(c => c.type === 'Canvas');
        const resolution = canvasComp?.data?.designResolution as { x: number; y: number } | undefined;
        if (!resolution) return;

        const orthoSize = resolution.y / 2;

        for (const entity of host.scene.entities) {
            const cameraComp = entity.components.find(c => c.type === 'Camera');
            if (!cameraComp) continue;
            p.writeDirect(entity.id, 'Camera', 'orthoSize', orthoSize);
            break;
        }
    });
}
