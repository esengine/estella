import { addPlugin, defineSystem, GetWorld, Res, Input, Time, Transform, Sprite, Playthrough, UIEvents, Audio, AudioSource, Text, preloadGlyphs,
    Quality, registerDrawCallback, unregisterDrawCallback, getPlatform, type Entity, type GlyphPreload } from 'esengine';
import { Trial, STEP, LIMITS, type Controls } from './game';
import { drawEffects } from './effects';
import { makeUI } from './ui';

const cleanup = new WeakMap<object, () => void>();

addPlugin({
    name: 'starfall',
    build(app) {
        const trial = new Trial();
        const facts = { ready: false, frame: 0, phase: 'lobby', x: 0, y: 0, health: 100, kills: 0, score: 0, remaining: 60,
            attacks: 0, dashes: 0, novas: 0, hits: 0, enemies: 0, bolts: 0, particles: 0, particleCap: 160,
            sound: true, reduced: false, fps: 0, simulationSteps: 0 };
        app.insertResource(Playthrough, { facts });
        let ui: ReturnType<typeof makeUI> | null = null, hero: Entity, camera: Entity;
        let accumulator = 0, uiClock = 0, lastPhase = '', reduced = false, effectsReduced = false, muted = false;
        let attackSerial = 0, dashSerial = 0, novaSerial = 0, fpsTime = 0, fpsFrames = 0;
        const sentinels: Entity[] = [];
        const glyphJobs: GlyphPreload[] = [];
        const input: Controls = { move: 0, attack: false, dash: false, nova: false, jump: false };
        let lastDash = false, lastNova = false, lastJump = false;
        const clips: Record<string, string> = {};
        registerDrawCallback('starfall-effects', () => { if (facts.ready) drawEffects(trial, effectsReduced, input.move); });
        const platform = getPlatform();
        const offHide = platform.onAppHide?.(() => { trial.pause(); accumulator = 0; lastDash = lastNova = lastJump = false; });
        app.addSystem(defineSystem([GetWorld(), Res(Time), Res(Input), Res(UIEvents), Res(Audio)], (world, time, keys, events, audio) => {
            if (!ui) {
                const canvas = world.findEntityByName('Canvas');
                const h = world.findEntityByName('Hero'); const cam = world.findEntityByName('Camera');
                if (canvas === null || h === null || cam === null) return;
                hero = h; camera = cam;
                for (let i = 0; i < LIMITS.enemies; i++) {
                    const sentinel = world.findEntityByName('Sentinel-' + i);
                    if (sentinel !== null) sentinels.push(sentinel);
                }
                for (const name of ['slash', 'dash', 'nova', 'gate']) {
                    const e = world.findEntityByName('Audio-' + name);
                    if (e !== null) clips[name] = world.get(e, AudioSource).clip;
                }
                audio.setMaxVoices(8);
                void audio.preloadAll(Object.values(clips));
                const enter = () => { trial.enter(); audio.playSFX(clips.gate, { volume: .45 }); };
                ui = makeUI(world, events, canvas, {
                    enter, lobby: () => { trial.lobby(); keys.clearVirtual(); }, pause: () => trial.pause(),
                    resume: () => { if (trial.phase === 'paused') trial.resume(); else enter(); },
                    sound: () => { muted = !muted; audio.setMasterVolume(muted ? 0 : .7); ui!.buttonText('Sound', muted ? '声音：关闭' : '声音：开启'); },
                    quality: () => { reduced = !reduced; ui!.buttonText('Quality', reduced ? '节能模式' : '性能优先');
                        if (app.hasResource(Quality)) app.getResource(Quality)?.setMode(reduced ? 'low' : 'auto'); },
                });
                const future: Record<string, string> = {
                    Timer: '0123456789', Score: '星辉 0123456789', Objective: '净化星骸 0123456789 /',
                    Combo: '0123456789 连斩', NovaTime: '0123456789.s 就绪', Perf: '0123456789 FPS / 节能自适应',
                    Wave: '净化星骸 · 守住星门精英星骸已降临', ResultTitle: '星门已净化群星为你停留星光尚未熄灭',
                    ResultDetail: '星辉 击破 0123456789 / 试炼已暂停准备好，再向星渊出发。属于你的星辰，就在前方。再次出发，用闪避和星爆突破包围。',
                    ContinueLabel: '继续试炼再次挑战', SoundLabel: '声音：开启关闭', QualityLabel: '性能优先节能模式',
                };
                // Warm future screens in small slices while the lobby/portal is visible.
                for (const [name, entity] of Object.entries(ui.nodes)) if (world.has(entity, Text))
                    glyphJobs.push(preloadGlyphs(app, entity, future[name] ?? world.get(entity, Text).content, { budgetMs: .4 }));
                audio.setMasterVolume(.7); facts.ready = true;
            }
            effectsReduced = reduced || (app.hasResource(Quality) && (app.getResource(Quality)?.profile.particleLimit ?? 160) < 160);
            const cap = effectsReduced ? 80 : 160;
            if (trial.particleLimit !== cap) { trial.particleLimit = cap; for (let i = cap; i < trial.sparks.length; i++) trial.sparks[i].life = 0; }
            if (keys.isKeyPressed('Enter')) { if (trial.phase === 'lobby' || trial.phase === 'won' || trial.phase === 'lost') { trial.enter(); audio.playSFX(clips.gate, { volume: .45 }); } }
            if (keys.isKeyPressed('Escape')) { if (trial.phase === 'playing') trial.pause(); else if (trial.phase === 'paused') trial.resume(); }
            input.move = Math.max(-1, Math.min(1, keys.getVirtual('move').x + (keys.isKeyDown('KeyD') || keys.isKeyDown('ArrowRight') ? 1 : 0) - (keys.isKeyDown('KeyA') || keys.isKeyDown('ArrowLeft') ? 1 : 0)));
            input.attack = keys.isKeyDown('KeyJ') || keys.isKeyPressed('KeyJ') || keys.getVirtual('attack').x > 0;
            const d = keys.isKeyDown('KeyK') || keys.isKeyPressed('KeyK') || keys.isKeyDown('ShiftLeft') || keys.isKeyPressed('ShiftLeft') || keys.getVirtual('dash').x > 0;
            const n = keys.isKeyDown('KeyE') || keys.isKeyPressed('KeyE') || keys.getVirtual('nova').x > 0;
            const j = keys.isKeyDown('Space') || keys.isKeyPressed('Space') || keys.isKeyDown('KeyW') || keys.isKeyPressed('KeyW') || keys.getVirtual('jump').x > 0;
            // Keep press edges pending until a fixed tick consumes them (120 Hz hosts included).
            input.dash ||= d && !lastDash; input.nova ||= n && !lastNova; input.jump ||= j && !lastJump;
            lastDash = d; lastNova = n; lastJump = j;
            const dt = Math.min(Math.max(time.delta, 0), .05);
            accumulator = Math.min(accumulator + dt, STEP * 3);
            let steps = 0;
            while (accumulator + 1e-8 >= STEP && steps < 3) {
                trial.update(input); accumulator -= STEP; steps++;
                input.dash = input.nova = input.jump = false;
            }
            if (trial.attackSerial !== attackSerial) { attackSerial = trial.attackSerial; audio.playSFX(clips.slash, { volume: .28 }); }
            if (trial.dashSerial !== dashSerial) { dashSerial = trial.dashSerial; audio.playSFX(clips.dash, { volume: .27 }); }
            if (trial.novaSerial !== novaSerial) { novaSerial = trial.novaSerial; audio.playSFX(clips.nova, { volume: .45 }); }

            const inLobby = trial.phase === 'lobby';
            const entering = trial.phase === 'entering';
            const u = entering ? Math.min(1, trial.phaseTime / 1.35) : inLobby ? 0 : 1;
            const ease = u * u * (3 - 2 * u);
            const scale = 1 - ease * .6;
            const heroTransform = world.get(hero, Transform);
            const bob = trial.phase === 'paused' ? 0 : Math.sin(trial.time * (trial.moving && !inLobby ? 16 : 2.1)) * (trial.moving && !inLobby ? 3 : 1.4);
            heroTransform.position.x = 46 * (1 - ease) + trial.x * ease;
            heroTransform.position.y = 64 * (1 - ease) + (trial.y + 69 + bob) * ease;
            heroTransform.scale.x = scale * (u < .7 ? 1 : trial.facing) * (trial.dash > 0 ? 1.12 : 1);
            heroTransform.scale.y = scale * (trial.dash > 0 ? .92 : 1);
            world.insert(hero, Transform, heroTransform);
            for (let i = 0; i < sentinels.length; i++) {
                const e = trial.enemies[i], entity = sentinels[i], visual = world.get(entity, Sprite);
                const a = e.active ? 1 : 0, green = e.hit > 0 ? .6 : 1;
                if (visual.color.a !== a || visual.color.g !== green) world.insert(entity, Sprite, { ...visual, color: { r: 1, g: green, b: e.hit > 0 ? .4 : 1, a } });
                if (e.active) {
                    const transform = world.get(entity, Transform); transform.position.x = e.x; transform.position.y = e.y;
                    transform.scale.x = transform.scale.y = e.maxHp >= 6 ? 1.22 : 1; world.insert(entity, Transform, transform);
                }
            }
            const sprite = world.get(hero, Sprite);
            const alpha = trial.immune > 0 && trial.dash <= 0 && trial.nova <= 0 ? .65 + Math.sin(trial.time * 30) * .3 : 1;
            if (Math.abs(sprite.color.a - alpha) > .01) world.insert(hero, Sprite, { ...sprite, color: { r: 1, g: 1, b: 1, a: alpha } });
            const cam = world.get(camera, Transform);
            cam.position.x = trial.shake > 0 && !effectsReduced ? Math.sin(trial.time * 67) * trial.shake * 14 : 0;
            cam.position.y = trial.shake > 0 && !effectsReduced ? Math.cos(trial.time * 53) * trial.shake * 8 : 0;
            world.insert(camera, Transform, cam);
            if (lastPhase !== trial.phase) {
                lastPhase = trial.phase;
                ui.show('Lobby', inLobby || entering); ui.show('HUD', !inLobby && !entering);
                const modal = trial.phase === 'paused' || trial.phase === 'won' || trial.phase === 'lost';
                ui.show('Modal', modal); ui.show('Common', !modal && !entering);
                ui.opacity('Lobby', 1);
                if (modal) {
                    ui.text('ResultTitle', trial.phase === 'paused' ? '群星为你停留' : trial.phase === 'won' ? '星门已净化' : '星光尚未熄灭');
                    ui.text('ResultDetail', trial.phase === 'paused' ? '试炼已暂停\n准备好，再向星渊出发。' : `星辉  ${trial.score}     /     击破  ${trial.kills}\n${trial.phase === 'won' ? '属于你的星辰，就在前方。' : '再次出发，用闪避和星爆突破包围。'}`);
                    ui.buttonText('Continue', trial.phase === 'paused' ? '继续试炼' : '再次挑战');
                }
                if (trial.phase !== 'playing') { input.dash = input.nova = input.jump = false; keys.cancelVirtualSources(); }
            }
            if (entering) ui.opacity('Lobby', Math.max(0, 1 - u * 2.5));
            ui.opacity('Transition', entering ? Math.max(0, 1 - Math.abs(u - .68) / .15) * .8 : 0);
            fpsTime += time.delta; fpsFrames++;
            if (fpsTime >= 1) { facts.fps = Math.round(fpsFrames / fpsTime); fpsTime = fpsFrames = 0; ui.text('Perf', `${facts.fps} FPS   /   ${effectsReduced ? '节能' : '自适应'}`); }
            uiClock += dt;
            if (uiClock >= .2) {
                uiClock = 0;
                ui.text('Timer', String(Math.ceil(trial.remaining)).padStart(2, '0'));
                ui.text('Objective', `净化星骸  ${trial.kills} / ${LIMITS.kills}`); ui.text('Score', `星辉  ${trial.score}`);
                ui.text('Combo', trial.combo >= 2 ? `${trial.combo} 连斩` : '');
                ui.text('NovaTime', trial.novaCooldown > 0 ? trial.novaCooldown.toFixed(1) + 's' : '就绪');
                ui.text('Wave', trial.phaseTime < 3 ? '净化星骸 · 守住星门' : trial.spawned >= 15 && trial.phaseTime % 9 < 2 ? '精英星骸已降临' : '');
                ui.health(trial.health);
            }
            Object.assign(facts, { frame: facts.frame + 1, phase: trial.phase, x: trial.x, y: trial.y, health: trial.health, kills: trial.kills,
                score: trial.score, remaining: trial.remaining, attacks: trial.attackSerial, dashes: trial.dashSerial, novas: trial.novaSerial,
                hits: trial.hitSerial, enemies: trial.enemies.reduce((n, e) => n + Number(e.active), 0), bolts: trial.bolts.reduce((n, b) => n + Number(b.active), 0),
                particles: trial.sparks.reduce((n, p) => n + Number(p.life > 0), 0), particleCap: trial.particleLimit, sound: !muted, reduced, simulationSteps: steps });
        }, { name: 'StarfallTrial' }));
        cleanup.set(app, () => { unregisterDrawCallback('starfall-effects'); offHide?.(); for (const job of glyphJobs) job.release(); });
    },
    cleanup(app) { if (app) { cleanup.get(app)?.(); cleanup.delete(app); } },
});
