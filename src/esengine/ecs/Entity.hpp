// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Entity.hpp
 * @brief   Entity utilities for the ECS system
 * @details The core Entity type is defined in Types.hpp as a packed struct
 *          with a 22-bit index and 10-bit generation. The packing math is
 *          shared with resource handles via core/PackedId.hpp — there is a
 *          single id representation (Entity::raw), no separate 64-bit handle.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"
