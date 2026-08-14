// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — the share sheet and the purchase, as a plugin.
 *
 * Two resources and nothing per frame: both services are façades over host
 * capabilities, so what they cost is what the host charges when you call them.
 */
import type { App, Plugin } from 'esengine';
import { Share, ShareAPI } from './share';
import { Payment, PaymentAPI } from './payment';

export { Share, ShareAPI, type ShareCard } from './share';
export { Payment, PaymentAPI, type PaymentRequest, type PaymentFailure } from './payment';

export class MiniGameServicesPlugin implements Plugin {
  name = 'MiniGameServices';

  build(app: App): void {
    app.insertResource(Share, new ShareAPI());
    app.insertResource(Payment, new PaymentAPI());
  }
}

export const miniGameServicesPlugin = new MiniGameServicesPlugin();
