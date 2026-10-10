# Estella 发布流程

发布的是同一版本的引擎、SDK、编辑器和原生运行时模板。版本规则见
[VERSIONING.md](VERSIONING.md)，验收项目以 [tools/releaseGate.mjs](tools/releaseGate.mjs)
为准。本次候选的进度见 [v0.77.0 发布记录](docs/releases/0.77.0.md)。

## 1. 冻结范围和准备提交

- 从最新 `origin/master` 建立独立发布分支，保留正在开发的工作区。
- 优先纳入已完成的 2D 制作、UI、输入、Tilemap 和交付修复。逐一确认 PR 的合并状态，未合并功能不算已发布能力。
- 同步根目录和 `desktop/package.json` 的版本、CHANGELOG 版本段与比较链接、SECURITY 支持版本，以及 `tools/releaseNotes.mjs` 的提交归类。
- 编辑器是独立的私有仓库。先提交并推送编辑器，再提交引擎的 `desktop` gitlink；CI 必须能从远端取到该提交。
- 合并编辑器与引擎发布变更后，冻结最终引擎 SHA 和编辑器 SHA。合并、补修或改版本产生新 SHA 后，重新取得对应验证证据。

从干净的最终发布检出运行以下只读检查。以下命令使用 PowerShell：

```powershell
git fetch origin --tags
git -C desktop fetch origin
git status --short
git -C desktop status --short
git rev-parse HEAD
git rev-parse origin/master
git ls-tree HEAD desktop
git -C desktop rev-parse HEAD
node tools/check-release-metadata.mjs
node tools/check-changelog-covers.mjs
node tools/check-release-gate.mjs
node tools/run-release-gate.mjs --plan
```

两个工作区必须干净；引擎 HEAD 必须是已冻结的 `origin/master`，编辑器 HEAD 必须等于引擎记录的 gitlink。`--plan` 和 `check-release-gate` 检查验收项目能否执行，不代表项目已经通过。

## 2. 在后台验证最终提交

本地构建、类型检查和单元测试后台执行。完整编辑器 MCP 也可隐藏运行：

```powershell
pnpm install --frozen-lockfile
pnpm --filter ./sdk build
pnpm --dir desktop run build
Push-Location desktop
node scripts/editor-checks/run.mjs camera-preview gizmo-menu icon-pick
Pop-Location
```

Authoring runner 默认隐藏窗口。直接使用 MCP 时传 `--editor --hidden`；
`ESTELLA_MCP_EDITOR_VISIBLE=1` 仅用于需要窗口的验收。隐藏的完整编辑器与默认的简化 headless fixture host 是两种运行方式：项目打开、Play 和导出检查使用完整编辑器。

OS 焦点、Tab 输入、首次绘制等窗口相关检查在 CI 的虚拟桌面上运行。
本地不运行会弹出窗口的首屏测量或设备验收。设备相关验收使用其指定主机，模拟器结果与真机结果分别记录。

在最终 SHA 仍为 master 的情况下触发三条流水线：

```powershell
gh workflow run build.yml --repo esengine/estella --ref master
gh workflow run nightly.yml --repo esengine/estella --ref master
gh workflow run release-desktop.yml --repo esengine/estella --ref master
gh run list --repo esengine/estella --branch master --limit 15 --json databaseId,workflowName,headSha,status,conclusion,url
```

逐个确认 `headSha` 等于冻结 SHA，再保存 Run ID、链接、各 job 结果和失败日志。
查看 Build、Nightly 的验收输出，包括 `UNANSWERED`、跳过、取消和人工项目。
某条工作流显示绿色，不能代替完整验收记录。

手动触发 `Release Desktop App` 是 **dry run**：构建 Windows/macOS 安装包和五个平台的原生模板，不创建或发布 GitHub Release。它不运行 tag 发布中的 `smoke-templates`；需要候选分支上的原生启动检查时，另行运行：

```powershell
gh workflow run native-smoke.yml --repo esengine/estella --ref master -f template-source=head
```

记录该运行的 SHA，以及它构建的模板与待发布版本。原生 smoke 当前只提供报告，不会自动阻止正式发布，发布负责人仍须审阅真实启动失败。

## 3. 验收候选安装包

dry run 的产物保留三天，及时下载。用上一节保存的候选构建 Run ID：

```powershell
$candidateRun = Read-Host '候选构建 Run ID'
gh run view $candidateRun --repo esengine/estella --json headSha,status,conclusion,url,jobs
gh run download $candidateRun --repo esengine/estella --name installer-windows-latest --dir out/release-candidate/windows
gh run download $candidateRun --repo esengine/estella --name installer-macos-latest --dir out/release-candidate/macos
gh run download $candidateRun --repo esengine/estella --pattern 'native-template-*' --dir out/release-candidate/templates
```

记录安装包文件名、SHA-256、版本和候选 SHA，使用下载的包验证：

- Windows/macOS 安装、启动和版本显示；从上一正式版本升级，重新打开保存的项目。
- 新建 2D 项目；打开旧项目；编辑、保存、关闭并重新打开；Play/Stop 后场景数据保持正确。
- UI 输入、焦点、文本溢出与本地化预览；Tilemap 拼接、Stamp 和替换；Gizmo 与相机预览。
- 导出并启动 Web 游戏，以及此次发布支持的小游戏和原生目标。验证实际包的资源加载、输入、声音与渲染，而不只检查导出命令的退出码。
- 检查模板归档结构与嵌入 SDK 的内容一致性；审阅 native smoke 的启动结果。
- 完成 releaseGate 声明的人工项目：官网主图来源、安装版诊断导出、稳定性文档、包装/启动 P0 问题清单。

每项写 PASS、FAIL 或 UNANSWERED，附证据和平台。缺设备或缺工具属于 UNANSWERED。
关键功能失败须修复；纯测试环境问题只有在同一问题被另一种有效验证覆盖、并记录原因和结果后才能放行。

## 4. 推送标签并正式发布

验收完成后，在同一冻结检出确认版本号、两仓库状态、远端 master 和 gitlink。
确认本地与远端均没有该版本标签。以下步骤是正式发布，不是候选构建：

```powershell
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
git fetch origin --tags
git rev-parse HEAD
git rev-parse origin/master
git status --short
git -C desktop status --short
git tag --list "v$releaseVersion"
git ls-remote --tags origin "refs/tags/v$releaseVersion"
# 上述状态与发布记录一致，且标签不存在后执行：
git tag -a "v$releaseVersion" -m "v$releaseVersion"
git push origin "refs/tags/v$releaseVersion"
```

`v*` 标签会自动创建草稿、重新构建安装包和模板，核对更新清单引用、归档内容及发布说明，然后公开 Release 并更新 latest。镜像和文档部署随后运行。
**这条发布工作流没有依赖 Build/Nightly 的验收结果，因此必须先完成前面的验收。**

当前 `build-tools/release.js` 会同时修改版本、提交、推送 master 和标签；它不执行完整验收。在独立工作树里不要用它代替以上已验证提交的标签步骤。

## 5. 发布后检查与失败处理

- 核对标签目标 SHA、公开 Release 版本和说明。检查安装包、更新清单、清单引用文件及原生模板完整可下载。
- 检查 Windows 签名为 Valid 或 NotSigned；macOS 按实际签名/公证结果记录，未签名不能记作自动更新已通过。
- 安装最终 Release 下载的包并抽查旧项目、Play、Web 导出和诊断；候选包验收不代表 tag 构建的每个字节相同。
- 检查镜像、官网文档和下载链接版本。构建通过、镜像成功、设备接受是分别记录的结果。
- 打包或资产校验失败时，保留草稿和日志，修复后重跑失败 job；修改源码则按新提交重新验证并发布新版本。
- 已公开的标签不删除、不改指向；用户可回退上一已验证版本。严重问题修复后发补丁版本，必要时将 latest 指回上一稳定 Release。

操作记录至少包含：版本、引擎 SHA、编辑器 SHA、三个主流水线 Run ID、原生启动报告、安装包摘要、自动与人工验收结果、未覆盖平台、发布 URL、镜像和官网状态。
