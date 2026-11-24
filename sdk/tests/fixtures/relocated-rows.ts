// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, Transform } from '../../src/ecs/component';
import { defineEvent, EventReader } from '../../src/ecs/event';
import { Mut, Query } from '../../src/ecs/query';
import { defineResource, Res } from '../../src/ecs/resource';
import { defineSystem } from '../../src/ecs/system';

export const Travel = defineComponent('RelocationTravel', { units: 0 });
export const Step = defineResource({ delta: 1 }, 'RelocationStep');
export const Pulse = defineEvent<{ distance: number }>('RelocationPulse', { distance: 0 });

/** @compiled */
export const move = defineSystem([Query(Mut(Transform), Travel), Res(Step)], (query, step) => {
    for (const [, transform, travel] of query) {
        transform.position.x = transform.position.x + travel.units * step.delta;
    }
}, { name: 'RelocationMove' });

/** @compiled */
export const eventMove = defineSystem([Query(Mut(Transform), Travel), EventReader(Pulse)], (query, pulses) => {
    for (const pulse of pulses) {
        for (const [, transform, travel] of query) {
            transform.position.x = transform.position.x + travel.units * pulse.distance;
        }
    }
}, { name: 'RelocationEventMove' });
