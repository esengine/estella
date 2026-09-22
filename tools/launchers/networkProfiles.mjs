// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  networkProfiles.mjs — the links a start screen is judged on.
 *
 * A first screen is a question about a NETWORK, and a machine with a fast one
 * cannot ask it — the whole boot lands inside the splash's own fade. So a run
 * declares a link, and the numbers are somebody else's published recommendation.
 */

/**
 * Link conditions, in the units Chrome's `Network.emulateNetworkConditions`
 * takes (bytes/second, milliseconds). `note` is quoted verbatim with its source,
 * so the reader checks the arithmetic below against the recommendation.
 */
export const NETWORK_PROFILES = {
    'slow-4g': {
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
        note: 'Lighthouse: "This is the standard recommendation for mobile throttling"'
            + ' — "Latency: 150ms", "Throughput: 1.6Mbps down / 750 Kbps up.". The preset is'
            + ' "currently called \'Slow 4G\' but used to be labeled as \'Fast 3G\'".'
            + ' https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md',
    },
};

/** The profile named, or a throw listing the ones there are. */
export function networkProfile(name) {
    const profile = NETWORK_PROFILES[name];
    if (!profile) {
        throw new Error(`unknown network profile "${name}" — have: ${Object.keys(NETWORK_PROFILES).join(', ')}`);
    }
    return profile;
}
