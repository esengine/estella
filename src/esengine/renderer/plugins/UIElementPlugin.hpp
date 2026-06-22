#pragma once

#include "BatchPlugin.hpp"
#include "../../resource/TextureMetadata.hpp"

namespace esengine {

class UIElementPlugin : public BatchPlugin {
public:
    void collect(RenderCollectContext& ctx) override;

private:
    // UI draws above world content: its sort layer is offset past the world layer range.
    static constexpr i32 UI_BASE_LAYER = 1000;
};

}  // namespace esengine
