// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { addPlugin, Camera, defineSystem, getDeviceIdentity, Input, Mut, Playthrough, Quality, Query, Res, Text, Time, Transform } from 'esengine';
import { QualityStatus, QualitySubject } from './components';

addPlugin({
    name: 'device-quality-demo',
    build(app) {
        let angle = 0;
        const facts = { backend: '', mode: '', level: '', renderScale: 1, reason: '' };
        app.insertResource(Playthrough, { facts });
        app.addSystem(defineSystem([
            Res(Input), Res(Time), Res(Quality), Query(Mut(Text), QualityStatus),
            Query(Mut(Transform), QualitySubject), Query(Mut(Transform), Camera),
        ], (input, time, quality, labels, subjects, cameras) => {
            if (!quality) return;
            for (const [key, mode] of [['Digit1', 'low'], ['Digit2', 'medium'],
                ['Digit3', 'high'], ['KeyA', 'auto'], ['Digit0', 'off']] as const) {
                if (input.isKeyPressed(key)) quality.setMode(mode);
            }
            angle += time.delta * 0.35;
            for (const [, transform] of subjects) transform.rotation = {
                x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2),
            };
            for (const [, transform] of cameras) {
                const p = transform.position;
                p.x = Math.max(-2, Math.min(4, p.x + time.delta * 1.5 *
                    (Number(input.isKeyDown('ArrowRight')) - Number(input.isKeyDown('ArrowLeft')))));
                p.z = Math.max(3, Math.min(7, p.z + time.delta * 1.5 *
                    (Number(input.isKeyDown('ArrowDown')) - Number(input.isKeyDown('ArrowUp')))));
            }
            const report = quality.report();
            Object.assign(facts, { mode: report.mode, level: report.level,
                renderScale: report.renderScale, reason: report.reason,
                backend: getDeviceIdentity(app.wasmModule)?.backend ?? 'unknown' });
            const profile = quality.profile;
            for (const [, label] of labels) label.content = `${report.mode}: ${report.level} | `
                + `${Math.round(report.renderScale * 100)}% | ${report.targetFps} fps target | `
                + `MSAA requested ${quality.enabled ? profile.msaaSamples : 'original'} | ${report.reason}`;
        }, { name: 'DeviceQualityDemo' }));
    },
});
