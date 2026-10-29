# 青岚脸部候选 · V5

当前阶段是脸部比例与结构评审，尚未通过仙侠角色的造型验收。主文件为 `qinglan-face-candidate.blend`；正面、侧面、三分之四及低角度检查位于 `review/`。

## 本版方法

以 Blender 官方 Human Base Meshes v1.4.1 中 Dan Ulrich 制作的女性写实基网格为来源，保留其 Multires 雕刻细节。该资产集合的许可证元数据与随包 README 均为 CC0。没有使用游戏提取网格。

实际调用的三个技能为 `scenario-blender-expert`、`scenario-blender-sculpting`、`scenario-blender-retopology`，固定版本 `d44410f058991f677ccf733a8e86ce95110857eb`。流程为：成熟人头来源 → 带保护遮罩的局部网格修改 → 可撤销形态键 → 固定视角灰模 → 实际控制网格及渲染网格检查。没有使用全头插值拟合、自动生成角色服务或 computer use。

`Qinglan_Head_Multires` 是可编辑来源，保留 11 个分区形态键。`Basis_Studio_Female` 为原始女性基础形状。为保留原作者的 Multires 网格数据，身体控制网格仍在此对象内，头部以下由 Mask 隐藏；局部修改对保护区域的位移为零。最后的几何节点仅整理开放的颈部连接边界，不改变来源控制点。

`Inspection_Cage` 和 `Inspection_High` 集合默认隐藏，是检查时的几何快照，不会随着来源形态键自动更新。修改形态键后需重新运行 `scripts/verify_review.py` 更新检查快照。直接编辑应使用 `Qinglan_Head_Multires`。

## 检查与限制

- `review/face-review.png`：中性材质三视图。
- `review/reference-comparison.png`：参考与实际几何的正面对照；参考并非标定摄影，不能当作精确重建误差图。
- `review/topology/review_sheet.png`：实际控制边线。
- `review/clay/review_sheet.png`：没有虹膜材质影响的剪影与灰模。
- `review/edit-report.json`：每次局部改动的范围、最大位移和保护区域。
- `review/verification.json`：重新打开文件后的形态键、拓扑和头部渲染检查。

头部渲染检查的通过仅覆盖网格交付项目，不表示角色已美术验收，也不表示已完成面部表情、闭眼、口腔变形、眼部材质、游戏运行时导出或 Estella 验收。高密度自交检查与低模口腔相接部位需要单独复核，详见检查文件；本版不能作为可发布游戏角色。

控制网格的交叉面逐对与原始基网格对比：原始 57 对，本版 55 对，新增 0 对。剩余相接不是清理完成的证据。高密度网格的自交检查因密度限制未执行；其检查报告中的 `null` 表示未检查。开放颈部边界仅作为头部连接处，尚未制作最终胸像切面。

目前与参考的差距仍包括眼睑气质、鼻唇细腻程度和整体身份特征。该版本的目的在于提供可靠且可回退的脸部来源，不推进衣饰、毛孔或其他表面细节来掩盖这些差距。

## 重建

环境为 Blender 5.2.1 LTS、上述三项已安装技能和用于检查图排版的 Matplotlib。全流程后台运行，不打开可见应用。打开交付的 `.blend` 不需要下载来源文件或安装插件；参考图已打包。

重新从来源构建时，下载 [官方 Human Base Meshes v1.4.1](https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip)，解压后运行：

```powershell
./scripts/build.ps1 -SourceBundle 'D:\path\human_base_meshes_bundle.blend'
```

来源许可说明见 [Blender 官方资源页](https://www.blender.org/download/demo-files/)，技能见 [Scenario Blender skills](https://github.com/scenario-labs/skills/tree/main/skills/dcc/blender)。真实笔刷精修需要已连接的 Blender MCP 会话；当前后台流程完成的是可编辑的脸部结构候选。
