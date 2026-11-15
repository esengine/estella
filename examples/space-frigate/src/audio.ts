import { Audio, AudioSource, GetWorld, Playthrough, Res, defineSystem } from 'esengine';
import type { App, Entity, World } from 'esengine';
import { helm } from './helm';
import { mining } from './hudMining';
import { ship } from './shipState';
import { SOUNDS, beamVoice, cuesBetween, engineVoice, type ShipSound, type Voice } from './soundMix';

const BINS = 64;
const SPLIT = 8;

export function installAudio(app: App): void {
    const facts = app.getResource(Playthrough).facts;
    Object.assign(facts, {
        soundEngine: false, soundEngineVolume: 0, soundEnginePitch: 0,
        soundBeam: false, soundBeamVolume: 0, soundBeamPitch: 0,
        soundCues: 0, soundLastCue: '', soundMeasured: false, soundLow: 0, soundHigh: 0,
    });
    let engine: Entity | null = null;
    let beam: Entity | null = null;
    let before: ShipSound | null = null;
    const spectrum = new Uint8Array(BINS);

    const voice = (world: World, entity: Entity | null, name: string, clip: string, want: Voice, fade: number): Entity => {
        if (entity === null || !world.valid(entity)) {
            const made = world.spawn(name);
            world.insert(made, AudioSource, { clip, bus: 'sfx', loop: true, fadeIn: fade, fadeOut: fade, ...want });
            return made;
        }
        const now = world.get(entity, AudioSource);
        if (now.playing !== want.playing || now.volume !== want.volume || now.pitch !== want.pitch) {
            world.update(entity, AudioSource, (source) => { source.playing = want.playing; source.volume = want.volume; source.pitch = want.pitch; });
        }
        return entity;
    };

    app.addSystem(defineSystem([GetWorld(), Res(Audio)], (world, audio) => {
        if (world.findEntityByName('Camera') === null) return;
        const now: ShipSound = {
            throttle: ship.throttle, order: helm.order, rudder: helm.rudder, elevation: helm.elevation, mode: helm.mode, arrivals: helm.arrivals,
            firing: mining.firing, heat: mining.heat, overheated: mining.overheated, broken: mining.broken,
        };
        const hum = engineVoice(now.throttle), cut = beamVoice(now.firing, now.heat);
        engine = voice(world, engine, 'EngineSound', SOUNDS.engine, hum, 1.2);
        beam = voice(world, beam, 'MiningBeamSound', SOUNDS.beam, cut, 0.15);
        if (before !== null) {
            for (const cue of cuesBetween(before, now)) {
                audio.playSFX(SOUNDS[cue.sound], { volume: cue.volume, pitch: cue.pitch });
                facts.soundCues = Number(facts.soundCues) + 1;
                facts.soundLastCue = cue.sound;
            }
        }
        before = now;

        facts.soundEngine = world.get(engine, AudioSource).playing;
        facts.soundEngineVolume = hum.volume;
        facts.soundEnginePitch = hum.pitch;
        facts.soundBeam = world.get(beam, AudioSource).playing;
        facts.soundBeamVolume = cut.volume;
        facts.soundBeamPitch = cut.pitch;
        const measured = audio.getSpectrum(spectrum);
        let low = 0, high = 0;
        if (measured) for (let i = 0; i < BINS; i++) { if (i < SPLIT) low += spectrum[i]!; else high += spectrum[i]!; }
        facts.soundMeasured = measured;
        facts.soundLow = low / (SPLIT * 255);
        facts.soundHigh = high / ((BINS - SPLIT) * 255);
    }));
}
