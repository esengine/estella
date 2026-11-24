// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Scene-manager doubles allocate through their existing spawn spy. */
export function spawnImmediate(this: { spawn(): number }, _name: undefined, record: (entity: number) => void): number {
    const entity = this.spawn();
    record(entity);
    return entity;
}
