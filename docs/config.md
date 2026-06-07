# pi-sandbox-guard 配置

配置使用 single-config 模型，不合并项目配置和全局配置。

查找顺序：

1. `<cwd>/.pi/sandbox-guard.json`
2. `~/.pi/agent/sandbox-guard.json`

如果两者都不存在，插件禁用且不接管 Pi 内置工具。

## 最小示例

```json
{
  "enabled": true,
  "sandbox": {
    "network": {
      "allowedDomains": [],
      "deniedDomains": []
    },
    "filesystem": {
      "denyRead": ["~/.ssh", "~/.aws", ".env"],
      "allowWrite": ["."],
      "denyWrite": [".git", ".env"]
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

## 文件系统

`sandbox.filesystem` 同时 compile 成内部 path policy，约束所有 native 工具和 reviewer 工具的文件访问。没有单独的工具级权限配置。

### 读权限：默认全开 + deny 排除

读操作（`read`、`grep`、`find`、`ls`）的权限模型：

| 规则 | 作用 |
|------|------|
| (无规则) | 所有文件可读 |
| `denyRead` | 关闭指定路径的读权限 |
| `allowRead` | 在 `denyRead` 区域内开窗 |

**优先级**：`allowRead` > `denyRead`。一条路径只有在命中 `denyRead` **且**未命中 `allowRead` 时才被拒绝。

`allowRead` **不是独立门控**——它只在 `denyRead` 内部起作用。这意味着无法表达"只允许读当前工作目录"：因为读默认全开，不设 `denyRead` 就等于放行所有路径，而 `denyRead: ["/"]` 会阻断 sandbox 内系统路径导致无法执行任何命令。

**开窗匹配规则**：
- `denyRead` 父目录 + `allowRead` 子目录 → 子目录可读（前缀匹配）
- `denyRead` 文件 + `allowRead` 父目录 → 文件仍不可读（sandbox-runtime 内部 mount 对文件 deny 要求精确同名路径才能 override；native 工具不受此限制，走 path-policy 开窗会成功）

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
- **`denyRead` 与 `denyWrite` 冲突**：sandbox-runtime 用 tmpfs 实现 `denyRead`，该挂载为可写，会覆盖 `denyWrite` 对同一路径的写保护（已知上游 bug，在 `denyRead` 和 `denyWrite` 中同时列出同一路径时写保护可能失效）。

## 网络

`allowedDomains` 和 `deniedDomains` 控制沙箱内进程的网络访问：

- `allowedDomains: []`（空数组）：**阻断所有网络请求**。网络代理仍会启动，但白名单为空意味着没有任何域名被放行。
- `deniedDomains: []`：无额外拒绝。

## Reviewer Bypass

如果允许 explicit bypass 进入 LLM reviewer，必须显式配置 reviewer：

```json
{
  "enabled": true,
  "sandbox": {
    "network": {
      "allowedDomains": [],
      "deniedDomains": []
    },
    "filesystem": {
      "denyRead": ["~/.ssh", "~/.aws", ".env"],
      "allowRead": ["~/projects"],
      "allowWrite": ["."],
      "denyWrite": [".git", ".env"]
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
    "maxTranscriptChars": 12000
  }
}
```

`bypassSandbox: true` 不会直接放行。`mode: "review"` 时 reviewer 超时、报错、拒绝或输出非法都会 deny；`mode: "deny"` 时 explicit bypass 总是 deny。

`reviewer` 字段说明：
- `enabled`：必填，是否启用 reviewer。
- `timeoutMs`：必填，reviewer 超时时间（毫秒）。超时 → fail closed → deny。
- `maxTranscriptChars`：必填，传给 reviewer 的最大会话长度（字符数）。
- `model`：可选，审批所用模型，格式 `provider/modelId`（如 `"deepseek/deepseek-v4-flash"`）。不填则复用父 session 的模型。
- `thinkingLevel`：可选，思考强度，取值 `off` / `minimal` / `low` / `medium` / `high` / `xhigh`。不填默认 `off`。

Reviewer 子 session 的工具（read、grep 等）复用同一份 `sandbox.filesystem` path policy，不会获得比父 session 更宽的读取权限。

## 规则

- `sandbox` 直接表达传给 Anthropic `sandbox-runtime` 的安全配置。
- `sandbox.filesystem` 是文件系统权限的**唯一权威来源**——所有工具读/写/搜索/列表都回到同一份 path policy。
- `enforcement.tools` 必须显式列出要接管的工具。
- 不支持隐式默认 allow/deny list。
- 不支持项目配置和全局配置 deep merge。
- Reviewer 必须 fail closed：超时、异常、输出非法或拒绝时都不能放行。
