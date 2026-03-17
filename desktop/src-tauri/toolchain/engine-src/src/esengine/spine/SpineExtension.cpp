/**
 * @file    SpineExtension.cpp
 * @brief   ESEngine implementation of Spine's extension interface
 */

// =============================================================================
// Includes
// =============================================================================

#include "SpineExtension.hpp"
#include "../platform/FileSystem.hpp"
#include "../core/Log.hpp"

#include <spine/SpineString.h>

#include <cstring>

namespace esengine::spine {

// =============================================================================
// ESEngineSpineExtension Implementation
// =============================================================================

char* ESEngineSpineExtension::_readFile(const ::spine::String& path, int* length) {
    std::string pathStr(path.buffer(), path.length());

    auto data = FileSystem::readBinaryFile(pathStr);
    if (data.empty()) {
        ES_LOG_ERROR("Failed to read Spine file: {}", pathStr);
        *length = 0;
        return nullptr;
    }

    *length = static_cast<int>(data.size());
    char* buffer = ::spine::SpineExtension::alloc<char>(data.size() + 1, __FILE__, __LINE__);
    std::memcpy(buffer, data.data(), data.size());
    buffer[data.size()] = '\0';

    return buffer;
}

// =============================================================================
// Extension Initialization
// =============================================================================

void initSpineExtension() {
    static ESEngineSpineExtension s_extension;
    ::spine::SpineExtension::setInstance(&s_extension);
}

}  // namespace esengine::spine

// =============================================================================
// Spine Default Extension Provider
// =============================================================================

namespace spine {

SpineExtension* getDefaultExtension() {
    static esengine::spine::ESEngineSpineExtension s_defaultExtension;
    return &s_defaultExtension;
}

}  // namespace spine
