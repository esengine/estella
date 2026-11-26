// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Particle, ParticleAPI } from './ParticleAPI';
export { ParticlePlugin, particlePlugin } from './ParticlePlugin';
export { EffectLifetime, type EffectLifetimeData } from './effectLifetime';
export { bakeGradient, GRADIENT_LUT_SIZE, type Gradient, type GradientStop } from './gradient';
export { bakeCurve, type Curve, type Keyframe } from './curve';
export { ParticleCollisionEvent, type ParticleCollisionEventPayload, type ParticleCollisionStats, type ParticleCollisionBudget } from './collision';
