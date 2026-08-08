// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Ads, AdsAPI, createMockAdProvider,
    type AdProvider, type AdsHost, type MockAdProviderOptions,
} from './ads';
export { Share, ShareAPI, type ShareCard } from './share';
export {
    Leaderboard, LeaderboardAPI, createLocalLeaderboard,
    type LeaderboardOptions, type LeaderboardProvider, type LeaderboardScope,
    type LeaderboardStyle, type LocalLeaderboardOptions,
} from './leaderboard';
export {
    Achievements, AchievementsAPI, createLocalAchievements, type AchievementProvider,
} from './achievements';
export { Identity, IdentityAPI, type LoginResult } from './identity';
export { Payment, PaymentAPI, type PaymentRequest, type PaymentFailure } from './payment';
export { ServicesPlugin, servicesPlugin } from './servicesPlugin';
