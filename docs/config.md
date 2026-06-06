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
    "timeoutMs": 30000,
    "maxTranscriptChars": 12000
  }
}
```

`bypassSandbox: true` 不会直接放行。`mode: "review"` 时 reviewer 超时、报错、拒绝或输出非法都会 deny；`mode: "deny"` 时 explicit bypass 总是 deny。

## 规则

- `sandbox` 直接表达传给 Anthropic `sandbox-runtime` 的安全配置。
- `sandbox.filesystem` 同时 compile 成内部 path policy，约束 native 工具和 reviewer 工具。
- `enforcement.tools` 必须显式列出要接管的工具。
- 不支持隐式默认 allow/deny list。
- 不支持项目配置和全局配置 deep merge。
