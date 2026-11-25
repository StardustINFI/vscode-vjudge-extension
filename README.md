# VJudge for VS Code

## 项目简介

在 VS Code 内完成 VJudge 题目浏览、搜索筛选、比赛查看、代码提交和评测状态跟踪，减少在编辑器与浏览器之间来回切换。

### 核心特性

- **纯 JavaScript，零运行时依赖**：扩展端全部使用 CommonJS，`dependencies` 与 `devDependencies` 均为空，不需要执行 `npm install`。
- **原生 VS Code 界面**：侧边栏提供 5 个 TreeView，题目详情、比赛详情和用户信息使用 Webview 展示。
- **完整题目流程**：浏览题目、查看题面与样例、新建代码文件、提交当前文件或选中代码。
- **离线 Mock 模式**：内置 48 道题目、6 场比赛和 7 条提交记录，无网络也可体验主要功能。
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

1. 打开命令面板，执行 **VJudge: Login** 并输入 VJudge 账号和密码。
2. 从活动栏打开 **VJudge** 视图，按需刷新题目或比赛列表。
3. 如需完全离线体验，请启用 Mock 模式。

### 配置项

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `vjudge.mockMode` | boolean | `false` | 启用内置离线数据；环境变量 `VJUDGE_MOCK` 的优先级更高 |

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
| 题目列表 | 显示题号、标题、OJ、难度和解决状态；支持搜索、按 OJ/标签/难度/状态筛选及分页 |
| 我的收藏 | 查看收藏题目，支持打开详情和取消收藏 |
| 提交记录 | 显示提交编号、题目、结果和语言；AC 为绿色、WA 为红色、Pending 为黄色 |
| 比赛列表 | 按未开始、进行中、已结束筛选比赛；支持查看详情、题目和榜单，可报名未开始比赛 |
| 用户信息 | 显示当前用户昵称、解题数及相关统计，可打开完整用户信息页 |

题目节点右键可打开详情、收藏或新建代码文件；提交节点右键可查看详情或重新评测；比赛节点右键可打开详情、榜单或报名。

### 命令面板

常用命令包括：

- **VJudge: Login / Logout**
- **VJudge: Toggle Mock Mode**
- **VJudge: Search Problems / Filter Problems**
- **VJudge: Open Problem List / Open Problem Detail**
- **VJudge: Open Contests / Open Favorites / Open User Info**
- **VJudge: Submit Current File / Submit Selection**
- **VJudge: Open Code Template**
- **VJudge: Refresh All**

### Webview 题目详情

题目详情页顶部提供提交、收藏、打开网页版和刷新操作。正文保留题面排版，样例提供输入和输出的一键复制按钮。底部状态栏显示当前用户和最近一次提交状态。

代码提交区可选择语言并直接编辑代码。停止输入约 500 毫秒后会自动保存本地草稿；提交成功后会自动刷新最新评测状态。

### 提交流程

1. 在题目列表或收藏中打开题目。
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
4. 项目自带的调试配置默认设置 `VJUDGE_MOCK=true`，因此按 `F5` 启动后即为离线模式。

Mock 数据包含 48 道题目、6 场比赛、7 条初始提交、收藏状态和比赛报名状态；新增提交、重新评测与 Pending 轮询也会在内存中模拟状态变化。

## 开发与调试

### 项目结构

```text
.
├── extension.js          # 扩展入口：注册、装配与生命周期
├── lib/                  # 请求、解析、存储、客户端和命令工作流
├── mock/                 # 离线客户端与内置数据
├── views/                # 5 个原生 TreeView
├── webviews/             # 3 个 Webview 管理器
├── resources/            # Webview HTML/CSS/JS 与图标
├── templates/            # 10 种语言代码模板
├── .vscode/launch.json   # Extension Development Host 调试配置
└── package.json          # 扩展清单与贡献点
```

### 启动调试

1. 使用 VS Code 打开项目根目录。
2. 确认已安装 Node.js，项目本身不需要安装任何 npm 依赖。
3. 按 `F5`，选择 **Run VJudge Extension (Mock)**。
4. VS Code 会启动 Extension Development Host，并在新窗口中加载当前扩展。
5. 在新窗口中打开 VJudge 活动栏视图进行调试。

调试配置位于 `.vscode/launch.json`，默认注入 `VJUDGE_MOCK=true`。如需调试真实接口，可在启动环境中取消该变量，并关闭 `vjudge.mockMode`。

### 查看日志

打开 **View: Output**，在输出通道下拉框中选择 **VJudge**：

- `[HTTP]` 记录请求层异常和 Cookie 保存失败。
- `[VJudge]` 记录接口请求失败、解析异常及原始响应前 500 字符。
- `[Command]` 记录命令执行异常和草稿保存异常。

网络请求失败时会显示错误提示；登录态失效时会清理会话并跳转登录命令。HTML 解析失败时只记录响应前 500 字符，避免日志无限增长。

### 基础检查

项目没有构建步骤。修改扩展端 JavaScript 后，可使用 Node.js 做语法检查：

```bash
node --check extension.js
node --check resources/webview.js
```

## 已知限制与 TODO

### 已知限制

- VJudge 没有公开稳定的官方 API，当前接口路径和字段来自前端行为逆向，上游改版可能导致请求失败或字段缺失。
- 题目详情、比赛列表等 HTML 接口使用正则和字符串扫描解析，遇到嵌套结构变化、动态渲染或非常规表格时可能提取偏差。
- 比赛分页、榜单字段和用户统计依赖上游实际返回结构，部分页面可能只能显示当前响应中的数据。
- Webview 在超长题面、大量样例或超大榜单下可能出现渲染和滚动性能下降。
- 尚未内置代码高亮和数学公式渲染库，复杂公式或代码块只能依赖题面原始 HTML。
- 未建立针对真实 VJudge 的自动化集成测试，目前主要使用 Mock 数据和本地行为测试。
- 未保存文件与题目的关联只在当前扩展会话内有效；窗口重载后可能需要重新指定题目。
- 语言模板提供的是完整基础骨架，不包含具体题目的解题算法。

### TODO

- [ ] 增加基于固定响应样本的接口契约测试和 HTML 解析回归测试。
- [ ] 为接口路径、超时和重试策略提供可配置项，降低上游变更影响。
- [ ] 引入本地 vendor 版代码高亮与数学公式渲染，并继续遵守零 npm 依赖约束。
- [ ] 完善比赛分页、榜单筛选、提交详情和错误分类展示。
- [ ] 增强草稿管理，支持草稿列表、恢复提示和跨会话文件关联。
- [ ] 增加更多语言模板和 VS Code 语言标识映射。
- [ ] 补充多语言界面与更完整的用户文档。
- [ ] 在不影响默认 Mock 调试的前提下，增加真实模式的可选冒烟测试。

## 项目仓库

源码与问题反馈：[StardustINFI/vscode-vjudge-extension](https://github.com/StardustINFI/vscode-vjudge-extension)
