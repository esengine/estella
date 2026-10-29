# 青岚 · 仙侠女性角色

成年剑修，172 cm 人体基准，月白、青玉与淡金配色。当前文件均为过程资产，脸部造型尚未通过美术验收。

用户已否决 `face-study-v3` 的脸部效果。该版本保留用于定位变形问题和回退，不应作为后续细节制作的造型基础；见 [脸部审查记录](face-study-v3/review/art-review.json)。网格与导出检查通过不能代表人物造型合格。

最新脸部比例候选位于 [face-study-v7](face-study-v7/README.md)。本轮回到约 3,700 面的控制网格，调整口裂高度、下颌、眼裂和耳位，并提供设计稿叠加、估计视角对照与真实控制网格图。五官气质、脸颊过渡和嘴唇接合仍需修改；本版尚未美术验收，也未通过严格的新增交叉检查。

[face-study-v6](face-study-v6/README.md) 保留此前通过 Blender MCP 调用原生 Grab 与 Smooth 的高分辨率笔刷试改及同机位前后对照。

[face-study-v5](face-study-v5/README.md) 保留 Blender 官方 CC0 女性基网格来源、原作者的多级雕刻数据，以及 Scenario Blender、雕刻与拓扑技能的接入记录。

此前的人体版本保留了参数化人体来源、手臂姿态、眉毛及睫毛试作。相关文件用于过程记录；V7 是独立脸部候选，下方完整角色与导出说明对应此前版本。

## 文件

| 文件 | 用途 |
| --- | --- |
| `face-study-v7/qinglan-identity-cage.blend` | 最新控制网格比例候选、参考叠加及多视角检查；待继续修改 |
| `face-study-v6/qinglan-live-face.blend` | 实时雕刻试改、3 个原生笔刷修订形态键及前后对照；尚未美术验收 |
| `face-study-v5/qinglan-face-candidate.blend` | V5 脸部来源、11 个分区形态键及灰模/拓扑检查；尚未美术验收 |
| `qinglan-human-study.blend` | 完整人体与独立头部检查场景；灰色区域是检查材质，不是服装网格 |
| `qinglan-highpoly.blend` | 带完整衣饰、头发、佩剑的高模，保留多级细分、曲线和来源集合 |
| `export/qinglan-static.glb` | 12 个语义部件的静态检查模型，包含贴图 |
| `review/head/` | 无遮挡头部三视图、灰模及完整人体正侧面 |
| `review/` | 角色多视角、线框、部件检查与导出验证结果 |
| `textures/` | 皮肤、虹膜、丝织物与发丝的烘焙贴图 |
| `references/` | 整体设计、修订后的脸部三视图与设计约束 |
| `provenance.json` | 人体基础、技能仓库和美术参考来源 |

`SOURCE_*` 集合保留参数化人体和刺绣纹样。它们不参与成品渲染或 GLB 导出。衣物下的皮肤使用可关闭的 Mask 修改器；完整人体在独立 study 文件中可见。

## 验证范围

所有本地检查使用 Blender 后台 CLI，不启动可见应用。具体面数、尺寸、文件体积与检查结论以 `review/asset-report.json`、`mesh-qa.json`、`export-report.json`、`roundtrip-report.json` 和 `gltf-validation.json` 为准。

当前高模为 6,540,088 三角面；静态 GLB 为 1,339,088 三角面、12 个部件、15 个材质、6 张贴图，文件约 50.6 MiB。GLB 在空场景重新导入成功，Khronos Validator 为 0 错误、0 警告。

`render` 网格检查通过，但保留 11 项提示：微小装饰的近重合顶点、层叠表面的隐藏背靠背面，以及单独检查两只手时产生的离地提示。这些不是已完成运行时优化的证据。线框图直接显示完整人体的基网格边，眼口环线可以在 `topology-face-*.png` 中检查。

脸部风格参考《天涯明月刀》和《逆水寒》，并使用独立的工作设定三视图。未使用或分发游戏角色网格、游戏贴图、玩家捏脸数据。当前造型仍是原创近似塑形，不能把参考图当作已经完成精确匹配的证据。

此资产尚未完成生产级重拓扑、LOD 预算、共享骨骼、蒙皮、表情、动作穿插检查以及 Estella / 真机验收。静态 GLB 的较高面数用于检查造型，不代表已达到运行时角色预算。Blender 的次表面散射、各向异性和程序化材质参数与通用 glTF 查看器可能有显示差异。

## 重建

环境：Blender 5.2.1 LTS、已安装的 MPFB 2.0.17、`EL4CTEO/blender-skills` 提交 `71d031dab8bc6729504d11a78cbe91945401045f`，以及可由 Blender Python 3.13 导入的 Shapely 2.2.0。人体基础和 MPFB 核心目标为 CC0；MPFB 程序本身的 GPL 许可与这些美术资产分开。

`blender-skills` 实际用于雕刻层级、材质烘焙、网格检查、检查图和 GLB 导出。脚本保留来源与检查结果，参数对应工作设定。

```powershell
python -m pip install --target D:\tmp\qinglan-blender-python --python-version 3.13 --only-binary=:all: shapely==2.2.0
./scripts/build.ps1 -BlenderSkillsRoot D:\tmp\estella-blender-skills-20261028 -GeometryLibraries D:\tmp\qinglan-blender-python
```

构建中间文件位于仓库忽略的 `output/qinglan/`。离线打开 `.blend` 不需要运行构建脚本；贴图已打包，旁边同时保留外部 PNG。

Khronos glTF Validator 独立检查：

```powershell
$env:GLTF_VALIDATOR_MODULE = 'D:\tmp\qinglan-gltf-check\node_modules\gltf-validator'
node ./scripts/validate-gltf.cjs
```

## 参考

- [《天涯明月刀》女性捏脸展示](https://shouyou.3dmgame.com/gl/173761.html)
- [《逆水寒》实机 PV 角色展示](https://www.4gamers.com.tw/news/detail/64387/ni-shui-han-3a)
- [MPFB / MakeHuman 核心资产许可](https://static.makehumancommunity.org/about/license.html)
- [blender-skills](https://github.com/EL4CTEO/blender-skills)
