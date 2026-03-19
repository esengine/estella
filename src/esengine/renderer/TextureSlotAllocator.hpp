#pragma once

#include "../core/Types.hpp"
#include "GfxDevice.hpp"

#include <array>

namespace esengine {

template<u32 MaxSlots>
class TextureSlotAllocator {
public:
    void init(u32 whiteTextureId) {
        white_texture_id_ = whiteTextureId;
        reset();
    }

    void reset() {
        for (u32 i = 0; i < MaxSlots; ++i) {
            slots_[i] = white_texture_id_;
        }
        slot_count_ = 1;
    }

    f32 findOrAllocate(u32 textureId) {
        if (textureId == 0) {
            return 0.0f;
        }
        for (u32 i = 0; i < slot_count_; ++i) {
            if (slots_[i] == textureId) {
                return static_cast<f32>(i);
            }
        }
        if (slot_count_ >= MaxSlots) {
            return -1.0f;
        }
        slots_[slot_count_] = textureId;
        return static_cast<f32>(slot_count_++);
    }

    bool isFull() const {
        return slot_count_ >= MaxSlots;
    }

    void bindAll(GfxDevice& device) const {
        for (u32 i = 0; i < slot_count_; ++i) {
            device.bindTexture(i, slots_[i]);
        }
    }

    u32 slotCount() const { return slot_count_; }

private:
    std::array<u32, MaxSlots> slots_{};
    u32 slot_count_ = 1;
    u32 white_texture_id_ = 0;
};

}  // namespace esengine
