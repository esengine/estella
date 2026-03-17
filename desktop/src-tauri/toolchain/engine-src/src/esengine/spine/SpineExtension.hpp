/**
 * @file    SpineExtension.hpp
 * @brief   ESEngine implementation of Spine's extension interface
 * @details Bridges Spine's file/memory operations with ESEngine's FileSystem.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include <spine/Extension.h>

namespace esengine::spine {

// =============================================================================
// ESEngineSpineExtension Class
// =============================================================================

/**
 * @brief ESEngine implementation of Spine's extension interface
 *
 * @details Provides file reading through ESEngine's FileSystem and
 *          uses standard memory allocation. This extension is automatically
 *          set when SpineResourceManager is initialized.
 */
class ESEngineSpineExtension : public ::spine::DefaultSpineExtension {
public:
    ESEngineSpineExtension() = default;
    ~ESEngineSpineExtension() override = default;

protected:
    /**
     * @brief Reads a file using ESEngine's FileSystem
     * @param path File path to read
     * @param length Output parameter for file length
     * @return Allocated buffer containing file data (caller must free)
     */
    char* _readFile(const ::spine::String& path, int* length) override;
};

/**
 * @brief Initializes the ESEngine Spine extension
 * @details Must be called before loading any Spine assets.
 *          Called automatically by SpineResourceManager::init().
 */
void initSpineExtension();

}  // namespace esengine::spine
