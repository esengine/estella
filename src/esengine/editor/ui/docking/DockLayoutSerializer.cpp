/**
 * @file    DockLayoutSerializer.cpp
 * @brief   DockLayoutSerializer implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockLayoutSerializer.hpp"
#include "DockArea.hpp"
#include "DockNode.hpp"
#include "DockPanel.hpp"
#include "../../../core/Log.hpp"

#include <sstream>
#include <iomanip>
#include <algorithm>

namespace esengine::ui {

// =============================================================================
// JSON Helper Functions
// =============================================================================

namespace {

std::string escapeJsonString(const std::string& str) {
    std::ostringstream oss;
    for (char c : str) {
        switch (c) {
            case '"': oss << "\\\""; break;
            case '\\': oss << "\\\\"; break;
            case '\n': oss << "\\n"; break;
            case '\r': oss << "\\r"; break;
            case '\t': oss << "\\t"; break;
            default: oss << c; break;
        }
    }
    return oss.str();
}

void skipWhitespace(const std::string& json, usize& pos) {
    while (pos < json.size() && std::isspace(json[pos])) {
        ++pos;
    }
}

bool expectChar(const std::string& json, usize& pos, char c) {
    skipWhitespace(json, pos);
    if (pos < json.size() && json[pos] == c) {
        ++pos;
        return true;
    }
    return false;
}

std::string parseString(const std::string& json, usize& pos) {
    skipWhitespace(json, pos);
    if (pos >= json.size() || json[pos] != '"') return "";
    ++pos;

    std::string result;
    while (pos < json.size() && json[pos] != '"') {
        if (json[pos] == '\\' && pos + 1 < json.size()) {
            ++pos;
            switch (json[pos]) {
                case '"': result += '"'; break;
                case '\\': result += '\\'; break;
                case 'n': result += '\n'; break;
                case 'r': result += '\r'; break;
                case 't': result += '\t'; break;
                default: result += json[pos]; break;
            }
        } else {
            result += json[pos];
        }
        ++pos;
    }
    if (pos < json.size()) ++pos;
    return result;
}

f32 parseNumber(const std::string& json, usize& pos) {
    skipWhitespace(json, pos);
    usize start = pos;
    while (pos < json.size() && (std::isdigit(json[pos]) || json[pos] == '.' ||
                                  json[pos] == '-' || json[pos] == '+' ||
                                  json[pos] == 'e' || json[pos] == 'E')) {
        ++pos;
    }
    return std::stof(json.substr(start, pos - start));
}

i32 parseInt(const std::string& json, usize& pos) {
    skipWhitespace(json, pos);
    usize start = pos;
    if (pos < json.size() && json[pos] == '-') ++pos;
    while (pos < json.size() && std::isdigit(json[pos])) {
        ++pos;
    }
    return std::stoi(json.substr(start, pos - start));
}

}  // namespace

// =============================================================================
// Serialization
// =============================================================================

std::string DockLayoutSerializer::serialize(const DockArea& area) const {
    DockLayoutData data = serializeToData(area);
    return toJson(data);
}

DockLayoutData DockLayoutSerializer::serializeToData(const DockArea& area) const {
    DockLayoutData data;
    data.version = 1;

    DockNode* root = area.getRootNode();
    if (!root) {
        data.rootNodeIndex = -1;
        return data;
    }

    std::vector<i32> nodeIndexMap;
    serializeNode(root, data, nodeIndexMap);
    data.rootNodeIndex = 0;

    return data;
}

void DockLayoutSerializer::serializeNode(const DockNode* node, DockLayoutData& data,
                                          std::vector<i32>& nodeIndexMap) const {
    if (!node) return;

    DockNodeData nodeData;
    nodeData.id = node->getId();
    nodeData.type = node->getType();

    if (node->isSplit()) {
        nodeData.splitDirection = node->getSplitDirection();
        nodeData.splitRatio = node->getSplitRatio();

        i32 currentIndex = static_cast<i32>(data.nodes.size());
        data.nodes.push_back(nodeData);

        if (node->getFirst()) {
            data.nodes[static_cast<usize>(currentIndex)].firstChildIndex =
                static_cast<i32>(data.nodes.size());
            serializeNode(node->getFirst(), data, nodeIndexMap);
        }

        if (node->getSecond()) {
            data.nodes[static_cast<usize>(currentIndex)].secondChildIndex =
                static_cast<i32>(data.nodes.size());
            serializeNode(node->getSecond(), data, nodeIndexMap);
        }
    } else {
        nodeData.activeTabIndex = node->getActiveTabIndex();
        for (const auto& panel : node->getPanels()) {
            if (panel) {
                nodeData.panelIds.push_back(panel->getPanelId());
            }
        }
        data.nodes.push_back(nodeData);
    }
}

// =============================================================================
// Deserialization
// =============================================================================

bool DockLayoutSerializer::deserialize(DockArea& area, const std::string& json,
                                        const PanelFactory& factory) const {
    DockLayoutData data;
    if (!fromJson(json, data)) {
        ES_LOG_ERROR("Failed to parse dock layout JSON");
        return false;
    }
    return deserializeFromData(area, data, factory);
}

bool DockLayoutSerializer::deserializeFromData(DockArea& /*area*/, const DockLayoutData& data,
                                                const PanelFactory& /*factory*/) const {
    if (data.rootNodeIndex < 0 ||
        static_cast<usize>(data.rootNodeIndex) >= data.nodes.size()) {
        return true;
    }

    // TODO: Clear existing layout and rebuild from data
    // This requires access to DockArea internals or additional API
    ES_LOG_WARN("DockLayoutSerializer::deserializeFromData not fully implemented");

    return true;
}

DockNode* DockLayoutSerializer::deserializeNode(DockArea& /*area*/, const DockLayoutData& data,
                                                 i32 nodeIndex,
                                                 const PanelFactory& /*factory*/) const {
    if (nodeIndex < 0 || static_cast<usize>(nodeIndex) >= data.nodes.size()) {
        return nullptr;
    }

    // TODO: Create nodes using DockArea API
    // This requires additional DockArea methods for direct node creation
    (void)data.nodes[static_cast<usize>(nodeIndex)];

    return nullptr;
}

// =============================================================================
// JSON Conversion
// =============================================================================

std::string DockLayoutSerializer::toJson(const DockLayoutData& data) const {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(4);

    oss << "{\n";
    oss << "  \"version\": " << data.version << ",\n";
    oss << "  \"layoutName\": \"" << escapeJsonString(data.layoutName) << "\",\n";
    oss << "  \"rootNodeIndex\": " << data.rootNodeIndex << ",\n";
    oss << "  \"nextNodeId\": " << data.nextNodeId << ",\n";
    oss << "  \"nodes\": [\n";

    for (usize i = 0; i < data.nodes.size(); ++i) {
        const DockNodeData& node = data.nodes[i];
        oss << "    {\n";
        oss << "      \"id\": " << node.id << ",\n";
        oss << "      \"type\": " << static_cast<i32>(node.type) << ",\n";
        oss << "      \"splitDirection\": " << static_cast<i32>(node.splitDirection) << ",\n";
        oss << "      \"splitRatio\": " << node.splitRatio << ",\n";
        oss << "      \"activeTabIndex\": " << node.activeTabIndex << ",\n";
        oss << "      \"firstChildIndex\": " << node.firstChildIndex << ",\n";
        oss << "      \"secondChildIndex\": " << node.secondChildIndex << ",\n";
        oss << "      \"panelIds\": [";

        for (usize j = 0; j < node.panelIds.size(); ++j) {
            oss << node.panelIds[j];
            if (j + 1 < node.panelIds.size()) oss << ", ";
        }

        oss << "]\n";
        oss << "    }";
        if (i + 1 < data.nodes.size()) oss << ",";
        oss << "\n";
    }

    oss << "  ]\n";
    oss << "}\n";

    return oss.str();
}

bool DockLayoutSerializer::fromJson(const std::string& json, DockLayoutData& outData) const {
    usize pos = 0;

    if (!expectChar(json, pos, '{')) return false;

    while (pos < json.size()) {
        skipWhitespace(json, pos);
        if (json[pos] == '}') break;

        std::string key = parseString(json, pos);
        if (!expectChar(json, pos, ':')) return false;

        if (key == "version") {
            outData.version = static_cast<u32>(parseInt(json, pos));
        } else if (key == "layoutName") {
            outData.layoutName = parseString(json, pos);
        } else if (key == "rootNodeIndex") {
            outData.rootNodeIndex = parseInt(json, pos);
        } else if (key == "nextNodeId") {
            outData.nextNodeId = static_cast<DockNodeId>(parseInt(json, pos));
        } else if (key == "nodes") {
            if (!expectChar(json, pos, '[')) return false;

            while (pos < json.size()) {
                skipWhitespace(json, pos);
                if (json[pos] == ']') {
                    ++pos;
                    break;
                }

                DockNodeData node;
                if (!expectChar(json, pos, '{')) return false;

                while (pos < json.size()) {
                    skipWhitespace(json, pos);
                    if (json[pos] == '}') {
                        ++pos;
                        break;
                    }

                    std::string nodeKey = parseString(json, pos);
                    if (!expectChar(json, pos, ':')) return false;

                    if (nodeKey == "id") {
                        node.id = static_cast<DockNodeId>(parseInt(json, pos));
                    } else if (nodeKey == "type") {
                        node.type = static_cast<DockNodeType>(parseInt(json, pos));
                    } else if (nodeKey == "splitDirection") {
                        node.splitDirection = static_cast<DockSplitDirection>(parseInt(json, pos));
                    } else if (nodeKey == "splitRatio") {
                        node.splitRatio = parseNumber(json, pos);
                    } else if (nodeKey == "activeTabIndex") {
                        node.activeTabIndex = parseInt(json, pos);
                    } else if (nodeKey == "firstChildIndex") {
                        node.firstChildIndex = parseInt(json, pos);
                    } else if (nodeKey == "secondChildIndex") {
                        node.secondChildIndex = parseInt(json, pos);
                    } else if (nodeKey == "panelIds") {
                        if (!expectChar(json, pos, '[')) return false;
                        while (pos < json.size()) {
                            skipWhitespace(json, pos);
                            if (json[pos] == ']') {
                                ++pos;
                                break;
                            }
                            node.panelIds.push_back(
                                static_cast<DockPanelId>(parseInt(json, pos)));
                            expectChar(json, pos, ',');
                        }
                    }

                    expectChar(json, pos, ',');
                }

                outData.nodes.push_back(node);
                expectChar(json, pos, ',');
            }
        }

        expectChar(json, pos, ',');
    }

    return true;
}

}  // namespace esengine::ui
