# 青岚 · V7 控制网格比例候选

本轮从 V5 的原始四边面控制网格调整脸部大比例。口裂上移约 8.5 mm，缩窄嘴部，调整下颌与下巴，延展眼裂，联动眼球和虹膜，并加入眉形占位、耳位与鼻尖调整。保留的效果见 `review/reference-overlay.png` 和 `review/reference-multiview.png`。

**状态：待修改、未通过脸部身份验收。** 五官位置有改善，但脸颊过渡、眼睑厚度与鼻唇体积仍未达到设计稿。眉毛是网格占位，不是最终毛发；没有用皮肤贴图或头发遮挡差异。

## 打开和编辑

打开 `qinglan-identity-cage.blend`，编辑 `Qinglan_Identity_Cage`。显示出的头颈控制网格有 3,771 个顶点、3,744 个面，其中 99.47% 是四边面；完整来源的 10,582 个控制顶点仍保留，以维持原作者的 Multires 数据。修改集中在脸部，身体由后置 Mask 隐藏。二级细分检查表面有 60,688 个四边面。

原有 11 个形态键保留。新增键以 `V7_` 开头，7 个启用，另 4 个试改因视觉问题被静音且权重归零。`review/accepted-key-values.json` 是最终启用状态；过程编辑 JSON 中的最大位移描述试改本身，不能替代最终权重。

将所有 `V7_` 键置零，可恢复 V5 的头部造型；眼球、虹膜和眉形需要另外关闭或恢复。V5、V6 原文件没有覆盖。V7 没有承接 V6 的高分辨率原生笔刷修订。

脚本修改形态键前，把 Multires 的视口级别设为 0，更新后再恢复为 1。此会话在较高级别更新控制数据时出现 Blender 5.2.1 细分属性插值崩溃，已从阶段备份恢复；最终文件已多次在后台重新打开。初期编辑通过用户已打开的 Blender MCP 完成，连接中断后使用后台 Blender 继续。全程未使用 computer use，也未自动打开新的可见窗口。

## 对照与检查

- `review/reference-overlay.png`：设计稿、V6、V7 和叠加；按瞳距及眼线对齐。
- `review/reference-multiview.png`：设计稿与估计视角下的正面、侧面、三分之四。参考不是标定照片；90 mm 镜头、约 72° / 25° 方向是检查用估计。
- `review/after-*.png`：固定正交正侧面、透视三分之四及低角度原始渲染。
- `review/cage-*.png`：真实控制网格边，不是高密度表面三角线。
- `review/verification.json`：保存后重新求值的控制网格、二级表面及局部交叉检查。

头部的 `render` 结构检查没有发现零面积面、翻转面或非流形内部边；这不能证明没有自交。控制网格的局部交叉对为来源 52、当前 52，新增对 0。二级表面的局部交叉对为来源 412、当前 412，其中 **24 对不同于来源**，位于嘴唇接合处。因此严格的“没有新增交叉对”检查仍失败，本版不能作为已清理完毕的生产网格。

检查先取 BVH 候选，再在毫米尺度计算线段与三角面的交叉。范围为脸部局部；相切、共面重合及全身不在该结论内。原来源的内部接触、开口颈边、表情、骨骼、UV、游戏预算和 Estella 验收仍未完成。

## 工具与过程

实际使用 `scenario-blender-expert`、`scenario-blender-sculpting`、`scenario-blender-retopology` 及 `estella-character-production` 的控制网格、分阶段回退、固定视角审查和网格检查流程。本轮是参考约束下的网格数据编辑，没有新增原生雕刻笔画，也没有激活付费工具。

`scripts/identity_cage.py` 提供局部编辑；其余编辑脚本保存试改与回退过程。不要不加选择地重放全部试改。`finalize_candidate.py` 明确关闭失败的脸颊填充和强制张嘴调整；最终文件和键权重记录为准。

`render_review.py`、`render_cage.py` 可通过 `blender --background --factory-startup --python-exit-code 1 --python ...` 重做检查图。`audit_saved.py` 默认严格检查并因上述 24 对交叉退出失败；附加 `-- --report-only` 仅生成如实记录失败状态的报告，不代表检查通过。`compose_review.py` 用 Matplotlib 排列原始图片，没有对脸部图像进行修补。

来源沿用 [V5 的授权记录](../face-study-v5/provenance.json)：Blender 官方 Human Base Meshes v1.4.1，Dan Ulrich 的 CC0 女性基网格。
