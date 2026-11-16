import { AttenuationModel, Audio, AudioListener, AudioSource, GetWorld, Input, Playthrough, Res, Transform, calculateAttenuation, defineSystem } from 'esengine';
import type { App, Entity, World } from 'esengine';
import { guns } from './gunnery';
import { helm, turnBy, type Vec } from './helm';
import { mining } from './hudMining';
import { ship } from './shipState';
import { AUDIO_CACHE_BYTES, BEAM_REACH, ENGINE_AT, ENGINE_REACH, MUSIC, MUSIC_VOLUME, SOUNDS, beamVoice, cuesBetween, engineVoice, type ShipSound, type Voice } from './soundMix';

const BINS = 64;
const SPLIT = 8;

export function installAudio(app: App): void {
    const facts = app.getResource(Playthrough).facts;
    Object.assign(facts, {
        soundEngine: false, soundEngineVolume: 0, soundEnginePitch: 0, soundEngineDistance: 0, soundEngineHeard: 0,
        soundBeam: false, soundBeamVolume: 0, soundBeamPitch: 0,
        soundMusic: false, soundMusicReady: false, soundCues: 0, soundLastCue: '', soundMeasured: false, soundLow: 0, soundHigh: 0,
    });
    let engine: Entity | null = null;
    let beam: Entity | null = null;
    let before: ShipSound | null = null;
    let music: boolean | null = null;
    let toggling = false;
    const spectrum = new Uint8Array(BINS);

    const voice = (world: World, entity: Entity | null, name: string, clip: string, at: Vec, reach: { near: number; far: number }, want: Voice, fade: number): Entity => {
        const hull = world.findEntityByName('Ship');
        if (entity === null || !world.valid(entity)) {
            const made = world.spawn(name);
            world.insert(made, Transform, { position: at });
            if (hull !== null) world.setParent(made, hull);
            world.insert(made, AudioSource, {
                clip, bus: 'sfx', loop: true, fadeIn: fade, fadeOut: fade, spatial: true,
                attenuationModel: AttenuationModel.Inverse, minDistance: reach.near, maxDistance: reach.far, ...want,
            });
            return made;
        }
        const now = world.get(entity, AudioSource);
        if (now.playing !== want.playing || now.volume !== want.volume || now.pitch !== want.pitch) {
            world.update(entity, AudioSource, (source) => { source.playing = want.playing; source.volume = want.volume; source.pitch = want.pitch; });
        }
        return entity;
    };

    app.addSystem(defineSystem([GetWorld(), Res(Audio), Res(Input)], (world, audio, input) => {
        const camera = world.findEntityByName('Camera');
        if (camera === null) return;
        if (!world.has(camera, AudioListener)) world.insert(camera, AudioListener, { enabled: true });

        const key = input.isKeyDown('KeyM');
        const wanted = music === null ? true : key && !toggling ? !music : music;
        toggling = key;
        if (music === null) audio.setBufferBudget(AUDIO_CACHE_BYTES);
        if (wanted !== music) {
            if (wanted) audio.playBGM(MUSIC, { volume: MUSIC_VOLUME, fadeIn: 3 });
            else audio.stopBGM(0.6);
            music = wanted;
        }

        const now: ShipSound = {
            throttle: ship.throttle, order: helm.order, rudder: helm.rudder, elevation: helm.elevation, mode: helm.mode, arrivals: helm.arrivals,
            firing: mining.firing, heat: mining.heat, overheated: mining.overheated, broken: mining.broken, shots: guns.shots,
        };
        const hum = engineVoice(now.throttle), cut = beamVoice(now.firing, now.heat);
        engine = voice(world, engine, 'EngineSound', SOUNDS.engine, ENGINE_AT, ENGINE_REACH, hum, 1.2);
        beam = voice(world, beam, 'MiningBeamSound', SOUNDS.beam, { x: 0, y: 0, z: 0 }, BEAM_REACH, cut, 0.15);
        if (before !== null) {
            for (const cue of cuesBetween(before, now)) {
                audio.playSFX(SOUNDS[cue.sound], { volume: cue.volume, pitch: cue.pitch });
                facts.soundCues = Number(facts.soundCues) + 1;
                facts.soundLastCue = cue.sound;
            }
        }
        before = now;

        const eye = world.get(camera, Transform).position;
        const stern = turnBy(helm.attitude, ENGINE_AT);
        const distance = Math.hypot(eye.x - stern.x, eye.y - stern.y, eye.z - stern.z);
        facts.soundEngine = world.get(engine, AudioSource).playing;
        facts.soundEngineVolume = hum.volume;
        facts.soundEnginePitch = hum.pitch;
        facts.soundEngineDistance = distance;
        facts.soundEngineHeard = hum.volume * calculateAttenuation(distance, { model: AttenuationModel.Inverse, refDistance: ENGINE_REACH.near, maxDistance: ENGINE_REACH.far, rolloff: 1 });
        facts.soundBeam = world.get(beam, AudioSource).playing;
        facts.soundBeamVolume = cut.volume;
        facts.soundBeamPitch = cut.pitch;
        facts.soundMusic = music;
        facts.soundMusicReady = audio.getBufferHandle(MUSIC) !== undefined;
        const measured = audio.getSpectrum(spectrum);
        let low = 0, high = 0;
        if (measured) for (let i = 0; i < BINS; i++) { if (i < SPLIT) low += spectrum[i]!; else high += spectrum[i]!; }
        facts.soundMeasured = measured;
        facts.soundLow = low / (SPLIT * 255);
        facts.soundHigh = high / ((BINS - SPLIT) * 255);
    }));
}
