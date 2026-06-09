# pi-sandbox-guard 配置参考

本文是配置格式和安全语义参考。按平台可直接复制的推荐配置见 [recommended-config.md](recommended-config.md)。

## 配置查找

配置使用 single-config 模型，不合并项目配置和全局配置。

查找顺序：

1. `<cwd>/.pi/sandbox-guard.json`
2. `~/.pi/agent/sandbox-guard.json`

如果两者都不存在，插件禁用且不接管 Pi 内置工具。项目配置存在但非法时 fail closed，不回退到全局配置。

## 基本结构

```json
{
  "enabled": true,
  "sandbox": {
    "network": {
      "allowedDomains": [],
      "deniedDomains": []
    },
    "filesystem": {
      "denyRead": [],
      "allowRead": [],
      "allowWrite": ["."],
      "denyWrite": []
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

规则：

- `sandbox` 直接表达传给 Anthropic `sandbox-runtime` 的安全配置。
- `sandbox.filesystem` 是文件系统权限的唯一权威来源，同时 compile 成内部 path policy。
- `enforcement.tools` 必须显式列出要接管的工具。
- 不支持隐式默认 allow/deny list。
- 不支持项目配置和全局配置 deep merge。

## 统一 policy 流程

所有工具调用先规范化为 capability request，再由 policy 作唯一决策：

```text
config -> validate -> compile -> capability request -> policy decision -> execute or deny
```

决策类型：

| 决策 | 作用 |
|------|------|
| `deny` | 拒绝执行 |
| `native` | 允许 adapter 通过受控 native 文件系统操作执行 |
| `sandboxed` | 允许 `bash` 通过 `sandbox-runtime` 执行 |
| `review` | explicit bypass 进入 reviewer |

`bash` 默认走 sandboxed execution。只有显式 `bypassSandbox: true` 才可能进入 reviewer；不会直接放行。

## 路径语法和平台差异

路径可以是绝对路径、相对 cwd 的路径，或 `~` 开头的 home 路径。

同一份 `sandbox.filesystem` 会被两个执行层消费：

1. pi-sandbox-guard 内部 path policy，用于 native 文件工具和 adapter 预检查。
2. `sandbox-runtime` 后端，用于 sandboxed `bash` 中的进程。

两者的 glob 表达能力不是完全一致的：

| 场景 | `**/` glob 支持 | 说明 |
|------|------------------|------|
| pi-sandbox-guard path policy | 支持 | `write` / `edit` 等 native 路径检查会匹配目标及其 ancestor。`**/.claude` 可拦 `.claude/note.txt`。 |
| macOS sandboxed `bash` | 支持 | `sandbox-runtime` 使用 Seatbelt profile，将 glob 转为 regex，运行时匹配新建路径。目录型 deny 建议写 `**/dir` 和 `**/dir/**` 两条。 |
| Linux sandboxed `bash` | 写规则仅可靠支持 literal path | Linux 后端是 bubblewrap mount namespace。`allowWrite` / `denyWrite` 中的普通 glob 会被过滤或不能完整表达；不要把 `**/.claude` 当作 Linux bash 的递归保护。 |

> Linux 下 `denyRead` glob 会由 `sandbox-runtime` 尝试展开为已存在路径，但这不是运行时 glob，也不能保护命令执行中新建的匹配路径。

## 读权限

读操作的权限模型是“默认全开 + deny 排除”：

| 规则 | 作用 |
|------|------|
| 无规则 | 所有文件可读 |
| `denyRead` | 关闭指定路径的读权限 |
| `allowRead` | 在 `denyRead` 区域内开窗 |

优先级：`allowRead` > `denyRead`。一条路径只有在命中 `denyRead` 且未命中 `allowRead` 时才被拒绝。

`allowRead` 不是独立门控。它只在 `denyRead` 内部起作用。这意味着当前模型不能表达“只允许读 cwd”：不设 `denyRead` 就是默认可读；`denyRead: ["/"]` 又会阻断 sandbox 内系统路径，导致命令无法运行。

开窗匹配规则：

- `denyRead` 父目录 + `allowRead` 子目录：子目录可读。
- `denyRead` 文件 + `allowRead` 父目录：内部 path policy 可读，但 sandboxed `bash` 未必可读；`sandbox-runtime` 的 mount 语义通常要求 deny 文件和 allow 文件精确同名才能 override。

### 读权限已知限制

- Linux `denyRead` 对尚不存在的路径不生效。
- Linux `denyRead` glob 只能展开当前已存在的匹配路径。
- 不建议在推荐配置中粗暴 `denyRead: ["~/.pi"]`。这会遮蔽 `~/.pi/agent/git` 下通过 git 安装的插件源码和 `sandbox-runtime` helper，并且当 cwd 位于 `~/.pi/agent/git/...` 时可能把可写工作区压成只读，导致 bwrap 在创建 `.gitconfig` 等保护 mount point 时失败。

## 写权限

写操作的权限模型是“默认全关 + allow 开放”：

| 规则 | 作用 |
|------|------|
| 无规则 | 不可写 |
| `allowWrite` | 开放指定路径的写权限 |
| `denyWrite` | 在 `allowWrite` 区域内再排除 |

优先级：先过 `allowWrite` 门，再被 `denyWrite` 排除。一条路径必须命中 `allowWrite` 且未命中 `denyWrite` 才可写。

### 目录型 deny 规则

为了同时保护目录节点本身和目录内容，跨后端推荐写成两条：

```json
"denyWrite": [
  "**/.claude",
  "**/.claude/**"
]
```

含义：

- `**/.claude`：保护名为 `.claude` 的目录/文件节点本身，防创建、替换、删除、rename 到该路径。
- `**/.claude/**`：保护 `.claude` 下的所有内容。

pi-sandbox-guard 内部 path policy 会检查 ancestor，所以 native `write/edit` 中 `**/.claude` 本身就能拦 `.claude/note.txt`；但 macOS Seatbelt regex 是路径精确匹配风格，目录内容仍应显式写 `/**`。Linux sandboxed `bash` 不应依赖 glob write 规则。

### Linux bash 写规则注意事项

Linux `sandbox-runtime` 使用 bubblewrap bind mount 实现写限制。它只能可靠挂载具体路径：

- `denyWrite: [".codex"]`：可保护 cwd 根下 `.codex`。
- `denyWrite: ["packages/a/.claude"]`：可保护该具体子目录。
- `denyWrite: ["**/.claude"]`：不要视为 Linux sandboxed `bash` 的可靠保护。

如果需要 Linux 下递归保护 sandboxed `bash` 写入，必须使用额外机制，例如预展开已有目录、overlay transaction、AppArmor 后端，或限制 `bash` 写权限。当前推荐配置选择 literal path，避免虚假的递归安全承诺。

`@anthropic-ai/sandbox-runtime` 会在用户配置之外追加一组强制 `denyWrite`。推荐配置显式覆盖这些目标，使 pi-sandbox-guard 的 native path policy 与 sandboxed `bash` 的保护范围对齐；具体清单见 [recommended-config.md](recommended-config.md) 的 “`sandbox-runtime` 内置 `denyWrite`” 小节。

Linux 下不要同时 deny 缺失父目录和 `sandbox-runtime` 已强制禁止写入的子路径。例如 `.claude/commands`、`.claude/agents` 已由运行时保护；用户配置再写 `denyWrite: [".claude"]` 时，bubblewrap 可能触发 mount point 类型冲突，导致 `bwrap: Can't mkdir .../.claude: Not a directory`。需要保护 Claude 项目配置时，请使用具体路径，例如 `.claude/settings.json`、`.claude/settings.local.json`、`.claude/commands`、`.claude/agents`。

### 写权限已知限制

- Linux `denyWrite` 对 glob 的支持受 bubblewrap 限制。普通 `**/` 不构成可靠保护。
- Linux `denyRead` 与 `denyWrite` 同一路径冲突时，`denyRead` 的 tmpfs 可能覆盖写保护。这是 `sandbox-runtime` 与 bubblewrap 组合的已知限制。
- `denyWrite: [".git"]` 可保护整个 cwd 根 `.git`，但会阻止正常 `git add` / `git commit`。若目标是允许正常 git 操作但阻止 hook/config 投毒，应保护 `.git/hooks` 和 `.git/config`，而不是整个 `.git`。

## 网络

`allowedDomains` 和 `deniedDomains` 控制 sandboxed `bash` 内进程的网络访问：

- `allowedDomains: []`：阻断所有网络请求。网络代理仍会启动，但白名单为空意味着没有任何域名被放行。
- `deniedDomains: []`：无额外拒绝。

网络规则不影响 native `read/write/edit` 这类文件工具。

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

## Reviewer Bypass

`bypassSandbox: true` 不会直接放行。`enforcement.bypass.mode` 控制 explicit bypass 行为：

| mode | 行为 |
|------|------|
| `deny` | explicit bypass 总是拒绝 |
| `review` | 进入 reviewer；reviewer 超时、报错、拒绝或输出非法都会 deny |

开启 reviewer 时必须显式配置：

```json
{
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

`reviewer` 字段：

- `enabled`：必填，是否启用 reviewer。
- `timeoutMs`：必填，reviewer 超时时间（毫秒）。超时会 fail closed。
- `maxTranscriptTokens`：必填，传给 reviewer 的最大会话长度（近似 token 数，按 chars/4 估算）。
- `model`：可选，审批所用模型，格式 `provider/modelId`。不填则复用父 session 的模型。
- `thinkingLevel`：可选，取值 `off` / `minimal` / `low` / `medium` / `high` / `xhigh`。不填默认 `off`。

Reviewer 子 session 的工具复用同一份或更严格的 `sandbox.filesystem` policy，不会获得比父 session 更宽的读取权限，不具备 write/edit 或 bypass 能力。

## 推荐配置

按平台区分的推荐配置见 [recommended-config.md](recommended-config.md)。
