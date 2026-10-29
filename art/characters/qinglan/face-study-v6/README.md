# 青岚 · V6 实时雕刻候选

本版在用户已打开的 Blender 5.2.1 LTS 中，通过 Blender MCP 实际调用原生 `bpy.ops.sculpt.brush_stroke`，使用 Grab 与 Smooth 修整眼睑、鼻底和鼻唇过渡。没有使用 computer use。依然是脸部候选，未通过仙侠角色的造型验收。

## 编辑来源

打开 `qinglan-live-face.blend`，编辑 `Qinglan_Live_Sculpt`。其 Basis 来自 V5 的实际 Multires 表面，保留 243,328 个四边面和三个独立的局部雕刻形态键。形态键可分别关闭；将全部新键设为零可恢复 V5 头部表面。

`Qinglan_Head_Multires` 是隐藏保留的 V5 控制网格来源，其 11 个旧形态键和原作者 Multires 数据仍在。新雕刻尚未回传到该低分辨率控制网格，也未完成表情拓扑或蒙皮。

眼球、虹膜及瞳孔另外保留来源与调整形态键，用于眼睑贴合。这些调整是网格数据修改，未计作雕刻笔刷成果。相机、照明和中性材质保持一致；前后比较图同时包含雕刻与眼部几何调整。

## 检查记录

- `review/before-after.png`：相同相机、灯光和材质下的修改前后正面、侧面、三分之四对照。
- `review/after-low.png`：低角度鼻底与眼睑检查。
- `review/native-brush-log.json`：每笔的工具、世界坐标、尺寸、强度、实际移动点数和最大位移；回退的试笔有明确标记。
- `review/eye-fit.json`：眼球与虹膜几何调整。
- `review/post-sculpt-protection.json`：雕刻后恢复口内连接处顶点的保护范围；这一部分原生笔刷位移没有全部保留。
- `review/verification.json`：重开文件后的形态键求值、表面审查及局部交叉检查。

本机实时调用需要显式更新 `RegionView3D.update()`，并显式设置 Sculpt 的统一笔刷尺寸。仅填写笔画元素的 `size` 会被当前统一设置覆盖。这两项修正在 `scripts/live_sculpt.py` 中保留。

原生操作返回 `FINISHED` 只证明执行成功。渲染检查、局部几何检查也不能替代美术验收。当前仍需继续修正脸型、眼神与鼻唇的精致程度；未完成游戏导出、表情、骨骼、Estella 或设备验收。

交叉检查先取 BVH 候选，再在毫米尺度、局部原点附近计算线段与三角面的交点，避免高密度小三角面落入固定浮点容差。检查范围是脸部局部网格，原始来源的口内交叉仍保留；相切、共面重叠以及其余高密度表面不在该专项结论内。

## 重现检查

`scripts/live_sculpt.py` 供已连接的 Blender 会话导入调用，不能在后台重放原生笔刷。原生笔画已保存在形态键与日志中。

`scripts/review_saved.py` 可用 Blender 后台 CLI 检查与渲染保存的副本，不会打开可见窗口；附加 `-- --audit-only` 仅做几何检查。`scripts/compose_review.py` 使用 Matplotlib 排列原始渲染图，不对脸部图像做修补。

来源与授权沿用 [V5 资产记录](../face-study-v5/provenance.json)：Blender 官方 Human Base Meshes v1.4.1 中 Dan Ulrich 的 CC0 女性基网格。技能版本为 Scenario `d44410f058991f677ccf733a8e86ce95110857eb`。
