import { transitionTo, type SceneManagerState, type TransitionConfig } from 'esengine';

export const SCENES = {
    menu: 'menu',
    level1: 'level-1',
    level2: 'level-2',
} as const;

// One TransitionConfig per hop, so each demonstrates a different duration/color.
export const FADE_TO_LEVEL_1: TransitionConfig = {
    type: 'fade',
    duration: 0.6,
    color: { r: 0, g: 0, b: 0, a: 1 },
};

export const FADE_TO_LEVEL_2: TransitionConfig = {
    type: 'fade',
    duration: 0.9,
    color: { r: 1, g: 1, b: 1, a: 1 },
};

export const FADE_TO_MENU: TransitionConfig = {
    type: 'fade',
    duration: 1.2,
    color: { r: 0.05, g: 0.07, b: 0.16, a: 1 },
};

/**
 * `transitionTo` accepts the App (host code) or the SceneManager resource state
 * (systems — `Res(SceneManager)`), which is what the button systems hold here.
 * A switch already in flight is ignored by the manager, so double-clicks during
 * a fade are safe.
 */
export function goTo(scenes: SceneManagerState, target: string, fade: TransitionConfig): void {
    void transitionTo(scenes, target, fade);
}
