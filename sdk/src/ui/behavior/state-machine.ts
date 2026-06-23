// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineBuiltin } from '../../component';

export interface StateMachineData {
    current: string;
    previous: string;
}

export const StateMachine = defineBuiltin<StateMachineData>('StateMachine', {
    current: '',
    previous: '',
});
