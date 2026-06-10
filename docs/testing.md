# pi-sandbox-guard 测试策略

本项目的测试目标是验证安全边界，而不是追求表面覆盖率。测试应分层处理：config/policy 用纯单元测试，Pi adapter 用 contract test，`sandbox-runtime` 用真实集成测试。

常规本地测试不应要求启动真实 Pi agent。需要真实 Pi 环境的测试可以作为少量 smoke test，但不能成为默认必跑测试。

## 测试行为，不测试实现形状

测试应验证安全语义、用户可见行为和跨层契约，而不是锁死当前实现细节。一个测试只有在对应行为真的坏掉时才应该失败；如果只是重构实现、改内部变量名或替换 command wrapping 方式就失败，通常说明测试层级不对。

避免在高层 contract / integration 测试中断言：

- 内部 wrapper 命令的精确字符串，例如 `bash -c ...`。
- 内部环境变量名、临时文件名、helper 函数名。
- adapter 传给 runtime 的完整 command string 形状，除非该字符串本身就是该层公开契约。
- mock 中复刻实现算法，再通过 `includes()` 或字符串片段检查实现分支。
- 仅为覆盖代码行而构造、但不对应安全边界或用户可见行为的测试。

优先验证：

- 工具输出是否符合用户可见行为。
- `deny`、`review`、`native`、`sandboxed` 决策是否进入正确流程。
- `deny` 时底层 filesystem 或 sandbox command 是否没有执行。
- sandboxed command 是否真实受 `sandbox-runtime` 约束。
- cleanup、audit、fail closed 等安全契约是否成立。
- 对 search/list 行为，优先构造真实临时文件树并验证结果，而不是检查内部 glob 或 command 字符串。

允许的实现级测试只应放在最低合适层级。例如 command builder/helper 的单元测试可以验证它自己的输出；但 adapter contract 测试不应知道 command builder 的内部协议。

判断标准：如果一个测试失败后，修复方式只是“把 expected 字符串改成新的内部实现”，而不是修复用户行为或安全语义，那么这个测试大概率是实现细节测试。

示例：

```ts
// Bad: adapter contract 锁死内部 wrapper 形式。
expect(wrappedCommand).toBe(`bash -c 'eval "$PI_SANDBOX_GUARD_COMMAND"'`);

// Good: 验证 adapter 契约和用户可见行为。
expect(wrapCalls).toBe(1);
expect(text).toContain("expected output");
expect(cleanupCount).toBe(1);
```

```ts
// Bad: 测试内部 pattern rewrite 字符串。
expect(command).toContain("**/src/*.ts");

// Good: 构造真实文件树，验证用户输入能得到正确结果。
await writeFile(path.join(root, "src", "a.ts"), "", "utf-8");
const text = toolText(await find({ pattern: "./src/*.ts", path: root }));
expect(text).toContain("src/a.ts");
```

## 测试分层

### 单元测试

适用于不依赖 Pi SDK、进程执行或真实 sandbox backend 的代码：

- config schema validation。
- config locations 和 single-config 选择逻辑。
- config compile 到 effective configuration。
- path policy 的 allow/deny、读写权限、搜索权限和列表目标权限。
- symlink 和不存在写入目标的路径解析规则。
- policy decision：`deny`、`native`、`sandboxed`、`review`。
- typed errors 和 audit event shaping。

这些测试应使用普通 typed object。不要为了测试 policy 构造 Pi context，也不要让 policy 测试调用 `SandboxManager`。

### Adapter Contract 测试

适用于 `tools/` 和 `review/`：

- mock Pi tool params、tool context 和 services。
- 验证 tool adapter 会先规范化为 capability request。
- 验证所有工具都会进入同一个 policy decision 流程。
- 验证 `deny` 不会执行底层 native filesystem 或 sandbox command。
- 验证 `review` 只由 explicit `bypassSandbox: true` 触发。
- 验证 reviewer 取证工具使用同一份或更严格的 path policy，不能读取 parent policy 不允许的路径，也不能写入或 bypass。

Adapter contract 测试不需要真实 Pi session。Pi SDK child session 的行为可以通过薄 wrapper mock 掉；真实 session 只放到可选 smoke test。

### Sandbox Runtime 集成测试

适用于 `runtime/`，尤其是 `runtime/sandbox-session.ts`。

这些测试应真实调用 Anthropic `sandbox-runtime`，因为它验证的是实际 OS sandbox backend 的行为。能在当前平台运行时，不能用 mock 代替。

必须覆盖：

- allowed path 在 sandboxed command 中可读。
- denied path 在 sandboxed command 中不可读。
- allowed write path 可写。
- denied write path 不可写。
- sandbox-runtime 的 argv wrapping 确实被用于构造 sandboxed command。
- sandbox violation stderr 会经过 annotation，返回清晰错误信息。
- command exit 行为、cleanup 和 mount point 残留见下方 Cleanup 场景。
- sandbox runtime 初始化失败时插件进入 failed 或 disabled 状态，不能继续放行工具。
- command spawn、execution 或 cleanup 失败时行为明确，并且默认 fail closed。

如果网络策略支持禁网，还应覆盖：

- sandboxed command 不能访问外网。
- 网络测试允许按平台或 CI 能力 skip，但 skip 原因必须明确。

## 重点场景

### 文件系统权限一致性

同一份 `sandbox.filesystem` 应同时驱动：

- sandbox runtime 文件系统配置。
- native `read`、`write`、`edit`。
- `grep`、`find`、`ls`。
- reviewer 取证工具，包括只读工具和受限 sandboxed shell。

测试应构造同一组 allow/deny 路径，并分别验证 shell、native tool、search/list、reviewer tool 的结果一致；同时覆盖 `denyRead` 对直接读取、递归搜索和父目录 listing 的边界语义，具体规则见 [config.md](config.md)。

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
- reviewer 不应拥有 native shell、write、edit 或 bypass 能力；如提供 shell，只能是受限 sandboxed shell。

### Cleanup

每个 sandboxed command 结束后都必须 cleanup。测试应至少覆盖：

- 成功命令后 cleanup 被调用。
- 失败命令后 cleanup 仍被调用。
- command 被 sandbox 拒绝后 cleanup 仍被调用。
- denied path 不存在时，command 后 host 上不会留下同名空白 mount point 文件。

这个场景是 `sandbox-runtime` 集成测试的必测项，不应只用 mock 验证函数调用次数。

## 测试命令

测试命令以 `package.json` 为准。默认测试应覆盖 unit 和 contract 层；真实 `sandbox-runtime` 集成测试可以单独运行，但涉及 runtime 安全语义或发布 v1 前必须通过。

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
