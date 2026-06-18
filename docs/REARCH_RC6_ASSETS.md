# Estella RC6：资产管线根治方案（Asset Pipeline Re-architecture）

> 目标读者：引擎维护者 / AI 协作代理。
> 本文是 `REARCHITECTURE.md` 的**续篇**，体例一致：描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`。
> 与 RC1–RC5 的区别：RC1–RC5 根治的是**正确性根因**（多源真相、可绕过抽象）；RC6 根治的是**能力与平台错配**——资产管线是按"桌面整包载入"假设建的，与微信小游戏"主/分包体积上限 + 远程 CDN + 受限显存 + 单核解码"的现实不匹配。

> 注：`REARCHITECTURE.md` 的"实现进度"段已滞后——RC5（渲染唯一路径 / GfxDevice 唯一入口 / u16→u32）实际已落地（见 `338caff2` single GL boundary + CI guard、PR #44–#47）。RC6 在 RC5 的 `GfxDevice` 唯一入口之上扩展，**纯加法**，不回退既有路径。

---

## 0. 核心诊断：管线为"桌面整包"而建，与移动端三大约束错配

对资产路径的深度审计后，几乎所有"包体过大 / 显存吃紧 / 加载慢 / 无法热更"的症状都可归到**四个结构性缺口**，每个对应一处"为桌面假设、未为微信/移动端建立"的能力：

1. **纹理永远是未压缩 RGBA8**：上传路径硬编码 `gl.RGBA/UNSIGNED_BYTE`，`GfxDevice` 根本没有压缩纹理入口。一张 2048² 图集常驻 **16MB 显存**，移动端 GPU 内存上限分分钟打爆。
2. **身份不是内容寻址**：path / UUID / GUID 三套并存，但**没有内容哈希**——无法去重、无法做不可变 CDN 缓存、改一个文件不会自动产生新缓存键。
3. **资源只进不出**：引用计数存在，但**无预算、无 LRU、无驱逐**。长时运行的游戏显存单调增长。
4. **打包是静态意图，无运行时分包/流式**：有 `AddressableManifest` 和 `wechatPackInclude` 标志，但**没有运行时按需下载/卸载**——进不去微信主包体积，也下载不下来远程资源。

**根治原则**：把"显存上限"靠 **GPU 压缩纹理**打住；把"缓存与去重"靠**内容寻址**坐实；把"内存只增"靠**预算 + LRU**收口；把"包体积上限"靠**运行时分包/流式 + CDN**绕开。四者共享同一条新管线，互为前提。

止血式"删几张图、改改尺寸"不在本方案范围——只要管线还假设"未压缩、整包、永驻"，同类问题会无限再生。

---

## 缺口 1（keystone）：纹理无 GPU 压缩 → 压缩纹理成为默认上传格式

### 病灶
- `GfxPixelFormat` 只有 `RGB8 / RGBA8 / DepthComponent24 / Depth24Stencil8`（`renderer/GfxEnums.hpp:76-81`）——**无任何压缩格式**。
- `GfxDevice` 只有 `texImage2D`（`renderer/GfxDevice.hpp:262`），**没有 `compressedTexImage2D`**。grep 全仓 `KTX/Basis/ASTC/ETC2/S3TC/compressedTexImage2D` 在引擎代码中**零命中**（命中项全是 glm/yoga/生成绑定的噪音）。
- Web 上传路径**硬编码** `gl.texImage2D(..., gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)`（`sdk/src/asset/loaders/TextureLoader.ts:161`），无格式选择。
- 后果：下载是 PNG/JPG（线上有压缩），但**解码后在显存里一律是未压缩 RGBA8**。移动端显存是硬约束，这是当前栈最痛的一处。

### 目标架构
1. **`GfxDevice` 加压缩纹理通道**（纯加法）：新增 `compressedTexImage2D(textureId, w, h, GfxCompressedFormat, data, byteLen)`，以及一个**能力查询** `bool supportsCompressedFormat(GfxCompressedFormat)`（复用现有 `getString/getInt` 诊断入口的模式，`GfxDevice.hpp:325-328`）。
2. **`GfxPixelFormat`/新 `GfxCompressedFormat` 扩**：`ETC2_RGBA8`、`ASTC_4x4`、`S3TC_DXT5` 等。**基线 = ETC2/EAC**（WebGL2 规范核心保证，无需扩展——只要 WebGL2 可用就有；iOS 高性能模式仍需实测，与你们既有 WebGL2 依赖同一风险面），**升级 = ASTC**（查 `WEBGL_compressed_texture_astc`，iOS A8+ / 多数新 Android 可用）。
3. **导入期编码为 KTX2 容器**（UASTC 或 ETC1S supercompression），运行时用 **Basis Universal transcoder** 按设备能力转码到目标 GPU 格式。
4. **`TextureLoader` 压缩优先 + 优雅回退**：能力探测 → 有压缩走 `compressedTexImage2D`，无则回退现有 RGBA8 路径（`TextureLoader.ts:139-204` 保留为 fallback）。**老资产零改动仍能跑。**

> 这一步是 keystone：显存 4–8× 下降是其他三个缺口（预算/驱逐才有意义、分包才装得下、CDN 才划算）的前提。

---

## 缺口 2：身份非内容寻址 → 内容哈希作为物理身份

### 病灶
- 三套身份并存且无哈希：`ResourcePool` 按路径缓存（`pathToId_`，`resource/ResourcePool.hpp:285`）；`ResourceManager` 按 GUID 缓存（`guidToTexture_`，`resource/ResourceManager.cpp:319-332`）；SDK 用 RFC4122 UUID（`@uuid:` 引用，`sdk/src/asset/AssetRegistry.ts:19-77`）。
- **无内容哈希**：同一张图在两个路径下 = 两份 GPU 资源（无去重）；改文件不改 URL（CDN 缓存失效靠手动）。

### 目标架构
- **双身份分层**：`UUID` = 逻辑身份（场景/prefab 里引用，文件改名不破引用，沿用 `AssetRegistry`）；**`contentHash`（xxh3 或 BLAKE3）= 物理身份**，导入期对编码后字节计算，产物按 `<hash>.ktx2` 命名。
- **manifest 串起来**：`AddressableManifest`（`sdk/src/asset/AddressableManifest.ts:24-27`）扩为 `UUID → contentHash → URL`。
- **运行时缓存键统一为 contentHash**：把 `pathToId_` / `guidToTexture_` 收敛到单一 `hash → 资源` 表 → 天然去重；**不可变缓存**（内容变 = 新 hash = 新 URL，CDN 可设永久缓存，无失效问题）。

---

## 缺口 3：资源只进不出 → 显存预算 + LRU 驱逐

### 病灶
- 引用计数存在（`ResourcePool.hpp:88-233`：`refCount`、`addRef`、`release`），但 `refCount==0` **立即释放**，**无 LRU、无预算、无后台驱逐**——资产要么被持有、要么被销毁，没有"缓存层"。整张管线无任何内存上限概念。

### 目标架构
- **三态生命周期**：`持有(refCount>0)` → `可驱逐(refCount==0 但留在 LRU)` → `驱逐`。`release` 到 0 时**不立即销毁**，进 LRU 候选。
- **显存预算**：`ResourceManager` 持有一个字节预算（按设备显存分级设定）；超预算时按 LRU 驱逐最久未用的可驱逐资源。
- **可重载**：因为有 `contentHash → URL` + 既有 `AsyncHandle`（`resource/AsyncHandle.hpp:67-151`），被驱逐的资源再次需要时可异步重载——驱逐是安全的。

---

## 缺口 4：静态打包无运行时分包/流式 → 运行时 bundle 加载器 + 微信分包映射

### 病灶
- 有静态打包**意图**：`AddressableManifest` 的 `groups`/`bundleMode`（`AddressableManifest.ts:18-27`）、按资产类型的 `wechatPackInclude` 标志（`sdk/src/assetTypes.ts:20-40`）。
- 但**无运行时下载/卸载**：没有按 group 拉取分包、没有 CDN 重定向层、没有流式协议、没有动态分包切换（审计结论：AddressableManifest 仅声明，无运行时 loader 消费它）。
- Web 资产经 `HttpBackend` 逐个 fetch（`sdk/src/asset/Backend.ts:14-49`）；字体靠构建期 `--embed-file` 塞进 wasm（`cmake/Emscripten.cmake:38`）——这两条都不是"分包/流式"。

### 目标架构
- **运行时 bundle 加载器**：把 `AddressableManifest` 接成 loader——按 group/bundle **按需下载、缓存、卸载**，与缺口 3 的 LRU 联动。
- **微信分包映射**（见下节专述）：`bundleMode` + `wechatPackInclude` 驱动构建期生成微信 `subpackages` 配置；运行时用 `wx.loadSubpackage` 按需加载；大资产走远程 CDN + 本地文件系统缓存。

---

## 微信小游戏分包映射（平台落地）

| 层级 | 放什么 | 机制 |
|---|---|---|
| **主包** | 引擎 wasm（+ Basis transcoder side module）、启动场景必需资产 | `wechatPackInclude:true` 的 materials/prefabs/tilemaps（`assetTypes.ts:26-40`） |
| **分包** | 按 `AddressableManifest` 的 group 切分的关卡/模块资产 | 构建期生成 `subpackages` 字段；运行时 `wx.loadSubpackage({name})` 按需 |
| **远程资源（CDN）** | 大纹理图集、音频——`wechatPackInclude:false` 的类型 | CDN 下载 + `wx.getFileSystemManager().saveFile` 本地缓存；**内容寻址 `<hash>.ktx2` 命名 → 缓存可设永久**（缺口 2 的直接红利） |

- **体积账**：主包靠"压缩纹理（缺口 1）+ 只装必需资产"压到上限内；其余靠分包 + 远程，正面解决主包/总包体积约束。
- **Basis transcoder 落位**：编成**独立 side module**（你们已有 side module 机制，physics/spine 都是——`CMakeLists.txt:470-589`），按需加载，不撑主包。

---

## 执行顺序（全程保持构建常绿，每批可独立验证）

1. **Batch A — `GfxDevice` 压缩纹理入口 + 能力查询**：`compressedTexImage2D` + `GfxCompressedFormat` + `supportsCompressedFormat`；`GLDevice` 实现 ETC2 core + ASTC/S3TC 扩展探测。**纯加法，无压缩资产时零行为变化。**（header-only + MockGfxDevice 可即时验证。）
2. **Batch B — 导入期 KTX2 编码 + 内容哈希命名 + manifest 扩展**：离线工具链；运行时仍可回退旧 RGBA8 路径。
3. **Batch C — 运行时 Basis transcoder（side module）+ `TextureLoader` 压缩优先/回退**。
4. **Batch D — 内容寻址缓存键**：`pathToId_`/`guidToTexture_` 收敛到 `contentHash`；去重生效。
5. **Batch E — LRU + 显存预算驱逐**：三态生命周期 + 重载。
6. **Batch F — 运行时 bundle/分包加载器 + 微信 `wx.loadSubpackage` / CDN 缓存映射**。

> 依赖序：A 是 keystone（其余都建立在压缩格式之上）；B→C→D 是同一条编码/身份链；E 依赖 D（缓存键统一才能安全驱逐重载）；F 依赖 D+E（按内容寻址下载、按预算卸载）。

---

## 验证机制（与 RC1 keystone 同精神：机制即根治成立的证明）

- **压缩纹理**：离线编码产物字节级往返测试（解码 KTX2 → 与源像素比对，PSNR 阈值守门）；`GfxDevice` 能力探测用 **MockGfxDevice** harness 单测（沿用 RC5 的验证套路）。
- **内容哈希**：幂等性测试（同输入 → 同 hash）；去重测试（两路径同内容 → 一份 GPU 资源、一个缓存条目）。
- **预算/驱逐**：单测模拟超预算 → 驱逐最久未用 → 再次请求触发重载且结果正确；refCount>0 的资源**永不**被驱逐。
- **分包**：`AddressableManifest` → 微信 `subpackages` 配置的快照测试；构建期分包划分与 `wechatPackInclude` 标志一致性断言。
- **回退路径**：无压缩能力的模拟设备走 RGBA8，与 Batch A 之前行为逐像素一致。

---

## 需要拍板的架构岔路

| 岔路 | 选项 A | 选项 B（推荐） |
|---|---|---|
| **KTX2 supercompression** | 全量 UASTC（高质量、体积大） | **按 label 选**：sprite/UI 用 ETC1S（体积优先），法线/高频纹理用 UASTC（质量优先） |
| **Basis transcoder 位置** | 编进主模块（简单，撑主包） | **独立 side module**（按需加载，主包瘦，沿用既有 side module 机制） |
| **内容哈希算法** | BLAKE3（强抗碰撞，略重） | **xxh3**（构建期算，速度快，资产去重/缓存键场景足够） |
| **驱逐策略** | 维持纯 refCount 立即释放 | **refCount + LRU + 预算**三态（refCount==0 才进 LRU 候选） |
| **远程资源缓存** | 每次启动重下 | **`wx.getFileSystemManager` 本地缓存 + 内容寻址永久缓存键** |
