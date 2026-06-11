# pi-sandbox-guard 推荐配置

本文给出按 Mac/Linux 区分的推荐配置，并说明每个差异背后的原因。完整字段语义见 [config.md](config.md)。

推荐配置文件：

- Linux: [recommended-config.linux.json](recommended-config.linux.json)
- macOS: [recommended-config.macos.json](recommended-config.macos.json)

## 威胁模型

推荐配置主要针对**模型提供商被投毒**：恶意节点在 agent 工具调用回包中注入 `write` / `bash` 操作，直接执行恶意操作或向项目写入自动加载的恶意代码或配置。

典型链路：

```text
恶意回包 -> agent 写入 .opencode/plugins/backdoor.js -> 开发者下次启动 opencode -> 插件在 host 上执行
```

`.pi/extensions/`、`.claude` hooks/settings、`.codex` 项目配置、`.git/hooks/` 也有类似风险。

## 共同读保护

两套推荐配置都采用“默认可读 + deny 敏感文件”的读模型：

| 路径 | 目的 |
|------|------|
| `**/.env` | 当前工作目录树内的 `.env` 文件 |
| `~/.ssh` | SSH 私钥 |
| `~/.aws` | AWS credentials |
| `~/.gnupg` | GPG 私钥 |
| `~/.config/opencode` | OpenCode 全局配置，可能包含 provider credential |
| `~/.claude` | Claude Code 全局 settings / hooks / memory |
| `~/.claude.json` | Claude Code OAuth token 和 MCP 配置 |
| `~/.codex` | Codex 全局配置 |
| `~/.pi/agent/auth.json` | Pi provider API key / OAuth token |
| `~/.pi/agent/models.json` | Pi 模型/provider 配置 |

> `**/.env` 在 Linux sandboxed `bash` 下会被展开为当前已存在的匹配路径；它不是跨整个文件系统的运行时 glob。需要保护其他工作区时，请显式添加如 `~/work/**/.env`。

`sandbox-runtime` 使用 `/tmp/claude` 作为默认临时写目录；macOS 还需要 `/private/tmp/claude` 兼容路径，因此推荐配置将对应路径包含在 `allowWrite` 中。

## `sandbox-runtime` 内置 `denyWrite`

当前依赖的 `@anthropic-ai/sandbox-runtime` 会在用户配置之外，强制保护一组自动加载入口。推荐配置覆盖的目标包括：

| 路径 | 目的 |
|------|------|
| `.git/hooks` | Git hook 脚本 |
| `.git/config` | Git repo 配置，除非 `sandbox.filesystem.allowGitConfig: true` |
| `.gitconfig` / `.gitmodules` | Git 自动加载配置 |
| `.bashrc` / `.bash_profile` / `.zshrc` / `.zprofile` / `.profile` | shell 启动脚本 |
| `.ripgreprc` / `.mcp.json` | 工具自动加载配置 |
| `.vscode` / `.idea` | IDE 项目配置 |
| `.claude/commands` / `.claude/agents` | Claude Code 项目命令和 agent 定义 |

推荐配置覆盖这些内置目标，使 native `write/edit` 与 sandboxed `bash` 的保护范围更一致。Linux `sandbox-runtime` 只有在 cwd 下 `.git` 是目录时才会自动加入 `.git/hooks` 和 `.git/config`；推荐配置仍显式列出它们，以保护已有 Git workspace。升级 `@anthropic-ai/sandbox-runtime` 时需要重新核对这张表。

## Linux 推荐配置

配置文件见 [recommended-config.linux.json](recommended-config.linux.json)。

Linux 后端使用 bubblewrap mount namespace。它对 `allowWrite` / `denyWrite` 的普通 glob 没有可靠运行时支持，因此 Linux 推荐配置只使用 literal write deny path。

### Linux 配置保护什么

这套配置可靠保护 cwd 根目录下的自动执行入口：

| 路径 | 目的 |
|------|------|
| `.git/hooks` | 阻止写入 git hook 脚本 |
| `.git/config` | 阻止修改 repo git config |
| `.gitconfig` / `.gitmodules` | 阻止写入 Git 自动加载配置 |
| shell rc/profile、`.ripgreprc`、`.mcp.json` | 阻止写入 shell 和工具自动加载配置 |
| `.vscode` / `.idea` | 阻止写入 IDE 项目配置 |
| `.claude/settings*.json` / `.claude/commands` / `.claude/agents` | 阻止写入 Claude Code 项目配置和自动加载定义 |
| `.codex` | 阻止写入 Codex 项目级配置 |
| `.opencode` | 阻止写入 OpenCode 项目插件和配置 |
| `.pi` | 阻止写入 Pi 项目 extensions |
| `opencode.json` | 阻止写入 OpenCode 项目配置文件 |

`.git` 没有整体禁止，因为正常 `git add` / `git commit` 需要写 `.git/index`、`.git/objects`、`.git/refs`。如果配置成 `denyWrite: [".git"]`，Linux bash 下 git 提交会失败。这套推荐配置面向已有 Git workspace；在还没有 `.git` 的目录里运行 `git init` 时，`.git/config` 保护可能阻止初始化写入，需要临时调整配置或走 explicit bypass。

`.claude` 也没有整体禁止。`sandbox-runtime` 已强制保护 `.claude/commands` 和 `.claude/agents`；再 deny 缺失的父目录 `.claude` 可能触发 bubblewrap mount 类型冲突，导致 sandbox 初始化失败。需要额外保护时，使用具体文件或子目录。

### Linux 配置不保护什么

这套配置**不承诺**保护子目录里的自动执行入口，例如：

```text
packages/a/.claude
apps/foo/.codex
subdir/.opencode
nested/.pi
```

原因是 Linux bubblewrap 无法表达“允许写整个项目，但拒绝任意深度下名为 `.claude` 的目录”这种运行时 glob deny。推荐配置只写 cwd 根目录下的 literal path；native `write/edit` 也按同一份配置决策，不会额外发明递归保护。需要保护具体子目录时，请显式添加对应 literal path。

## macOS 推荐配置

配置文件见 [recommended-config.macos.json](recommended-config.macos.json)。

macOS 后端使用 Seatbelt profile。`sandbox-runtime` 会把 glob 转成 regex，因此 `**/` 可以运行时匹配未来新建的深层路径。macOS 推荐配置可以使用递归 write deny。

目录型 deny 写成两条是有意的：

| 规则 | 作用 |
|------|------|
| `**/.claude` | 保护 `.claude` 这个目录节点本身 |
| `**/.claude/**` | 保护 `.claude` 下所有内容 |

同理适用于 `.codex`、`.opencode`、`.pi`、`.git/hooks`。文件型目标如 `**/.git/config`、`**/opencode.json` 不需要再加 `/**`。
