// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    payment.ts
 * @brief   In-game purchase as an engine service — including where it is not
 *          allowed to happen.
 *
 * Buying inside a mini-game is a PERMISSION, not a feature: on WeChat it is
 * Android-only, and the same call on an iPhone is refused by the platform. The
 * API exists there; the purchase does not. So `available` answers for the
 * DEVICE, not for the API, and a shop asks it before it opens rather than
 * finding out when someone taps Buy.
 *
 * What this service deliberately does NOT do:
 *
 *   It does not interpret the host's error codes. They differ between vendors
 *   and a mapping invented here is a guess a game would then branch on — so the
 *   code is carried through, named, for the game to read against its host's own
 *   table.
 *
 *   It does not grant anything. A purchase the CLIENT believes in is a purchase
 *   an attacker can claim; the host notifies the game's own server, and that is
 *   what may hand out currency. This resolving means "the host says the
 *   purchase completed", which is the cue to go ASK your server, not to add
 *   coins.
 *
 *   It has no local stand-in for play mode, for the same reason sign-in has
 *   none: a rehearsed purchase that charges nothing and grants nothing rehearses
 *   only the dialog, and the part that goes wrong is the part behind it.
 */
import {
    defineResource, platformCanPay, platformRequestPayment,
    type PlatformPaymentRequest,
} from 'esengine';

export type PaymentRequest = PlatformPaymentRequest;

/** A purchase that did not complete. `code` is the HOST's — see the file
 *  header for why it is not translated. */
export interface PaymentFailure extends Error {
    code?: number;
}

export class PaymentAPI {
    /**
     * Whether this device may buy at all.
     *
     * False on iOS even though the host exposes the call, false off-platform,
     * false on a vendor with no purchase API. A shop reads this to stay closed
     * rather than to open and fail.
     */
    get available(): boolean {
        return platformCanPay();
    }

    /**
     * Buy `quantity` units of the host's in-game currency.
     *
     * Resolves when the HOST says the purchase completed — which is the moment
     * to ask your own server what the player now owns, not the moment to grant
     * it. Rejects with the host's own message and code, including when the
     * player simply changed their mind: those are different UI, and only the
     * host can tell them apart.
     */
    request(request: PaymentRequest): Promise<void> {
        return platformRequestPayment(request);
    }
}

export const Payment = defineResource<PaymentAPI>(null!, 'Payment');
