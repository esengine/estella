// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  components.ts — 3D physics as a project DECLARES it: the world's settings and the arithmetic over
 *        them. No solver.
 *
 * Not a build entry. It is the AUTHORITY on where the line falls — check-core-carries-options reads this
 * list to tell a declaration from a solver.
 */
export * from './worldConfig';
