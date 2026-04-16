#pragma once

#include "../core/Types.hpp"
#include <unordered_map>
#include <vector>
#include <cstring>

namespace esengine {

struct MaterialUniformData {
    char name[32];
    u32 type;
    f32 values[4];
};

struct CachedMaterialData {
    u32 shaderId = 0;
    u32 blendMode = 0;
    std::vector<MaterialUniformData> uniforms;
};

class MaterialCache {
public:
    void clear() { cache_.clear(); }

    void invalidate(u32 materialId) { cache_.erase(materialId); }

    const CachedMaterialData* find(u32 materialId) const {
        auto it = cache_.find(materialId);
        return it != cache_.end() ? &it->second : nullptr;
    }

    void store(u32 materialId, CachedMaterialData data) {
        cache_[materialId] = std::move(data);
    }

private:
    std::unordered_map<u32, CachedMaterialData> cache_;
};

}  // namespace esengine
