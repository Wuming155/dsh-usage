# dsh-usage

> ⚠️ **本仓库派生自 [nanami-0713/dsh-usage](https://github.com/nanami-0713/dsh-usage)**，
> 原项目由 **nanami-0713** 创建，以 **MIT License** 授权（见 [`LICENSE`](./LICENSE)）。

DSH Token 消耗体系插件：会话级实时费用徽标（逐请求模型×时代×峰谷计价）+ 全局用量看板 +
Coding Plan 订阅额度监控（GLM/Kimi），三位一体。Unified token usage & quota plugin for DeepSeek Harness。

本仓库在原项目基础上进行了修改。

## 功能特性

- **会话级实时费用徽标**：按逐请求维度，结合「模型 × 时代 × 峰谷计价」实时计算 Token 消耗费用。
- **全局用量看板**：汇总展示整体 Token 用量与花费。
- **订阅额度监控**：监控 Coding Plan 订阅额度（GLM / Kimi 等）。
- **刊例价自动更新**：通过脚本从公开价格源抓取最新模型单价，生成本地价格数据文件。

## 目录结构

```
dsh-usage/
├── scripts/
│   └── update-prices.mjs     # 抓取模型刊例价，更新本地价格文件
├── src/
│   ├── board/                # 用量看板模块
│   ├── client/               # 客户端 / 接口模块
│   ├── core/                 # 计价内核
│   ├── quota/                # 额度与价格
│   │   ├── adapters/         # 额度数据源适配器
│   │   └── prices.json       # 模型刊例价数据（由脚本生成）
│   └── session/              # 会话级费用模块
├── test/                     # 测试
├── package.json
└── LICENSE                   # MIT License（原项目 nanami-0713）
```

## 环境要求

- Node.js（支持 `import` 的 ES Module 环境）
- [Playwright](https://playwright.dev/)（用于价格抓取脚本）：
  - 优先使用项目依赖中的 `playwright` npm 包；
  - 未安装时回退使用全局 `@playwright/cli` 内置的 `playwright`。

## 作为 DSH 插件安装

本仓库即是一个 DSH（DeepSeek Harness）插件，推荐通过 **npm 包** 安装（包内已预编译 `lib/`，不受 pnpm 对 git 源的 build 限制影响）：

```bash
# 方式一：已发布的 npm 包（推荐）
dsh plugin --profile web add @hsinsekai-nanami/dsh-usage@1.0.1

# 方式二：本地预编译包（仓库内的 .tgz，已含 lib/）
dsh plugin --profile web add file:<仓库根目录>/hsinsekai-nanami-dsh-usage-1.0.1.tgz
```

卸载与查看已安装插件：

```bash
dsh plugin --profile web remove @hsinsekai-nanami/dsh-usage
dsh plugin --profile web list
```

> ⚠️ **不要使用 git 源安装**（`dsh plugin --profile web add github:Wuming155/dsh-usage` 或 `git+https://github.com/Wuming155/dsh-usage.git`）。
> DSH 用 pnpm 管理插件，pnpm 默认禁止 git 源在安装时执行 build 脚本；而本插件入口 `main` 指向编译产物 `lib/`，
> 未被编译会导致插件加载失败、DSH 无法启动。npm 包中的 `lib/` 是预构建好的，因此上面的方式最稳定。
>
> 若确须基于 git 源安装，需编辑 `C:\Users\<用户名>\.dsh\profiles\web\pnpm-workspace.yaml`，
> 在 `allowBuilds` 中加入该 git 源的允许项（具体 key 以 pnpm 报错提示为准），再执行安装。

## 本地开发环境（贡献者）

```bash
npm install
# 若使用全局 @playwright/cli 作为回退，请确保已安装：
# npm install -g @playwright/cli
# npx playwright install chromium
```

## 使用

### 更新模型刊例价

从 `https://tokenrhythm.studio/models` 抓取最新模型价格，并写入 `src/quota/prices.json`：

```bash
npm run update-prices
# 等价于：node scripts/update-prices.mjs
```

脚本行为：

- 自动加载 Playwright（优先 npm 包，回退全局 `@playwright/cli`）。
- 自动探测已安装的 Chromium 可执行文件（支持 Windows / Linux / macOS）。
- 抓取全部模型卡片，按模型 `id` 去重后写入本地价格文件。

可选环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PLAYWRIGHT_PATH` | playwright 模块路径（本地回退时使用） | 见脚本内 `PLAYWRIGHT_CLI_PATH` |
| `PLAYWRIGHT_BROWSERS_PATH` | playwright 浏览器目录 | 按平台自动探测 |
| `CHROMIUM_PATH` | Chromium 可执行文件完整路径（最高优先级） | 自动探测 |
| `HEADLESS` | 是否无头模式 | `1`（设为 `0` 显示浏览器窗口） |
| `OUTPUT` | 价格文件输出路径 | `src/quota/prices.json` |

生成的 `prices.json` 结构示例：

```json
{
  "source": "https://tokenrhythm.studio/models",
  "updatedAt": "2026-08-31T01:24:21.141Z",
  "currency": "CNY",
  "modelCount": 22,
  "models": [
    {
      "id": "deepseek-v4-flash-0731",
      "name": "deepseek-v4-flash-0731",
      "provider": "DeepSeek / 阿里云 / 无问",
      "status": "测试中",
      "contextLength": 1000000,
      "maxOutputTokens": 384000,
      "modalities": ["文本"],
      "responsesApi": "原生支持",
      "pricing": {
        "input":    { "amount": 3, "unit": "M Tokens" },
        "output":   { "amount": 9, "unit": "M Tokens" },
        "cacheHit": { "amount": 0.1, "unit": "M Tokens" }
      }
    }
  ]
}
```

## 许可证

本项目继承原项目的 **MIT License**，原始版权归 **nanami-0713** 所有：

```
Copyright (c) 2026 nanami-0713
```

根据 MIT 许可证，分发本软件的任何副本或实质性部分时，
必须包含原始版权声明及许可文本（即 [`LICENSE`](./LICENSE) 文件内容）。

原仓库：https://github.com/nanami-0713/dsh-usage
