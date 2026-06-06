# pi-sandbox-guard 测试策略

本项目的测试目标是验证安全边界，而不是追求表面覆盖率。测试应分层处理：config/policy 用纯单元测试，Pi adapter 用 contract test，`sandbox-runtime` 用真实集成测试。

常规本地测试不应要求启动真实 Pi agent。需要真实 Pi 环境的测试可以作为少量 smoke test，但不能成为默认必跑测试。

## 测试分层

### 单元测试

适用于不依赖 Pi SDK、进程执行或真实 sandbox backend 的代码：

- config schema validation。
- config locations 和 single-config 选择逻辑。
- config compile 到 `EffectiveConfig`。
- path policy 的 allow/deny、读写权限、搜索权限和列表权限。
- symlink 和不存在写入目标的路径解析规则。
- policy decision：`deny`、`native`、`sandboxed`、`review`。
- typed errors 和 audit event shaping。

这些测试应使用普通 typed object。不要为了测试 policy 构造 Pi context，也不要让 policy 测试调用 `SandboxManager`。

### Adapter Contract 测试

适用于 `tools/` 和 `review/`：

- mock Pi tool params、tool context 和 services。
- 验证 tool adapter 会先调用 `toCapabilityRequest(...)`。
- 验证所有工具都会进入同一个 `policy.decide(...)`。
- 验证 `deny` 不会执行底层 native filesystem 或 sandbox command。
- 验证 `review` 只由 explicit `bypassSandbox: true` 触发。
- 验证 reviewer tools 使用同一份 `pathPolicy`，不能读取 parent policy 不允许的路径。

Adapter contract 测试不需要真实 Pi session。Pi SDK child session 的行为可以通过薄 wrapper mock 掉；真实 session 只放到可选 smoke test。

### Sandbox Runtime 集成测试

适用于 `runtime/`，尤其是 `runtime/sandbox-session.ts`。

这些测试应真实调用 Anthropic `sandbox-runtime`，因为它验证的是实际 OS sandbox backend 的行为。能在当前平台运行时，不能用 mock 代替。

必须覆盖：

- allowed path 在 sandboxed command 中可读。
- denied path 在 sandboxed command 中不可读。
- allowed write path 可写。
- denied write path 不可写。
- `wrapWithSandboxArgv()` 确实被用于构造 sandboxed command。
- sandbox violation stderr 会经过 annotation，返回清晰错误信息。
- command exit 后调用 `cleanupAfterCommand()`。
- 不存在的 denied path 在 command 结束后不会在 host 上留下空白文件，例如 `.claude`。
- `SandboxManager.initialize(...)` 失败时插件进入 failed 或 disabled 状态，不能继续放行工具。
- command spawn、execution 或 cleanup 失败时行为明确，并且默认 fail closed。

如果网络策略支持禁网，还应覆盖：

- sandboxed command 不能访问外网。
- 网络测试允许按平台或 CI 能力 skip，但 skip 原因必须明确。

## 重点场景

### 文件系统权限一致性

同一份 `sandbox.filesystem` 应同时驱动：

- `SandboxRuntimeConfig`。
- native `read`、`write`、`edit`。
- `grep`、`find`、`ls`。
- reviewer 的只读工具。

测试应构造同一组 allow/deny 路径，并分别验证 shell、native tool、search/list、reviewer tool 的结果一致。

### Symlink

测试应覆盖：

- allowed 目录中的 symlink 指向 denied path 时，读取必须被拒绝。
- denied 目录中的 symlink 指向 allowed path 时，按 resolved real path 和 deny 优先语义决策。
- 写入不存在路径时，使用最近存在父目录决策，不能被字符串前缀绕过。

### Explicit Bypass

`bypassSandbox: true` 不等于直接放行。

测试应覆盖：

- 未设置 `bypassSandbox` 或为 `false` 时，`bash` 走 sandboxed execution。
- 设置 `bypassSandbox: true` 时，policy decision 为 `review`。
- reviewer allow 后才允许执行非 sandboxed 行为。
- reviewer deny、timeout、异常、非法输出都必须 deny。
- reviewer 不应拥有 shell、write、edit 工具。

### Cleanup

每个 sandboxed command 结束后都必须 cleanup。测试应至少覆盖：

- 成功命令后 cleanup 被调用。
- 失败命令后 cleanup 仍被调用。
- command 被 sandbox 拒绝后 cleanup 仍被调用。
- denied path 不存在时，command 后 host 上不会留下同名空白 mount point 文件。

这个场景是 `sandbox-runtime` 集成测试的必测项，不应只用 mock 验证函数调用次数。

## 测试目录建议

```text
tests/
  unit/
    config/
    policy/
    audit/
    errors/

  contract/
    tools/
    review/

  integration/
    sandbox-runtime/
```

默认测试命令应运行 unit 和 contract 测试。`sandbox-runtime` 集成测试可以单独命名，例如 `test:integration:sandbox`，但在发布 v1 前必须运行通过。

## 跳过和平台差异

`sandbox-runtime` 依赖 OS backend。测试可以在不支持的系统上 skip，但必须满足这些要求：

- skip 前先检测 backend 可用性。
- skip message 说明缺少的能力，例如 bubblewrap、Seatbelt 或网络隔离支持。
- 不能因为测试不稳定而静默 skip。
- CI 如果目标平台支持 sandbox backend，应运行 sandbox-runtime 集成测试。

## 验收标准

一次涉及安全语义的修改只有在满足以下条件后才算完成：

- 相关 config/policy 行为有单元测试。
- 相关 tool/reviewer 行为有 adapter contract 测试。
- 相关 runtime 行为有真实 sandbox-runtime 集成测试。
- 失败路径按 fail closed 验证过。
- audit event 不包含 secret file contents。
