# VJudge for VS Code

## 项目简介

在 VS Code 内查看 VJudge 团队与比赛、浏览比赛内题目、提交代码并跟踪评测状态，减少在编辑器与浏览器之间来回切换。

### 核心特性

- **纯 JavaScript，零运行时依赖**：扩展端全部使用 CommonJS，`dependencies` 与 `devDependencies` 均为空，不需要执行 `npm install`。
- **原生 VS Code 界面**：侧边栏提供 6 个 TreeView，题目详情、比赛详情和用户信息使用 Webview 展示。
- **团队与比赛范围**：查看自己加入或创建的团队，并把比赛列表切换为「仅我的团队比赛」或「指定团队的比赛」。
- **比赛内题目列表**：不再展示全站题目列表，选中一场比赛后侧边栏只列出该比赛的题目（题号 A/B/C 与 OJ-编号）。
- **完整提交流程**：打开题面与样例、新建代码文件、提交当前文件或选中代码。
- **明确的登录状态**：状态栏区分"未登录 / 已登录 / Mock"，未登录时侧边栏给出登录入口，不展示无关数据。
- **两种登录方式**：账号密码登录，以及从浏览器复制 Cookie 的登录方式（可绕过网页端人机验证）。
- **离线 Mock 模式**：内置 3 个团队、6 场比赛、48 道题目和 7 条提交记录，无网络也可体验主要功能。
- **提交状态跟踪**：提交记录支持结果着色、详情查看、重新评测和 Pending 状态自动刷新。
- **安全的凭据管理**：账号、密码、Cookie 和当前用户信息存储在 VS Code SecretStorage，不使用明文配置文件。
- **10 种语言模板**：C++、C、Java、Python、JavaScript、TypeScript、Go、Rust、Ruby、C#。
- **主题自适应 Webview**：界面跟随 VS Code 明暗主题，支持排序、分页、筛选、样例复制和草稿防抖保存。

## 安装与配置

### 环境要求

- VS Code 1.85 或更高版本。
- 使用真实模式时需要能够访问 VJudge，并按需配置网络代理。

### 通过 VSIX 安装

1. 在 VS Code 中打开扩展视图。
2. 点击扩展视图右上角的更多操作菜单，选择 **Install from VSIX...**。
3. 选择已生成的 `.vsix` 文件并安装。
4. 执行 **Developer: Reload Window** 重新加载窗口。

也可以使用命令行安装：

```bash
code --install-extension vjudge-extension.vsix
```

### 手动安装

将解压后的扩展目录放入当前用户的 VS Code 扩展目录，然后重启 VS Code，或执行 **Developer: Reload Window**。具体扩展目录由 VS Code 安装方式和运行环境决定。

### 首次使用

1. 打开命令面板，执行 **VJudge: Login**，选择登录方式。
2. 推荐选择 **Cookie 登录（推荐）**：先在浏览器中登录 vjudge.net，打开开发者工具的 Network 面板，复制任意请求的 `Cookie` 请求头（包含 `JSESSIONID` 与 `JSESSlONID`），粘贴到输入框；用户名可选填，用于侧边栏显示。
3. 若选择 **账号密码登录**，VJudge 可能要求 Turnstile 人机验证，插件无法自动完成；此时会给出明确提示并建议改用 Cookie 登录。
4. 登录成功后状态栏显示已登录，六个视图才会加载对应数据；Cookie 过期后需要重新导入。
5. 如需完全离线体验，请启用 Mock 模式。Mock 模式使用内置数据，不需要登录。

> VJudge 的比赛列表和提交记录属于公开数据。默认未登录时不加载；如希望匿名浏览，可开启 `vjudge.anonymousBrowsing`。「我的团队」「仅我的团队比赛」「指定团队的比赛」始终要求登录，不受该配置影响。

### 配置项

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `vjudge.mockMode` | boolean | `false` | 启用内置离线数据；环境变量 `VJUDGE_MOCK` 的优先级更高 |
| `vjudge.anonymousBrowsing` | boolean | `false` | 未登录时仍加载 VJudge 公开的比赛列表和提交记录 |

在 `settings.json` 中启用 Mock：

```json
{
  "vjudge.mockMode": true
}
```

## 核心功能说明

### 侧边栏视图

| 视图 | 功能 |
| --- | --- |
| 我的团队 | 列出自己加入或创建的团队；创建者以星标标识，展开可查看角色、成员名单、负责人、公开性与比赛统计 |
| 比赛列表 | 顶部显示当前范围；支持全部比赛、仅我的团队比赛、指定团队比赛，以及按状态筛选和分页 |
| 比赛题目 | 只显示当前选中比赛的题目，包含比赛题号（A/B/C）、OJ-编号、标题和 OJ；支持本地筛选 |
| 我的收藏 | 查看收藏题目，支持打开详情和取消收藏 |
| 提交记录 | 显示提交编号、题目、结果和语言；AC 为绿色、WA 为红色、Pending 为黄色 |
| 用户信息 | 显示当前用户昵称、解题数及相关统计，可打开完整用户信息页 |

真实模式下，未登录时六个视图统一显示"未登录，点击登录 VJudge"提示节点，点击即可进入登录流程。团队节点右键可只看该团队比赛或在浏览器打开；比赛节点右键可打开详情、切换比赛题目、查看榜单或报名；题目节点右键可打开详情、收藏或新建代码文件；提交节点右键可查看详情或重新评测。

点击「我的团队」中的团队节点，或执行 **VJudge: Show Contests Of Group**，比赛列表会切换为只看该团队的比赛；执行 **VJudge: Toggle My Groups' Contests Only** 可在「仅我的团队比赛」与「全部比赛」之间切换。**VJudge: Filter Contests** 提供完整的范围与状态筛选。点击比赛节点会在打开详情的同时把「比赛题目」视图切换到该场比赛，也可以用 **VJudge: Select Contest For Problems** 手动选择。

### 数据来自哪里

以下接口均来自 VJudge 网页前端的实际行为，不是臆造的 REST API：

| 用途 | 接口 | 数据形式 |
| --- | --- | --- |
| 我的团队 | `GET /group` | 页面内联 `dataJson` 的 `myGroups`；`myRole=2` 为创建者、`1` 为管理员 |
| 团队详情 | `GET /group/{shortName}` | 页面内联 `dataJson` 的成员、简介与比赛列表 |
| 搜索团队 | `POST /group/search` | 表单 `name`，返回 `cards` |
| 比赛列表 | `GET /contest/data` | DataTables 参数；`category=mygroup` 为我的团队比赛，`category=group` 配合 `owner=团队名` 为指定团队 |
| 比赛题目 | `GET /contest/{id}` | 页面内联 `dataJson` 的 `problems`，每项含 `oj`、`probNum`、`num` |

未登录时 VJudge 会把 `category=mygroup` 静默退化成全量公开比赛，因此插件在发请求前先确认登录态：未登录时该范围不会发起比赛列表请求，视图只显示登录入口。

### 命令面板

常用命令包括：

- **VJudge: Login / Login With Cookie / Logout**
- **VJudge: Toggle Mock Mode**
- **VJudge: Open My Groups / Search Groups / Refresh My Groups**
- **VJudge: Open Contests / Filter Contests / Toggle My Groups' Contests Only / Show Contests Of Group**
- **VJudge: Open Contest Problems / Select Contest For Problems / Filter Contest Problems**
- **VJudge: Open Problem Detail / Open Favorites / Open User Info**
- **VJudge: Submit Current File / Submit Selection / Open Code Template**
- **VJudge: Refresh All**

### Webview 题目详情

题目详情页顶部提供提交、收藏、打开网页版和刷新操作。正文来自页面内联数据或题面容器，保留原始排版，样例提供输入和输出的一键复制按钮。底部状态栏显示当前用户和最近一次提交状态。

VJudge 的服务端 HTML 是未经前端渲染的模板，其中含有未翻译的 i18n 键、内联数据和隐藏区块。插件只提取真正的题面内容并做清洗，不会把整页骨架当作正文显示；若题面暂时无法解析，页面会给出提示，可点击「网页版」前往 VJudge 查看完整题目。比赛详情中的题目描述采用同样策略。

代码提交区可选择语言并直接编辑代码。停止输入约 500 毫秒后会自动保存本地草稿；提交成功后会自动刷新最新评测状态。

### 提交流程

1. 在「比赛题目」或「我的收藏」中打开题目（也可执行 **VJudge: Open Problem Detail** 直接输入题号）。
2. 右键选择 **New Code File**，或执行 **VJudge: Open Code Template**。
3. 选择语言并填写代码。
4. 执行 **VJudge: Submit Current File**，或选中部分代码后执行 **VJudge: Submit Selection**。
5. 在提交记录或题目详情底部查看评测结果；Pending 状态会按固定间隔自动刷新。

## Mock 模式指南

Mock 模式用于无网环境、界面开发和调试。启用后不会发起任何真实网络请求，所有数据均来自本地 Mock 客户端。

### 方式一：环境变量

在启动 VS Code 前设置环境变量：

Linux 或 macOS：

```bash
VJUDGE_MOCK=true code
```

Windows PowerShell：

```powershell
$env:VJUDGE_MOCK="true"
code
```

Windows 命令提示符：

```bat
set VJUDGE_MOCK=true && code
```

环境变量必须由 VS Code 及其扩展宿主进程继承。修改后需要完全退出并重新启动 VS Code。

### 方式二：VS Code 设置

在设置中搜索 `vjudge.mockMode`，或直接在 `settings.json` 中设置：

```json
{
  "vjudge.mockMode": true
}
```

也可以执行 **VJudge: Toggle Mock Mode** 快速切换。若环境变量已经设置，命令会提示环境变量优先，且不会覆盖当前生效状态。

### 优先级与行为

1. `VJUDGE_MOCK` 存在时优先级最高：`true`、`1`、`yes` 或 `on` 启用；其他值禁用。
2. 未设置环境变量时，读取 `vjudge.mockMode` 设置。
3. Mock 开启时，HTTP 层会在发网前直接阻断请求，避免任何真实访问。
4. 项目自带两个调试配置：`Run VJudge Extension (Real)` 不注入环境变量，`Run VJudge Extension (Mock)` 注入 `VJUDGE_MOCK=true`。按 `F5` 前请确认选择的是需要的配置。

Mock 数据包含 3 个团队（1 个创建、2 个加入）、6 场比赛（其中 5 场归属团队）、48 道题目、7 条初始提交、收藏状态和比赛报名状态。切换到「仅我的团队比赛」或某个具体团队时，比赛数量会相应变化；新增提交、重新评测与 Pending 轮询也会在内存中模拟状态变化。

## 开发与调试

### 项目结构

```text
.
├── extension.js          # 扩展入口：注册、装配与生命周期
├── lib/                  # 请求、解析、存储、登录态门控、客户端和命令工作流
├── mock/                 # 离线客户端与内置数据
├── views/                # 6 个原生 TreeView
├── webviews/             # 3 个 Webview 管理器
├── resources/            # Webview HTML/CSS/JS 与图标
├── templates/            # 10 种语言代码模板
├── .vscode/launch.json   # Extension Development Host 调试配置
└── package.json          # 扩展清单与贡献点
```

### 启动调试

1. 使用 VS Code 打开项目根目录。
2. 确认已安装 Node.js，项目本身不需要安装任何 npm 依赖。
3. 按 `F5`，按需选择 **Run VJudge Extension (Real)**（真实接口）或 **Run VJudge Extension (Mock)**（离线数据）。
4. VS Code 会启动 Extension Development Host，并在新窗口中加载当前扩展。
5. 在新窗口中打开 VJudge 活动栏视图进行调试。

调试配置位于 `.vscode/launch.json`。环境变量 `VJUDGE_MOCK` 优先级最高，选择 Mock 配置后设置项和切换命令都无法关闭 Mock；需要真实模式时请选择 Real 配置并重新启动调试窗口。状态栏会显示当前是 Mock 还是真实模式，以及是否已登录。

### 查看日志

打开 **View: Output**，在输出通道下拉框中选择 **VJudge**：

- `[HTTP]` 记录请求层异常和 Cookie 保存失败。
- `[VJudge]` 记录接口请求失败、解析异常及原始响应前 500 字符。
- `[Command]` 记录命令执行异常和草稿保存异常。

网络请求失败时会显示错误提示；只有在确认此前已登录的前提下遇到 401/403 才会提示"登录已失效"，且需要用户点击"重新登录"才会打开登录流程。HTML 解析失败时只记录响应前 500 字符，避免日志无限增长。

### 基础检查

项目没有构建步骤。修改扩展端 JavaScript 后，可使用 Node.js 做语法检查：

```bash
node --check extension.js
node --check resources/webview.js
```

## 已知限制与 TODO

### 已知限制

- VJudge 没有公开稳定的官方 API，当前接口路径和字段来自前端行为逆向，上游改版可能导致请求失败或字段缺失。
- VJudge 网页登录带 Turnstile 人机验证，插件无法自动完成；账号密码登录可能因此失败，推荐使用 Cookie 登录。
- 通过 Cookie 登录需要手动从浏览器复制，Cookie 过期后需重新导入；凭据保存在本地 SecretStorage。
- 未登录时 VJudge 的列表接口会返回哨兵总数 `9999999`，插件将其归一化为 0，不会当成真实总数；`category=mygroup` 还会退化成全量公开比赛，因此该范围强制要求登录。
- 团队与比赛信息优先读取页面内联 `dataJson` 的 JSON；题目详情等仍使用正则和字符串扫描解析，上游改版或非常规表格时可能提取偏差，比赛题目解析失败会回退到 HTML 中的题面链接。
- 比赛分页、榜单字段和用户统计依赖上游实际返回结构，部分页面可能只能显示当前响应中的数据。
- Webview 在超长题面、大量样例或超大榜单下可能出现渲染和滚动性能下降。
- 尚未内置代码高亮和数学公式渲染库，复杂公式或代码块只能依赖题面原始 HTML。
- 未建立针对真实 VJudge 的自动化集成测试，目前主要使用 Mock 数据和本地行为测试。
- 未保存文件与题目的关联只在当前扩展会话内有效；窗口重载后可能需要重新指定题目。
- 语言模板提供的是完整基础骨架，不包含具体题目的解题算法。

### TODO

- [ ] 增加基于固定响应样本的接口契约测试和 HTML 解析回归测试。
- [ ] 探索合规的自动登录方案，减少手动复制 Cookie 的操作。
- [ ] 为接口路径、超时和重试策略提供可配置项，降低上游变更影响。
- [ ] 引入本地 vendor 版代码高亮与数学公式渲染，并继续遵守零 npm 依赖约束。
- [ ] 完善比赛分页、榜单筛选、提交详情和错误分类展示。
- [ ] 增加团队详情 Webview，展示成员列表、团队简介和团队内比赛入口。
- [ ] 增强草稿管理，支持草稿列表、恢复提示和跨会话文件关联。
- [ ] 增加更多语言模板和 VS Code 语言标识映射。
- [ ] 补充多语言界面与更完整的用户文档。
- [ ] 增加真实模式的可选冒烟测试，同时保留默认可用的离线调试配置。

## 项目仓库

源码与问题反馈：[StardustINFI/vscode-vjudge-extension](https://github.com/StardustINFI/vscode-vjudge-extension)
