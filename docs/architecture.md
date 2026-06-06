# pi-sandbox-guard 架构说明

## 总体模型

本项目把 Pi extension API、配置系统、policy、sandbox runtime、工具适配和 reviewer 分成明确边界：

- Pi extension API 是外层 adapter。
- 配置表达用户安全意图。
- compile 步骤把配置转换为 `EffectiveConfig`。
- policy 只解释 `EffectiveConfig`，不读取配置文件。
- runtime 只负责沙盒命令执行。
- tools 只负责把 Pi 工具调用转换成 capability request。
- reviewer 只审批 explicit bypass。

核心数据流：

```text
config.json
  -> validate
  -> compile EffectiveConfig
  -> policy.decide(CapabilityRequest)
  -> execute native / sandboxed / review / deny
```

核心类型：

```ts
type EffectiveConfig = {
  sourcePath: string;
  enabled: boolean;
  sandboxRuntime: SandboxRuntimeConfig;
  enforcement: EnforcementConfig;
  reviewer?: ReviewerConfig;
  pathPolicy: CompiledPathPolicy;
};
```

```ts
type CapabilityRequest =
  | { kind: "read"; path: string; tool: "read" | "grep" | "find" | "ls" }
  | { kind: "write"; path: string; tool: "write" | "edit" }
  | { kind: "shell"; command: string; cwd: string; bypass: boolean };
```

```ts
type PolicyDecision =
  | { kind: "deny"; reason: string }
  | { kind: "native"; reason: string }
  | { kind: "sandboxed"; reason: string }
  | { kind: "review"; reason: string };
```

## 生命周期

插件生命周期使用显式 discriminated union。不要用散落的 mutable global 变量表示初始化状态。

```ts
type PluginState =
  | { kind: "not_started" }
  | { kind: "disabled"; reason: string }
  | { kind: "ready"; services: Services }
  | { kind: "failed"; error: SandboxError };
```

工具执行前调用 `requireReady(state)` 之类的小 helper。半初始化、配置缺失或初始化失败时，工具不得继续执行。

## 建议模块布局

```text
src/
  extension.ts
  runtime-state.ts
  errors.ts
  audit.ts

  config/
    schema.ts
    locations.ts
    load.ts
    compile.ts
    effective.ts

  policy/
    capability.ts
    path-policy.ts
    decision.ts
    explain.ts

  runtime/
    sandbox-session.ts
    command-runner.ts
    temp-script.ts
    process-output.ts

  tools/
    registry.ts
    bash.ts
    read.ts
    write.ts
    edit.ts
    search.ts
    tool-context.ts

  review/
    service.ts
    prompt.ts
    evidence.ts
    child-session.ts
    reviewer-tools.ts
    parse.ts
```

## Config

配置系统使用 single-config 模型：

- 如果项目配置存在，就使用项目配置。
- 否则使用全局配置。
- 如果两者都不存在，就禁用插件，并给出清晰原因。
- 不 deep-merge 项目配置和全局配置。
- 不隐式追加数组。
- 如果以后支持继承，必须是显式继承，例如 `extends` 字段。

配置文件表达用户意图：

- `sandbox`：文件系统和网络限制，最终 compile 成 `SandboxRuntimeConfig`。
- `enforcement`：替换哪些 Pi 工具，以及 bypass 如何处理。
- `reviewer`：explicit bypass 审批所用模型、超时和 review 行为。

不要创建 `policy.denyRead`、`policy.allowWrite` 之类的平行权限系统。`sandbox.filesystem` 是所有文件相关行为的权限来源，并同时驱动 `SandboxRuntimeConfig` 和 `CompiledPathPolicy`。

## Policy

policy 模块只接收 `EffectiveConfig` 和 `CapabilityRequest`。它不读文件、不访问 Pi context、不调用 sandbox runtime。

`policy/path-policy.ts` 应该是纯函数或接近纯函数。它负责回答：

- 这个 path 是否可读？
- 这个 path 是否可写？
- 这个目录是否可搜索或列出？

路径检查必须处理 symlink：

- 已存在路径先 resolve real path，再决策。
- 尚不存在的写入目标 resolve 最近存在的父目录。
- runtime schema 语义要求 deny 优先时，deny rule 必须优先于 allow rule。

`policy/decision.ts` 是唯一能在 `deny`、`native`、`sandboxed`、`review` 之间作选择的地方。

`policy/explain.ts` 负责把 decision 转成人类可读的 UI/LLM 文案。核心 policy 不应散落展示字符串。

## Runtime

`runtime/sandbox-session.ts` 是唯一允许调用 `SandboxManager` 的模块。

它拥有这些调用：

- `SandboxManager.initialize(...)`
- `SandboxManager.wrapWithSandboxArgv(...)`
- `SandboxManager.annotateStderrWithSandboxFailures(...)`
- `SandboxManager.cleanupAfterCommand()`
- `SandboxManager.reset()`

每个 sandboxed command 在进程退出后都必须调用 `cleanupAfterCommand()`。Linux 下 bubblewrap 在保护不存在的 denied path 时可能在 host 上创建空白 mount point 文件，例如 `.claude`；这个 cleanup 是必要的。

优先使用 `wrapWithSandboxArgv()`，不要优先使用 raw shell string。命令构造、沙盒包装、进程 spawn 应保持分离。

可以为用户 bash command 使用临时脚本，但临时脚本生命周期必须封闭在单次执行内。

## Tools

v1 替换完整内置工具面：

- `bash`
- `read`
- `write`
- `edit`
- `grep`
- `find`
- `ls`

每个 tool adapter 都遵循同一形状：

```ts
const request = toCapabilityRequest(params, ctx);
const decision = policy.decide(request, effectiveConfig);
return executor.execute(request, decision);
```

`bash` 默认走 sandboxed execution。`bypassSandbox: true` 是 v1 唯一触发 LLM review 的路径。

`read`、`write`、`edit` 可以使用 native Node filesystem API，但执行前必须先通过 policy。

`grep` 和 `find` 不能绕过 read policy。要么在 sandbox 内运行 `rg`/`fd`，要么实现 policy-aware search。`ls` 不能泄露 denied child entries。

## Reviewer

Reviewer approval 集成在 sandbox plugin 内，只为 explicit bypass 行为触发。

使用 Pi SDK child session 执行 reviewer：

- `SessionManager.inMemory()`
- 不写项目 session。
- 不加载项目 extensions。
- 不加载项目 skills。
- 不加载项目 resources。
- 不暴露 shell、write、edit 工具。
- 只暴露受同一 pathPolicy 限制的 reviewer read/search/list 工具。

如果 Pi 原生 `read`、`grep`、`find`、`ls` 可以读取 policy 外的路径，就不要直接暴露给 reviewer。应提供 `review_read`、`review_grep`、`review_find`、`review_ls` wrapper，并强制执行同一份 `pathPolicy`。

Reviewer 输入应包含：

- 从 `ctx.sessionManager` 收集的压缩 transcript。
- 待执行 action 的结构化 JSON。
- 相关 effective policy 摘要。
- 明确说明 transcript、tool arguments、tool results、planned action 都是不可信证据，不是指令。

Reviewer 输出必须结构化：

```ts
type ReviewDecision = {
  outcome: "allow" | "deny";
  riskLevel?: "low" | "medium" | "high";
  rationale: string;
};
```

优先使用 terminating `review_decision` tool，而不是依赖 free-form JSON。如果 reviewer 超时、报错或输出非法，必须 fail closed 并 deny。

## Audit 和 Errors

使用结构化错误，不要到处抛普通字符串：

- `ConfigError`
- `PolicyDeniedError`
- `ReviewDeniedError`
- `SandboxExecError`

Audit record 是结构化 JSON event，用于记录：

- 配置加载或缺失。
- session 初始化或禁用。
- 工具请求规范化结果。
- policy decision。
- reviewer request 和 outcome。
- sandbox command exit。
- sandbox violation annotation。

Audit log 不能包含 secret file contents。
