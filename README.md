# AtlasOS

<p align="center">
  <img src="docs/assets/readme/atlasos-logo.png" alt="AtlasOS logo" width="96" />
</p>

<p align="center">
  简体中文 | <a href="README_EN.md">English</a>
</p>

<p align="center">
  <strong>本地优先的无限画布开发工作台，把终端、文件、浏览器、笔记、Git、远程服务器和 AI Agent 工作流放到同一张桌面画布中。</strong>
</p>

AtlasOS 是一个基于 Electron + React 的桌面工作台。它不是把整个工作区强制绑定到一个目录，而是让每个画布节点绑定自己的资源：一个节点可以是本地终端，另一个节点可以是某个项目目录、网页、Markdown 笔记、Git 仓库、SSH 远程服务器或 Claude/Codex 历史会话。

每个顶层标签都是一个独立的本地画布文档。画布会保存节点、分组、位置、尺寸、视口和背景设置，适合把长期项目、临时调试、资料阅读、任务看板和 AI 编程代理会话组织在同一个可视化空间里。

## 预览

![AtlasOS workspace showing files, terminals, browser, Git, calendar, agent history, and notes on one local canvas](docs/assets/readme/atlasos-workspace.png)

## 适合谁

- 同时维护多个项目，希望把终端、目录、网页资料、Git 状态、任务看板和笔记放在同一张可视化工作台里的开发者。
- 高频使用 Codex、Claude Code 等 AI 编程代理，需要看到 agent 是否还在运行、是否等待确认、是否已经完成或出错的用户。
- 经常在本地项目、远程服务器、浏览器资料和 Markdown 笔记之间切换，希望减少窗口切换成本的工程师。
- 需要本地优先保存工作上下文，同时又想按需使用 AI 翻译、截图 OCR、日报总结和插件扩展的个人工具用户。
- 希望为自己的工作流定制节点，但不想从零维护完整 Electron 应用框架的插件作者。

## 典型使用方式

1. **项目驾驶舱**：为一个项目创建画布，拖入仓库目录生成 Files 节点，再添加 Terminal、Git Manager、Browser、Markdown Note 和 Kanban，把开发、调试、资料和任务放到同一屏。
2. **AI Agent 监督台**：在 Terminal 中运行 Codex 或 Claude，浮球提示 waiting/completed/error 状态；完成后用 Claude History、Codex History 和 Agent Usage 回看会话与用量。
3. **资料阅读与翻译**：在 Browser 中查资料，选中文本双 Ctrl 翻译；遇到图片、PDF 截图或不可选中文本时，用截图 OCR/翻译直接处理屏幕区域。
4. **远程运维工作区**：用 Remote Server 连接 SSH/SFTP，把远程 shell、远程文件树、本地终端、Git 状态和备忘便签放在同一张画布上。
5. **个人可扩展工具箱**：用 Quick Launcher 固定常用应用、文件夹、URL 和命令；通过本地插件继续添加自己的专用节点。

## 核心亮点

- **本地优先无限画布**：多画布标签、自由拖拽布局、缩放、节点 resize、节点查找、文件拖放建节点、节点打组、组备注和背景自定义。
- **完整开发节点**：内置 Terminal、Files、Browser、Git Manager、Remote Server、File Preview 等节点，把本地与远程开发上下文放在一张画布里。
- **双 Ctrl 翻译与截图 OCR**：在 AtlasOS 内、内嵌网页中，或 Windows 系统其他应用里双击 Ctrl 触发划词翻译；没有选中文本时进入截图框选，支持 OCR、截图翻译、复制图片/文字/译文。
- **桌面浮球 / Pet**：透明置顶浮球显示看板到期提醒、Codex/Claude 运行状态、等待确认、完成和错误通知；支持原生通知、提示音、自定义图片/视频/sprite 资源。
- **AI Agent 工作台**：索引本地 Claude/Codex 历史，会话浏览、 transcript 查看、终端恢复、年度用量热力图和 AI 生成日报总结。
- **可信本地插件系统**：插件以本地文件夹安装，通过 `atlas-plugin.json` 声明节点、配置、renderer/native 入口；可注册新画布节点，也可在隔离的 Electron `utilityProcess` 中执行原生能力。
- **桌面常驻体验**：主窗口关闭后默认隐藏到托盘，托盘菜单可打开 AtlasOS、进入设置或退出；打包版提供应用更新检查、下载进度和安装重启窗口。
- **安全与隐私边界清晰**：画布和设置默认保存在本机；AI key、远程服务器密码和口令使用 Electron `safeStorage` 加密；renderer 运行在 sandbox、context isolation 和禁用 Node integration 的窗口中。

## 内置节点总览

| 类别 | 节点 | 作用 | 亮点 |
| --- | --- | --- | --- |
| 开发 | **Terminal** | 本地 shell 终端 | 基于 `node-pty` + xterm.js；支持命令库、节点级/全局环境变量、锁定节点、文件路径粘贴、剪贴板图片保存为临时附件并插入路径、Codex/Claude 命令识别和会话跟踪。 |
| 开发 | **Files** | 本地目录树 | 懒加载文件树、目录监听、创建/重命名/删除到回收站、复制路径、在系统文件夹中显示、为目录打开终端、把文件打开为 Markdown 或 File Preview 节点。 |
| 开发 | **File Preview** | 文件预览节点 | 由文件拖放或文件树打开生成；支持文本文件读取/编辑/保存、代码高亮、图片预览、视频预览和媒体比例记忆。 |
| 开发 | **Browser** | 内嵌网页浏览器 | 多标签 `webview`、地址栏、前进/后退/刷新、DevTools、截图、缩放；网页选中文本也可双 Ctrl 翻译，无选区时进入截图捕获。 |
| 开发 | **Git Manager** | Git 仓库面板 | 绑定本地仓库，查看 status/log/branches/stashes；支持 diff 分屏/统一视图、stage/unstage、提交选中文件或 staged 文件、创建/切换/删除分支、fetch/pull/push、stash apply/pop/drop。 |
| 开发 | **Remote Server** | SSH/SFTP 远程服务器 | 管理 SSH profile、host key 确认、远程 shell、远程文件树、上传/下载、新建、重命名、删除、文本编辑和远程状态采样；凭据使用 `safeStorage` 加密。 |
| 规划 | **Markdown Note** | Markdown 笔记 | 编辑/预览模式，支持 GFM、数学公式/KaTeX、代码高亮；拖入 Markdown 文件可初始化为笔记节点。 |
| 规划 | **Sticky Note** | 便签 | TipTap 富文本编辑，支持粗体、斜体、下划线、对齐、背景色、字号预设、自动字号和从内容自动派生标题。 |
| 规划 | **Sketch** | 手绘白板 | 基于 Excalidraw，保存元素、appState 和文件；内置一键思维导图模板，文本元素可进入节点搜索。 |
| 规划 | **Kanban** | 看板任务 | 列和卡片拖拽、列 WIP 限制、标题/描述/标签/优先级/负责人/截止日期、标签/负责人/优先级筛选；到期/逾期卡片可触发浮球提醒并跳回目标卡片。 |
| 规划 | **Calendar** | 日历与时间 | 当前时间、时区、本月日历、本地化周起始日和紧凑模式。 |
| 工具 | **Quick Launcher** | 快捷启动器 | 分页管理 app/file/folder/url/command 快捷入口，支持图标、拖拽排序、PowerShell/cmd 命令和启动防抖。 |
| 工具 | **System Monitor** | 系统监控 | 每秒采样 CPU/内存，支持仪表盘视图和历史波形视图。 |
| Agent | **Claude History** | Claude 本地历史浏览 | 按项目/会话浏览本地历史，查看 transcript，打开项目终端或恢复会话。 |
| Agent | **Codex History** | Codex 本地历史浏览 | 按项目/会话浏览 Codex 历史，查看消息记录，打开项目终端或恢复会话。 |
| Agent | **Agent Usage** | Agent 用量日历 | 扫描本地 Claude/Codex JSONL 历史并写入 SQLite，展示年度热力图、每日 token/session/tool 统计、模型/项目分布，并可调用已配置 AI 生成日报总结。 |

`File Preview` 当前不是创建菜单里的普通节点，而是由文件拖放、文件树打开或其他文件入口创建，用来保留文件绑定关系。

## 画布工作流

- **多画布文档**：顶部标签支持新建、重命名、排序和删除，每个标签对应一个独立本地画布文档。
- **节点创建**：双击画布或按默认快捷键 `Tab` 打开创建菜单；节点按开发、规划、工具、Agent 等类别组织。
- **节点搜索**：默认 `Ctrl+F` 打开节点查找器，快速定位画布上的节点；部分节点会暴露内部文本、文件名或任务标题作为搜索 token。
- **分组整理**：默认 `Ctrl+G` 为选中节点创建分组，`Ctrl+Shift+G` 取消分组；分组支持标题、备注、resize 和整体移动。
- **快速复制**：按住 `Alt` 拖拽可复制节点或分组，适合快速搭建重复结构。
- **拖放文件**：目录会变成 Files 节点；Markdown 文件会变成 Markdown Note；支持的文本、图片和视频会变成 File Preview。
- **背景设置**：支持画布底色和背景图片，图片可设置适配、固定和模糊效果。
- **自动保存**：节点状态、配置、绑定、画布视口、背景和分组会以 JSON 形式保存到 Electron `userData` 下。

## 双 Ctrl 翻译与截图 OCR

AtlasOS 的翻译入口围绕“选中文本优先，没有文本就截图”设计：

1. **AtlasOS 内部**：在终端、输入框、笔记或其他注册了选区的组件中选中文本，连续按两次 Ctrl 会打开悬浮翻译窗口。
2. **内嵌 Browser**：网页内选中文本后双 Ctrl 翻译；没有选区时进入截图捕获。
3. **Windows 系统级**：AtlasOS 在 Windows 上通过低层键盘 hook 监听双 Ctrl。触发后会尝试发送 `Ctrl+C` 捕获外部应用选中文本，并尽量恢复原剪贴板；捕获不到文本时启动全屏截图框选。

翻译和 OCR 由主进程统一调度，支持 OpenAI-compatible `chat/completions` 和 Anthropic `messages` 两种接口。用户可以配置多个 AI profile、Base URL、模型列表、API key、默认翻译模型、默认日报模型和目标语言。API key 通过 Electron `safeStorage` 加密保存。

截图捕获支持跨显示器虚拟屏幕区域。框选后可以执行 OCR、截图翻译、复制图片、复制 OCR 文本或复制译文。

## 浮球 / Pet

桌面浮球是一个透明、置顶、可拖拽的小窗口。它不是单纯装饰，而是 AtlasOS 的轻量提醒中心：

- **看板提醒**：定时扫描画布中的 Kanban 卡片，对到期或逾期任务发出提醒，并支持点击跳回对应画布、节点和卡片。
- **Agent 状态**：跟踪 Codex 和 Claude 会话的 running、waiting、completed、error 等状态。
- **Hook 桥接**：可在设置中安装或修复 Claude/Codex hook。Pet 服务会在本地启动带 token 的 bridge，接收 agent 事件。
- **提醒面板**：悬停浮球可查看运行中的 agent、等待确认的会话和提醒列表。
- **自定义资源**：支持为 idle/running/attention 状态配置图片、视频或 sprite，设置不同动作效果，并添加询问/完成提示音。
- **原生通知**：可开启系统原生通知，点击通知后回到对应的画布上下文。

## Agent 工作流

AtlasOS 把 AI 编程代理视作长期工作流的一部分，而不是一次性命令输出：

- Terminal 节点会识别 Codex/Claude 相关命令，向 Pet 服务报告会话状态。
- Claude History 和 Codex History 节点读取本机历史记录，支持项目/会话浏览、消息查看、打开项目终端和恢复会话。
- Agent Usage 节点把历史 usage 写入本地 SQLite，按日期、模型、项目和工具使用情况聚合。
- 日报总结可以调用用户配置的 AI profile 和模型生成，适合复盘当天的 agent 工作量和关键变更。

## 设置中心

AtlasOS 的设置页把跨节点能力集中管理，避免每个节点重复配置：

- **通用设置**：语言、更新检查、画布快捷键。
- **AI 设置**：OpenAI-compatible / Anthropic profile、Base URL、模型列表和 API key。
- **应用设置**：为翻译选择目标语言，并为翻译和日报总结分别选择默认 profile 与模型。
- **终端指令库**：维护常用命令分类，在 Terminal 节点里一键插入或执行。
- **终端环境变量**：保存可复用的全局环境变量组，并按终端节点选择使用。
- **宠物设置**：浮球开关、原生通知、agent bridge、提醒声音、自定义资源包和状态动作。
- **插件设置**：插件根目录、扫描、添加文件夹、启停、重载、卸载、配置和诊断。

## 插件系统

AtlasOS 插件是可信本地文件夹。一个插件可以只贡献 renderer 节点，也可以额外提供 native runtime 执行需要系统访问、长任务或昂贵计算的能力。

插件基本结构：

```text
plugin-folder/
  atlas-plugin.json
  dist/
    renderer.js
  native/
    main.js
```

核心机制：

- `atlas-plugin.json` 声明插件 id、名称、版本、API 版本、renderer/native 入口、节点、权限和配置项。
- 当前插件 API 版本为 `1`。
- renderer 插件通过 `registerPlugin(api)` 注册节点，使用宿主提供的 React、图标、SDK helper、配置和 `api.invoke`。
- native 插件通过 Electron `utilityProcess.fork(...)` 启动，renderer 可向 native runtime 发送命令并接收结构化结果。
- 外部插件节点类型使用 `plugin:<plugin-id>/<node-id>` 命名空间。
- 内置节点也通过 `atlas.builtins` 这个系统插件注册，保持和外部插件一致的数据模型。
- 插件禁用、缺失或加载失败时，画布会保留节点数据并显示缺失插件占位，避免丢失用户状态。

设置页支持配置插件根目录、扫描、添加单个插件文件夹、启用/停用、重载、卸载、编辑插件配置和查看诊断。更多细节见 [docs/PLUGINS.md](docs/PLUGINS.md)，最小示例见 [examples/plugins/calculator](examples/plugins/calculator)。

## 架构概览

| 层 | 主要路径 | 职责 |
| --- | --- | --- |
| Main process | `src/main` | Electron 窗口、托盘、安全策略、更新、系统服务和 IPC handler。 |
| Preload | `src/preload` | 通过 `contextBridge` 暴露 `window.atlas`，让 renderer 以受控 API 调用本地能力。 |
| Renderer | `src/renderer` | React 应用、无限画布、节点 UI、设置页、翻译窗口、截图窗口、浮球窗口。 |
| Shared | `src/shared` | 跨进程共享的 schema、常量、类型和功能配置。 |
| Plugin SDK | `sdk/atlasos-plugin-sdk` | 插件开发类型、helper 和宿主 API 约定。 |
| Docs / examples | `docs`, `examples` | 设计系统、插件文档、宠物资源规范和示例插件。 |

主进程装配的核心服务包括：

- `CanvasPersistence` / `WorkspaceDocumentService`：画布文档读写、schema 校验和本地 JSON 持久化。
- `AppSettingsService`：应用设置、语言、终端环境、AI、更新、宠物和远程服务器配置。
- `FileSystemService`：本地文件读写、目录树、watch、搜索和回收站删除。
- `PtyService`：本地终端、cwd 跟踪、终端数据流和 agent 命令识别。
- `RemoteServerService`：SSH shell、SFTP 文件操作、host key 校验和远程状态。
- `BrowserService`：内嵌浏览器 tab、导航、缩放、截图和轻量 DOM 自动化 IPC。
- `GitService`：仓库状态、diff、log、分支、stash 和网络操作。
- `AiTranslationService`：AI profile、密钥、翻译窗口、截图窗口、OCR 和截图翻译。
- `PetService`：浮球窗口、看板提醒、agent 状态、hook 安装和本地 bridge。
- `PluginService`：插件扫描、安装、启停、资源协议、renderer 加载和 native runtime。
- `AgentUsageService`、`ClaudeHistoryService`、`CodexHistoryService`：本地 agent 历史索引、查询和用量统计。
- `SystemMetricsService`、`LauncherService`、`UpdateService`：系统指标、快捷启动和应用更新。

## 数据与安全

- 画布文档默认保存到 Electron `userData/workspace-documents`。
- 应用设置默认保存到 `userData/app-settings/settings.json`。
- Agent 用量索引使用 `userData/database/atlas.sqlite`。
- 开发模式会把 `userData` 和 `sessionData` 指向仓库内 `.atlasos-dev`，避免污染正式用户数据。
- AI key、远程服务器密码、私钥口令等敏感信息使用 Electron `safeStorage` 加密。
- 主窗口启用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 默认拒绝 renderer 权限请求，注入 CSP，并把外部窗口打开请求转交给系统浏览器。
- 内嵌浏览器带网络策略，降低 WebRTC 暴露本机网络信息的风险。
- 本地文件和插件资源通过专用协议暴露，例如 `atlas-file:` 和 `atlas-plugin:`。

## 技术栈

- Electron 42.1.0、React 19、TypeScript、electron-vite
- React Flow：无限画布
- Radix UI primitives、Tailwind CSS 4、lucide-react：UI 基础
- node-pty、xterm.js：终端
- Electron `webview` / BrowserService：内嵌浏览器与轻量自动化
- react-arborist：文件树
- CodeMirror 6、React Markdown、remark/rehype、KaTeX：Markdown 和文本编辑
- TipTap：便签富文本
- Excalidraw：手绘白板
- dnd-kit：看板、快捷启动器和部分排序交互
- ssh2：SSH/SFTP 远程服务器
- react-diff-view：Git diff
- zod、write-file-atomic、SQLite、Electron `safeStorage`：schema、持久化和密钥保护

## 目录结构

```text
AtlasOS/
  src/
    main/                 Electron main process、服务和 IPC handler
    preload/              contextBridge API 和 webview preload
    renderer/             React 应用、画布、节点、设置页和独立窗口
    shared/               跨进程共享类型、schema 和常量
  docs/                   设计系统、插件文档、宠物资源规范和 README 图片
  examples/plugins/       示例插件
  sdk/atlasos-plugin-sdk/ 插件 SDK
  scripts/                构建、校验和发布辅助脚本
  build/                  应用图标等构建资源
```

## 开发运行

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run test
npm.cmd run package:win
```

PowerShell 在受限执行策略的 Windows 机器上可能会阻止 `npm` shim，遇到这种情况请使用 `npm.cmd`。

`electron-vite` 需要 Electron runtime 位于 `node_modules/electron/dist`。Electron 42 在生命周期下载被跳过或网络受限时，可能只安装 npm 包但没有 runtime binary，因此 `npm.cmd run dev` 会先执行 `npm.cmd run ensure:electron`。项目 `.npmrc` 已设置 Electron mirror 和项目本地缓存；如网络需要不同源，可覆盖 `ELECTRON_MIRROR` 或 `npm_config_electron_mirror`。

默认开发脚本设置了 `NO_SANDBOX=1`，用于规避受限 Windows 开发环境中 Chromium sandbox 无法访问 GPU/network cache 导致应用卡在 `start electron app...` 的问题。这只影响开发模式；生产窗口仍使用 context isolation、禁用 Node integration 和 renderer sandbox。若要测试更严格的开发路径，可运行：

```bash
npm.cmd run dev:sandbox
```

AtlasOS 默认使用 Chromium GPU compositor。如果受限 Windows VM 或沙箱环境无法通过硬件加速启动，可为本次开发会话启用软件渲染：

```bash
set ATLAS_FORCE_SOFTWARE_RENDERING=1
npm.cmd run dev
```

## Windows 打包说明

Terminal 节点依赖 `node-pty`，Windows 打包时必须为 Electron ABI rebuild 原生模块。运行 `npm.cmd run package:win` 前，请安装 Visual Studio 2022 Build Tools，并勾选 “Desktop development with C++” workload。

打包脚本会设置 `npm_config_devdir=.electron-gyp`，尽量把 Electron header cache 保留在项目目录。部分 node-gyp 版本仍可能使用用户目录缓存。

## 平台说明

- Windows 是当前能力最完整的路径：系统级双 Ctrl hook、PowerShell/cmd 快捷命令、Windows 打包和 node-pty rebuild 说明都围绕 Windows 验证。
- 项目包含 macOS 打包脚本：`npm.cmd run package:mac`。但系统级双 Ctrl 捕获和部分 Windows shell 行为是平台相关能力。
- 应用默认语言为中文，也包含英文 locale；中文 README 确认后可再生成英文版本。

## 相关文档

- [插件开发文档](docs/PLUGINS.md)
- [设计系统](docs/DESIGN.md)
- [宠物资源规范](docs/PET_ASSET_SPEC.md)
- [插件 SDK](sdk/atlasos-plugin-sdk)
- [Calculator 示例插件](examples/plugins/calculator)

## 许可证

MIT
