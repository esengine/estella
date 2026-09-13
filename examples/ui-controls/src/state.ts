import type { Entity } from 'esengine';

// Every control the systems talk to, looked up once by the name it carries in
// the scene. A null here means the scene stopped carrying that entity, which is
// the only way this demo can break.
export const ids: Record<string, Entity | null> = {};

export const state = {
    wired: false,
    clicks: 0,
    paused: false,
    progressT: 0,
    progressDir: 1,
};
