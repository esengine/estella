// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach } from 'vitest';

afterEach(() => nextTurn());
