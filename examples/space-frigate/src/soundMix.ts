export const SOUNDS = {
    engine: 'assets/audio/engine.essound',
    beam: 'assets/audio/beam.essound',
    helmOrder: 'assets/audio/helm-order.essound',
    helmMode: 'assets/audio/helm-mode.essound',
    arrival: 'assets/audio/arrival.essound',
    alarm: 'assets/audio/alarm.essound',
    rockBreak: 'assets/audio/rock-break.essound',
} as const;

export const MUSIC = 'assets/audio/drift.esmusic';
export const MUSIC_VOLUME = 0.4;
export const AUDIO_CACHE_BYTES = 64 * 1024 * 1024;

export const ENGINE_AT = { x: 0, y: 0, z: -47 };
export const ENGINE_REACH = { near: 35, far: 600 };
export const BEAM_REACH = { near: 60, far: 800 };

export type SoundName = keyof typeof SOUNDS;

export interface ShipSound {
    throttle: number;
    order: number;
    rudder: number;
    elevation: number;
    mode: string;
    arrivals: number;
    firing: boolean;
    heat: number;
    overheated: boolean;
    broken: number;
}

export interface Voice { playing: boolean; volume: number; pitch: number }
export interface Cue { sound: SoundName; volume: number; pitch: number }

const unit = (v: number): number => Math.max(0, Math.min(1, v));

export const engineVoice = (throttle: number): Voice => {
    const t = unit(throttle);
    return { playing: true, volume: 0.3 + 0.5 * t, pitch: 0.9 + 0.3 * t };
};

export const beamVoice = (firing: boolean, heat: number): Voice => ({ playing: firing, volume: 0.5, pitch: 1 + 0.2 * unit(heat) });

export function cuesBetween(before: ShipSound, now: ShipSound): Cue[] {
    const cues: Cue[] = [];
    if (now.mode !== before.mode) cues.push({ sound: 'helmMode', volume: 0.25, pitch: now.mode === 'manual' ? 0.8 : 1 });
    else if (now.order !== before.order) cues.push({ sound: 'helmOrder', volume: 0.3, pitch: now.order > before.order ? 1.04 : 0.96 });
    else if (now.mode === 'manual' && now.elevation !== before.elevation) cues.push({ sound: 'helmOrder', volume: 0.3, pitch: now.elevation > before.elevation ? 1.04 : 0.96 });
    else if (now.mode === 'manual' && now.rudder !== before.rudder) cues.push({ sound: 'helmOrder', volume: 0.3, pitch: 1 });
    if (now.arrivals > before.arrivals) cues.push({ sound: 'arrival', volume: 0.35, pitch: 1 });
    if (now.overheated && !before.overheated) cues.push({ sound: 'alarm', volume: 0.3, pitch: 1 });
    if (now.broken > before.broken) cues.push({ sound: 'rockBreak', volume: 0.45, pitch: 1 });
    return cues;
}
