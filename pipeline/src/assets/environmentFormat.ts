// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an `.esenv` document names beside it, apart from the importer that
 *        writes one: a package reads this and nothing else of the import.
 */

/** The document's fields that name an image beside it — everything a package
 *  has to move with it and re-point. */
export const ENV_IMAGE_FIELDS = ['specular', 'sky'] as const;
