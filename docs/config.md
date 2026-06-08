# pi-sandbox-guard 配置

配置使用 single-config 模型，不合并项目配置和全局配置。

查找顺序：

1. `<cwd>/.pi/sandbox-guard.json`
2. `~/.pi/agent/sandbox-guard.json`

如果两者都不存在，插件禁用且不接管 Pi 内置工具。

## 推荐配置

以下配置针对**中转站投毒**威胁模型：恶意节点在 agent 工具调用回包中注入 `write`/`bash` 操作，向项目写入可执行文件或修改工具配置，后续开发者在 host 上运行时触发逃逸。

核心思路：

- **读权限**：阻止 agent 窃取 API key 和凭证文件。
- **写权限**：在 `allowWrite: ["."]` 区域内排除各工具的自动执行入口，阻止投毒节点写入可自动加载的代码。

```json
{
  "enabled": true,
  "sandbox": {
    "network": {
      "allowedDomains": [],
      "deniedDomains": []
    },
    "filesystem": {
      "denyRead": [
        "**/.env",
        "~/.ssh",
        "~/.aws",
        "~/.gnupg",
        "~/.config/opencode",
        "~/.claude",
        "~/.claude.json",
        "~/.codex",
        "~/.pi"
      ],
      "allowRead": [
        "~/.pi/agent/git"
      ],
      "allowWrite": ["."],
      "denyWrite": [
        "**/.git",
        "**/.claude",
        "**/.codex",
        "**/.opencode",
        "**/.pi",
        "**/opencode.json"
      ]
    }
  },
  "enforcement": {
    "tools": ["bash", "read", "write", "edit", "grep", "find", "ls"],
    "bypass": {
      "mode": "deny"
    }
  }
}
```

### denyRead 说明

| 路径 | 目的 |
|------|------|
| `**/.env` | 当前工作目录下任意深度的 `.env` 文件（API key、数据库密码等） |
| `~/.ssh` | SSH 私钥，前缀匹配覆盖 `~/.ssh/` 下所有文件 |
| `~/.aws` | AWS credentials（`~/.aws/credentials` 等） |
| `~/.gnupg` | GPG 私钥 |
| `~/.config/opencode` | OpenCode 全局配置目录（`opencode.json` 可含 API key） |
| `~/.claude` | Claude Code 全局 settings（`settings.json`、`CLAUDE.md` 等） |
| `~/.claude.json` | Claude Code OAuth token 和 MCP 配置（独立文件，`~/.claude` 前缀无法覆盖） |
| `~/.codex` | Codex 全局配置目录 |
| `~/.pi` | Pi 全局配置目录，含 `agent/auth.json`（25+ provider 的 API key/OAuth token，文件 `0600`）。`allowRead: ["~/.pi/agent/git"]` 除外开窗 |

> **为什么需要 `allowRead: ["~/.pi/agent/git"]`**：Linux 下 sandbox-runtime 的 `apply-seccomp` 二进制位于本地 `node_modules` 中。当项目通过 git clone 安装在 `~/.pi/agent/git/` 下时，`denyRead: ["~/.pi"]` 会将整个 `~/.pi` 挂载 tmpfs，导致该二进制在沙箱内不可见，Unix socket 过滤失效（exit code 127）。

> **关于 `**/.env` 的作用范围**：`**/.env` 只匹配 `<cwd>` 目录树内的 `.env`（如 `/repo/.env`、`/repo/app/.env`），不覆盖 `/other-project/.env`。因为相对路径规则先相对于 `cwd` 解析，且 Linux sandbox 后端不支持 `/**/.env` 这类从根开始的 glob（macOS 支持较好）。对“任意项目中禁止读 `.env`”这个目标，当前推荐配置不构成跨平台保证。

> 如需更广覆盖，可显式添加如 `~/code/**/.env`、`~/work/**/.env` 等规则。

### denyWrite 说明

写权限默认全关（`allowWrite: ["."]` 只开放 cwd）。`denyWrite` 在 cwd 区域内做二次排除：

| 路径 | 目的 |
|------|------|
| `**/.git` | 阻止写入 git hooks（`pre-commit`、`post-checkout` 等）。投毒后，开发者在 host 执行 `git` 操作时即触发 shell 逃逸 |
| `**/.claude` | 阻止写入 Claude Code 项目级 settings/hooks，防止修改权限配置或注入 hook 脚本 |
| `**/.codex` | 阻止写入 Codex 项目级配置 |
| `**/.opencode` | **高风险**：阻止写入 `plugins/*.js`。OpenCode 启动时自动加载 `.opencode/plugins/` 中的 JS/TS 文件，插件通过 Bun shell API 可执行任意 host 命令 |
| `**/.pi` | **高风险**：阻止写入 `extensions/*.ts`。Pi 受信项目启动时自动执行 `.pi/extensions/` 中的 TS/JS 文件（通过 jiti 加载），扩展拥有完整系统权限、可注册 hooks 和自定义 tools |
| `**/opencode.json` | 阻止写入 OpenCode 项目配置（修改 model/provider/permission 等） |

所有 `**/` 前缀匹配当前工作目录（含根目录）下任意深度的此文件/目录，涵盖子模块、worktree 等。

### 威胁链路

典型攻击链：恶意中转站注入 `write` → 写入 `.opencode/plugins/backdoor.js` → 开发者下次 `opencode` 时插件自动在 host 执行。`.pi/extensions/` 和 `.git/hooks/` 有相同的自动执行逃逸路径。

## 文件系统

`sandbox.filesystem` 同时 compile 成内部 path policy，约束所有 native 工具和 reviewer 工具的文件访问。没有单独的工具级权限配置。

## 工具输出限制

工具输出限制不作为用户 raw config 字段配置；它在 compile 阶段写入 effective configuration，便于审计当前会话真实生效的行为。

默认值对齐 Pi 内置工具：

| 字段 | 默认值 | 作用 |
|------|--------|------|
| `toolOutput.maxLines` | `2000` | `bash` 输出最多保留最后 2000 行；`read` 由 Pi 工具保留前 2000 行 |
| `toolOutput.maxBytes` | `51200` | `bash` / `read` / `grep` / `find` / `ls` 输出最多返回 50KB |
| `toolOutput.grepMaxLineChars` | `500` | `grep` 单条匹配行超过 500 字符时截断 |
| `toolOutput.fullOutputDir` | 系统临时目录 | `bash` 输出被截断时保存完整输出的位置 |

`bash` 输出被截断时，返回给模型的是尾部内容，并附带 `Full output: <path>`。完整输出文件由插件 host 进程写入，权限为 `0600`；audit event 只记录结构化元数据，不记录输出内容。

### 读权限：默认全开 + deny 排除

读操作（`read`、`grep`、`find`、`ls`）的权限模型：

| 规则 | 作用 |
|------|------|
| (无规则) | 所有文件可读 |
| `denyRead` | 关闭指定路径的读权限 |
| `allowRead` | 在 `denyRead` 区域内开窗 |

**优先级**：`allowRead` > `denyRead`。一条路径只有在命中 `denyRead` **且**未命中 `allowRead` 时才被拒绝。

`allowRead` **不是独立门控**——它只在 `denyRead` 内部起作用。这意味着无法表达"只允许读当前工作目录"：因为读默认全开，不设 `denyRead` 就等于放行所有路径，而 `denyRead: ["/"]` 会阻断 sandbox 内系统路径导致无法执行任何命令。没有真正的"只读 cwd"白名单——当前模型只能做"默认可读 + `denyRead` 排除敏感路径"的 hardening。

**开窗匹配规则**：
- `denyRead` 父目录 + `allowRead` 子目录 → 子目录可读（前缀匹配）
- `denyRead` 文件 + `allowRead` 父目录 → native 工具可读，但 **sandbox 内进程仍不可读**（sandbox-runtime mount 要求 deny 文件和 allow 父目录精确同名路径才 override）

> **注意**：`allowRead` 父目录开窗对 sandbox 内二进制不生效。这意味着 reviewer sandboxed bash 的 `read`/`grep` 等工具会受到此限制；native 工具（`read`、`write`、`edit` 的 adapter）不受影响。

### 写权限：默认全关 + allow 开放

写操作（`write`、`edit`）的权限模型：

| 规则 | 作用 |
|------|------|
| (无规则) | 不可写 |
| `allowWrite` | 开放指定路径的写权限 |
| `denyWrite` | 在 `allowWrite` 区域内再排除 |

**优先级**：先过 `allowWrite` 门，再被 `denyWrite` 排除。一条路径必须命中 `allowWrite` 且未命中 `denyWrite` 才可写。

### 已知限制

- **`denyRead` 对尚不存在的路径不生效**：sandbox-runtime 的 mount 实现仅对 host 上已存在的路径做保护。沙箱进程如果在 `allowWrite` 区域内创建了一个被列入 `denyRead` 的新文件或目录，它将是可读的。
- **`denyRead` 与 `denyWrite` 冲突**：sandbox-runtime 用 tmpfs 实现 `denyRead`，该挂载为可读写，会覆盖 `denyWrite` 对同一路径的写保护。**同一路径同时出现在 `denyRead` 和 `denyWrite` 中时，agent 可以写入此路径。**（已知上游 bug）

## 网络

`allowedDomains` 和 `deniedDomains` 控制沙箱内进程的网络访问：

- `allowedDomains: []`（空数组）：**阻断所有网络请求**。网络代理仍会启动，但白名单为空意味着没有任何域名被放行。
- `deniedDomains: []`：无额外拒绝。

## Reviewer Bypass

如果允许 explicit bypass 进入 LLM reviewer，必须显式配置 reviewer。完整配置如下：

```json
{
  "enabled": true,
  "sandbox": {
    "network": {
      "allowedDomains": [],
      "deniedDomains": []
    },
    "filesystem": {
      "denyRead": [
        "**/.env",
        "~/.ssh",
        "~/.aws",
        "~/.gnupg",
        "~/.config/opencode",
        "~/.claude",
        "~/.claude.json",
        "~/.codex",
        "~/.pi"
      ],
      "allowRead": [
        "~/.pi/agent/git"
      ],
      "allowWrite": ["."],
      "denyWrite": [
        "**/.git",
        "**/.claude",
        "**/.codex",
        "**/.opencode",
        "**/.pi",
        "**/opencode.json"
      ]
    }
  },
  "enforcement": {
    "tools": ["bash", "read", "write", "edit", "grep", "find", "ls"],
    "bypass": {
      "mode": "review"
    }
  },
  "reviewer": {
    "enabled": true,
    "model": "deepseek/deepseek-v4-flash",
    "thinkingLevel": "off",
    "timeoutMs": 30000,
    "maxTranscriptTokens": 20000
  }
}
```

`bypassSandbox: true` 不会直接放行。`mode: "review"` 时 reviewer 超时、报错、拒绝或输出非法都会 deny；`mode: "deny"` 时 explicit bypass 总是 deny。

`reviewer` 字段说明：
- `enabled`：必填，是否启用 reviewer。
- `timeoutMs`：必填，reviewer 超时时间（毫秒）。超时 → fail closed → deny。
- `maxTranscriptTokens`：必填，传给 reviewer 的最大会话长度（近似 token 数，按 chars/4 估算）。
- `model`：可选，审批所用模型，格式 `provider/modelId`。不填则复用父 session 的模型。
- `thinkingLevel`：可选，思考强度，取值 `off` / `minimal` / `low` / `medium` / `high` / `xhigh`。不填默认 `off`。

Reviewer 子 session 的工具（read、grep 等）复用同一份 `sandbox.filesystem` path policy，不会获得比父 session 更宽的读取权限。

## 规则

- `sandbox` 直接表达传给 Anthropic `sandbox-runtime` 的安全配置。
- `sandbox.filesystem` 是文件系统权限的**唯一权威来源**——所有工具读/写/搜索/列表都回到同一份 path policy。
- `enforcement.tools` 必须显式列出要接管的工具。
- 不支持隐式默认 allow/deny list。
- 不支持项目配置和全局配置 deep merge。
- Reviewer 必须 fail closed：超时、异常、输出非法或拒绝时都不能放行。
