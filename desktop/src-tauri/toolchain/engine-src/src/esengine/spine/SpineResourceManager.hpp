/**
 * @file    SpineResourceManager.hpp
 * @brief   Spine skeleton data resource management
 * @details Provides caching and lifecycle management for Spine resources.
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

#include "../core/Types.hpp"
#include "../resource/Handle.hpp"
#include "../resource/ResourcePool.hpp"
#include "../resource/ResourceManager.hpp"

#include <spine/spine.h>

#include <string>
#include <unordered_map>

namespace esengine::spine {

// =============================================================================
// Forward Declarations
// =============================================================================

struct SpineSkeletonData;

// =============================================================================
// ESEngineTextureLoader
// =============================================================================

/**
 * @brief Texture loader for Spine atlases
 *
 * @details Loads textures through ESEngine's ResourceManager and associates
 *          them with Spine atlas pages.
 */
class ESEngineTextureLoader : public ::spine::TextureLoader {
public:
    explicit ESEngineTextureLoader(resource::ResourceManager& resourceManager);
    ~ESEngineTextureLoader() override = default;

    void load(::spine::AtlasPage& page, const ::spine::String& path) override;
    void unload(void* texture) override;

private:
    resource::ResourceManager& resource_manager_;
    std::unordered_map<void*, resource::TextureHandle> texture_handles_;
};

// =============================================================================
// SpineSkeletonData
// =============================================================================

/**
 * @brief Container for loaded Spine skeleton resources
 *
 * @details Holds all data needed to create Skeleton and AnimationState
 *          instances. Resources are reference-counted by SpineResourceManager.
 */
struct SpineSkeletonData {
    Unique<::spine::Atlas> atlas;
    Unique<::spine::SkeletonData> skeletonData;
    Unique<::spine::AnimationStateData> stateData;

    SpineSkeletonData() = default;
    ~SpineSkeletonData() = default;

    SpineSkeletonData(const SpineSkeletonData&) = delete;
    SpineSkeletonData& operator=(const SpineSkeletonData&) = delete;
    SpineSkeletonData(SpineSkeletonData&&) = default;
    SpineSkeletonData& operator=(SpineSkeletonData&&) = default;
};

// =============================================================================
// SpineResourceManager
// =============================================================================

/**
 * @brief Manages Spine skeleton resources with caching
 *
 * @details Provides loading, caching, and lifecycle management for Spine
 *          skeleton data. Resources are cached by path for deduplication.
 *
 * @code
 * SpineResourceManager spineMgr(resourceManager);
 * spineMgr.init();
 *
 * auto handle = spineMgr.load("skeleton.skel", "skeleton.atlas");
 * auto* data = spineMgr.get(handle);
 *
 * // Create skeleton instance
 * auto skeleton = makeUnique<spine::Skeleton>(data->skeletonData.get());
 * auto state = makeUnique<spine::AnimationState>(data->stateData.get());
 *
 * spineMgr.release(handle);
 * spineMgr.shutdown();
 * @endcode
 */
class SpineResourceManager {
public:
    explicit SpineResourceManager(resource::ResourceManager& resourceManager);
    ~SpineResourceManager();

    SpineResourceManager(const SpineResourceManager&) = delete;
    SpineResourceManager& operator=(const SpineResourceManager&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    void init();
    void shutdown();
    bool isInitialized() const { return initialized_; }

    // =========================================================================
    // Resource Loading
    // =========================================================================

    /**
     * @brief Loads Spine skeleton data from files
     * @param skeletonPath Path to .skel (binary) or .json skeleton file
     * @param atlasPath Path to .atlas file
     * @param scale Optional skeleton scale (default 1.0)
     * @return Handle to the loaded data, or invalid handle on failure
     */
    resource::SpineDataHandle load(const std::string& skeletonPath,
                                    const std::string& atlasPath,
                                    f32 scale = 1.0f);

    /**
     * @brief Gets skeleton data by handle
     * @param handle The data handle
     * @return Pointer to the data, or nullptr if invalid
     */
    SpineSkeletonData* get(resource::SpineDataHandle handle);

    /**
     * @brief Gets skeleton data by handle (const)
     * @param handle The data handle
     * @return Const pointer to the data, or nullptr if invalid
     */
    const SpineSkeletonData* get(resource::SpineDataHandle handle) const;

    /**
     * @brief Releases skeleton data
     * @param handle The data handle
     */
    void release(resource::SpineDataHandle handle);

    /**
     * @brief Gets handle by skeleton path (if cached)
     * @param skeletonPath Path used to load the skeleton
     * @return Handle if cached, invalid handle otherwise
     */
    resource::SpineDataHandle getByPath(const std::string& skeletonPath) const;

    // =========================================================================
    // Statistics
    // =========================================================================

    usize getLoadedCount() const;

private:
    resource::ResourceManager& resource_manager_;
    Unique<ESEngineTextureLoader> texture_loader_;
    resource::ResourcePool<SpineSkeletonData> pool_;
    std::unordered_map<std::string, resource::SpineDataHandle> cache_;
    bool initialized_ = false;

    resource::SpineDataHandle loadBinary(const std::string& skeletonPath,
                                          ::spine::Atlas* atlas, f32 scale);
    resource::SpineDataHandle loadJson(const std::string& skeletonPath,
                                        ::spine::Atlas* atlas, f32 scale);
};

}  // namespace esengine::spine
