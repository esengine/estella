// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { uiPlugin } from './ui/ui-plugin';
import type { Plugin } from './app';

// REARCH_GUI F6: the ten hand-ordered UI concept plugins are now composed into
// one declarative `uiPlugin`. The concept plugins remain individually exported
// (from their modules) for granular wiring.
export const uiPlugins: Plugin[] = [uiPlugin];
