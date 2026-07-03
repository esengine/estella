import { PostProcessVolume, Transform } from 'esengine';
import type { PostProcessVolumeData, CommandsInstance } from 'esengine';
import { Sweep, ShowcaseOwned } from './components';

type EffectList = PostProcessVolumeData['effects'];

// One entry per screen. `global` is the effect list applied to the scene-wide
// volume; the final `local` entry instead spawns an orbiting local volume (see
// spawnLocalVolume) to show off camera-relative volume blending.
export interface Showcase {
    name: string;
    hint: string;
    global: EffectList;
    local?: boolean;
}

const fx = (type: string, uniforms: Record<string, number>): EffectList[number] =>
    ({ type, enabled: true, uniforms });

export const SHOWCASES: Showcase[] = [
    { name: 'Bloom', hint: 'bright pixels bleed a soft glow', global: [
        fx('bloom', { u_threshold: 0.3, u_intensity: 1.6, u_radius: 5 })] },
    { name: 'Blur', hint: 'a 9-tap gaussian softens the frame', global: [
        fx('blur', { u_intensity: 3 })] },
    { name: 'Pixelate', hint: 'snaps sampling to a coarse grid', global: [
        fx('pixelate', { u_pixelSize: 8 })] },
    { name: 'Chromatic Aberration', hint: 'splits the colour channels radially', global: [
        fx('chromaticAberration', { u_intensity: 6 })] },
    { name: 'Lens Distortion', hint: 'barrels the image like a wide lens', global: [
        fx('lensDistortion', { u_strength: 0.35, u_zoom: 1.1 })] },
    { name: 'Vignette', hint: 'darkens toward the corners', global: [
        fx('vignette', { u_intensity: 0.7, u_softness: 0.45 })] },
    { name: 'Grayscale', hint: 'luma-weighted desaturation', global: [
        fx('grayscale', { u_intensity: 1 })] },
    { name: 'Color Grade', hint: 'exposure, contrast, saturation, white balance', global: [
        fx('colorGrade', { u_exposure: 0.2, u_contrast: 1.15, u_saturation: 1.35, u_temperature: 0.4, u_tint: 0.05 })] },
    { name: 'Tonemap (ACES)', hint: 'filmic curve maps HDR into display range', global: [
        fx('tonemap', { u_exposure: 0.6 })] },
    { name: 'FXAA', hint: 'edge-directed antialiasing', global: [
        fx('fxaa', { u_intensity: 1 })] },
    { name: 'Local Volume', hint: 'a warm bloom pocket sweeps across the camera', global: [], local: true },
];

export const SHOWCASE_COUNT = SHOWCASES.length;

// Deep-copy an effect list so a live volume never shares the SHOWCASES constant.
export function cloneEffects(list: EffectList): EffectList {
    return list.map((e) => ({ ...e, uniforms: { ...e.uniforms } }));
}

// The local-volume demo: a sphere volume with a warm grade + bloom, ping-ponging
// across the fixed camera so its effect fades in near the centre and out at the
// edges — the camera-relative blend that volumeSystem resolves each frame.
export function spawnLocalVolume(cmds: CommandsInstance): void {
    cmds.spawn()
        .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
        .insert(PostProcessVolume, {
            isGlobal: false, shape: 'sphere', size: { x: 220, y: 220 },
            priority: 1, weight: 1, blendDistance: 150,
            effects: [
                fx('colorGrade', { u_exposure: 0.3, u_contrast: 1.1, u_saturation: 1.5, u_temperature: 0.55, u_tint: 0.1 }),
                fx('bloom', { u_threshold: 0.25, u_intensity: 1.5, u_radius: 5 }),
            ],
        })
        .insert(Sweep, { range: 360, speed: 0.6, t: 0 })
        .insert(ShowcaseOwned, {});
}
