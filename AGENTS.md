# pi-sandbox-guard

本项目是一个 Pi 扩展，基于 Anthropic `sandbox-runtime` 为 Pi agent 提供统一的安全执行层。

v1 接管这些 Pi 内置工具：`bash`、`read`、`write`、`edit`、`grep`、`find`、`ls`。所有 shell 执行、文件读写、搜索、列表和 explicit bypass 都必须经过同一套配置、policy 和 audit 流程。

用户入口见 [README.md](README.md)。架构边界见 [docs/architecture.md](docs/architecture.md)，配置格式见 [docs/config.md](docs/config.md)，测试策略见 [docs/testing.md](docs/testing.md)。这些文档描述安全语义和工作约束；具体类型、函数名、文件布局以当前代码为准。

## 必须保持的安全不变量

- 文件系统权限只有一个来源：compiled `sandbox.filesystem`。不要为某个工具单独维护另一套 allow/deny 规则。
- 所有工具调用必须先规范化为 capability request，再由 policy 作出 `deny`、`native`、`sandboxed` 或 `review` 决策。
- 配置不能有隐藏安全默认值。任何有安全含义的行为都必须出现在 effective configuration 中，或从显式配置经过可审计 compile 步骤派生。
- `bash` 默认走 `sandbox-runtime`。只有显式 `bypassSandbox: true` 才能触发 reviewer。
- reviewer 只能用于 explicit bypass，且必须 fail closed：超时、异常、输出非法或拒绝时都不能放行。
- reviewer 的证据收集工具不得拥有比 parent policy 更宽的读取权限，也不得拥有写入或 bypass 能力。
- 每个 sandboxed command 退出后都必须调用 `SandboxManager.cleanupAfterCommand()`（通过 `SandboxSession.prepareCommand()` 返回的 `finish()` 方法），避免 Linux sandbox backend 在 host 上留下空白 mount point 文件。
- audit event 只能记录结构化元数据和决策结果，不能写入 secret file contents。

## 工作方式

代码按 ports/adapters + functional core 思路组织。外层 adapter 可以依赖 Pi SDK 和 `sandbox-runtime`；内层 config/policy 逻辑应尽量只处理普通 typed object，便于单元测试和安全审计。

修改工具行为时必须保持统一流程：先把工具参数规范化为 capability request，再由 policy 作唯一决策，最后根据 decision 执行或拒绝。

不要让 `read`、`write`、`edit`、`grep`、`find`、`ls` 各自发明权限检查。路径、symlink、搜索范围和列表目标检查都应回到同一份 path policy；`denyRead` 的 list/search 边界语义见 [docs/config.md](docs/config.md)。

## 边界约定

- config：查找、加载、校验并 compile 配置；安全相关默认值必须可审计。
- policy：解释 effective configuration，对 capability request 作唯一安全决策。
- runtime：封装 `sandbox-runtime` 和 sandboxed command 的进程执行细节。
- tools：Pi 工具适配层，只负责参数转换、调用 policy 和返回执行结果。
- review：只处理 explicit bypass 审批，并使用受限证据收集工具。
- audit/errors：统一结构化审计事件和 typed errors。

## 配置模型

使用 single-config 模型：

- 项目配置存在时使用项目配置。
- 否则使用全局配置。
- 两者都不存在时禁用插件，并给出清晰原因。
- 不要 deep-merge 项目配置和全局配置。
- 不要隐式追加数组。
- 如果未来支持继承，只能通过显式 `extends` 字段。

## 测试要求

安全边界必须能被测试验证，不要只依赖人工检查。

- 修改 `config/` 或 `policy/` 时，必须补充纯单元测试。
- 修改 `runtime/` 或 `SandboxManager` 封装时，必须补充真实 `sandbox-runtime` 集成测试。
- 修改 `tools/` 或 `review/` 时，至少要有 adapter contract 测试，验证请求会进入统一 policy。
- 常规本地测试不应依赖真实 Pi 运行环境；Pi 相关行为优先用 mock context 和 contract test 覆盖。
- `sandbox-runtime` 集成测试是 v1 的关键验收测试，尤其要覆盖文件系统 deny、cleanup 和 fail closed。

## 实现优先级

优先保证安全语义正确，其次才是兼容性和易用性。遇到不确定行为时默认拒绝或禁用，并用 typed error 和 audit event 说明原因。

新增功能前先确认它不会破坏这些边界：

- 是否仍由 config 表达用户意图？
- 是否仍由 policy 作唯一决策？
- 是否仍由同一份 path policy 约束所有文件访问？
- 是否仍能在失败时 fail closed？
