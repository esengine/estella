/**
 * @file    SpineResourceManager.cpp
 * @brief   Spine skeleton data resource management
 */

// =============================================================================
// Includes
// =============================================================================

#include "SpineResourceManager.hpp"
#include "SpineExtension.hpp"
#include "../core/Log.hpp"
#include "../platform/FileSystem.hpp"
#include "../renderer/Texture.hpp"

#include <spine/SkeletonBinary.h>
#include <spine/SkeletonJson.h>
#include <spine/AtlasAttachmentLoader.h>

namespace esengine::spine {

// =============================================================================
// ESEngineTextureLoader Implementation
// =============================================================================

ESEngineTextureLoader::ESEngineTextureLoader(resource::ResourceManager& resourceManager)
    : resource_manager_(resourceManager) {
}

void ESEngineTextureLoader::load(::spine::AtlasPage& page, const ::spine::String& path) {
    std::string pathStr(path.buffer(), path.length());

    ES_LOG_INFO("SpineTextureLoader: trying to load texture: {}", pathStr);

    auto handle = resource_manager_.loadTexture(pathStr);
    if (!handle.isValid()) {
        ES_LOG_ERROR("Failed to load Spine texture: {}", pathStr);
        return;
    }

    ES_LOG_INFO("SpineTextureLoader: loaded texture handle: {}", handle.id());

    auto* texture = resource_manager_.getTexture(handle);
    if (texture) {
        page.width = static_cast<int>(texture->getWidth());
        page.height = static_cast<int>(texture->getHeight());
        void* key = reinterpret_cast<void*>(static_cast<uintptr_t>(handle.id() + 1));
        page.texture = key;
        texture_handles_[key] = handle;
    }
}

void ESEngineTextureLoader::unload(void* texture) {
    auto it = texture_handles_.find(texture);
    if (it != texture_handles_.end()) {
        resource_manager_.releaseTexture(it->second);
        texture_handles_.erase(it);
    }
}

// =============================================================================
// SpineResourceManager Implementation
// =============================================================================

SpineResourceManager::SpineResourceManager(resource::ResourceManager& resourceManager)
    : resource_manager_(resourceManager) {
}

SpineResourceManager::~SpineResourceManager() {
    if (initialized_) {
        shutdown();
    }
}

void SpineResourceManager::init() {
    if (initialized_) return;

    initSpineExtension();
    texture_loader_ = makeUnique<ESEngineTextureLoader>(resource_manager_);
    initialized_ = true;

    ES_LOG_INFO("SpineResourceManager initialized");
}

void SpineResourceManager::shutdown() {
    if (!initialized_) return;

    cache_.clear();
    pool_.clear();
    texture_loader_.reset();
    initialized_ = false;

    ES_LOG_INFO("SpineResourceManager shutdown");
}

resource::SpineDataHandle SpineResourceManager::load(const std::string& skeletonPath,
                                                      const std::string& atlasPath,
                                                      f32 scale) {
    if (!initialized_) {
        ES_LOG_ERROR("SpineResourceManager not initialized");
        return resource::SpineDataHandle();
    }

    auto cacheIt = cache_.find(skeletonPath);
    if (cacheIt != cache_.end()) {
        return cacheIt->second;
    }

    auto atlas = makeUnique<::spine::Atlas>(atlasPath.c_str(), texture_loader_.get());
    if (atlas->getPages().size() == 0) {
        ES_LOG_ERROR("Failed to load Spine atlas: {}", atlasPath);
        return resource::SpineDataHandle();
    }

    bool isBinary = skeletonPath.ends_with(".skel");
    resource::SpineDataHandle handle;

    if (isBinary) {
        handle = loadBinary(skeletonPath, atlas.get(), scale);
    } else {
        handle = loadJson(skeletonPath, atlas.get(), scale);
    }

    if (handle.isValid()) {
        auto* data = pool_.get(handle);
        if (data) {
            data->atlas = std::move(atlas);
        }
        cache_[skeletonPath] = handle;
        ES_LOG_INFO("Loaded Spine skeleton: {}", skeletonPath);
    }

    return handle;
}

resource::SpineDataHandle SpineResourceManager::loadBinary(const std::string& skeletonPath,
                                                            ::spine::Atlas* atlas, f32 scale) {
    ::spine::AtlasAttachmentLoader attachmentLoader(atlas);
    ::spine::SkeletonBinary binary(&attachmentLoader);
    binary.setScale(scale);

    auto* skeletonData = binary.readSkeletonDataFile(skeletonPath.c_str());
    if (!skeletonData) {
        ES_LOG_ERROR("Failed to load Spine skeleton binary: {} - {}",
                     skeletonPath, binary.getError().buffer());
        return resource::SpineDataHandle();
    }

    auto data = makeUnique<SpineSkeletonData>();
    data->skeletonData.reset(skeletonData);
    data->stateData = makeUnique<::spine::AnimationStateData>(skeletonData);
    data->stateData->setDefaultMix(0.2f);

    return pool_.add(std::move(data));
}

resource::SpineDataHandle SpineResourceManager::loadJson(const std::string& skeletonPath,
                                                          ::spine::Atlas* atlas, f32 scale) {
    ::spine::AtlasAttachmentLoader attachmentLoader(atlas);
    ::spine::SkeletonJson json(&attachmentLoader);
    json.setScale(scale);

    auto* skeletonData = json.readSkeletonDataFile(skeletonPath.c_str());
    if (!skeletonData) {
        ES_LOG_ERROR("Failed to load Spine skeleton JSON: {} - {}",
                     skeletonPath, json.getError().buffer());
        return resource::SpineDataHandle();
    }

    auto data = makeUnique<SpineSkeletonData>();
    data->skeletonData.reset(skeletonData);
    data->stateData = makeUnique<::spine::AnimationStateData>(skeletonData);
    data->stateData->setDefaultMix(0.2f);

    return pool_.add(std::move(data));
}

SpineSkeletonData* SpineResourceManager::get(resource::SpineDataHandle handle) {
    return pool_.get(handle);
}

const SpineSkeletonData* SpineResourceManager::get(resource::SpineDataHandle handle) const {
    return pool_.get(handle);
}

void SpineResourceManager::release(resource::SpineDataHandle handle) {
    if (!handle.isValid()) return;

    for (auto it = cache_.begin(); it != cache_.end(); ++it) {
        if (it->second == handle) {
            cache_.erase(it);
            break;
        }
    }
    pool_.release(handle.id());
}

resource::SpineDataHandle SpineResourceManager::getByPath(const std::string& skeletonPath) const {
    auto it = cache_.find(skeletonPath);
    return it != cache_.end() ? it->second : resource::SpineDataHandle();
}

usize SpineResourceManager::getLoadedCount() const {
    return pool_.size();
}

}  // namespace esengine::spine
