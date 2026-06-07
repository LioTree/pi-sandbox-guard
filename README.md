# pi-sandbox-guard

基于 Anthropic [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) 为 Pi agent 提供统一安全执行层的 Pi 扩展。

## 功能

- 接管 Pi 内置的 `bash`、`read`、`write`、`edit`、`grep`、`find`、`ls` 工具。
- Shell 执行、文件系统访问、搜索/列表、绕过、审查和审计全部通过同一套配置与 policy 流程。
- 普通 shell 命令在 `sandbox-runtime` 内运行。
- 原生文件工具和搜索/列表工具均受同一份文件系统 policy 约束。
- 当 agent 在 bash 上设置 `bypassSandbox: true` 时，该调用会被拒绝或交由一个隔离的 LLM reviewer 进行允许/拒绝审查后才执行，类似 [Codex auto-review](https://developers.openai.com/codex/concepts/sandboxing/auto-review)。
    - reviewer 可以通过受限工具检查有边界的证据，但不具备 write/edit 或 bypass 能力。

## 配置

扩展使用单一配置文件。项目配置优先；若无项目配置则使用全局配置。两者都不存在时，扩展被禁用，不会替换 Pi 内置工具。

查找顺序：

1. `<cwd>/.pi/sandbox-guard.json`
2. `~/.pi/agent/sandbox-guard.json`

最小配置、完整配置参考、文件系统语义、reviewer 模式以及已知的 `sandbox-runtime` 限制见 [docs/config.md](docs/config.md)。

## 开发

```sh
npm test
npm run check
npm run test:sandbox
npm run test:integration
```

默认测试覆盖单元和 contract 行为。Sandbox 测试使用真实的 `sandbox-runtime` 后端，可能依赖平台支持。

## 文档

- [docs/config.md](docs/config.md)：面向用户的配置参考。
- [docs/architecture.md](docs/architecture.md)：长期安全边界和子系统边界。
- [docs/testing.md](docs/testing.md)：测试策略与验收期望。
- [AGENTS.md](AGENTS.md)：用于安全维护此仓库的 coding-agent 指令。
