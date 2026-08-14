// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Ads, AdsAPI, createMockAdProvider,
    type AdProvider, type MockAdProviderOptions,
} from './ads';
export { createTakeover, type Takeover, type TakeoverHost } from './takeover';
export {
    Achievements, AchievementsAPI, createLocalAchievements, type AchievementProvider,
} from './achievements';
export { Identity, IdentityAPI, type LoginResult } from './identity';
export { ServicesPlugin, servicesPlugin } from './servicesPlugin';
