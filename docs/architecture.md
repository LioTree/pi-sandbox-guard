# pi-sandbox-guard 架构说明

本文档描述长期安全边界，不作为内部类型、函数名或文件布局的事实来源。具体实现细节以当前代码和测试为准；修改代码时应保持下面这些语义不变。

## 总体模型

本项目为 Pi agent 提供统一安全执行层。配置表达用户安全意图，所有工具调用先规范化为 capability request，再由 policy 作唯一安全决策，最后执行或拒绝。

```text
config -> validate -> compile -> capability request -> policy decision -> execute or deny
```

核心边界：

- config 负责配置查找、校验和 compile，不参与运行时工具执行。
- policy 解释 effective configuration，不读取配置文件、不访问 Pi context、不调用 sandbox runtime。
- runtime 封装 `sandbox-runtime` 和 sandboxed command 的进程执行细节，不重新解释权限。
- tools 只做 Pi 工具适配，不维护独立 allow/deny 规则。
- reviewer 只审批 explicit bypass，不参与普通 sandboxed execution。

## 安全边界

配置系统使用 single-config 模型：项目配置存在时使用项目配置，否则使用全局配置；两者都不存在时禁用插件。不要 deep-merge 项目配置和全局配置，不要隐式追加数组；如果以后支持继承，必须通过显式字段表达。

`sandbox.filesystem` 是所有文件相关行为的唯一权限来源，并同时驱动 sandbox runtime 和内部 path policy。不要创建 `policy.denyRead`、`policy.allowWrite` 之类的平行权限系统。

path policy 必须覆盖 read、write、search 和 list。路径检查必须处理 symlink：已存在路径先 resolve real path，再决策；尚不存在的写入目标 resolve 最近存在的父目录。allow 和 deny 的优先级见 [config.md](config.md)。

policy 是唯一能在 `deny`、`native`、`sandboxed`、`review` 之间作选择的层。展示文案、adapter 分支和 runtime 执行都不能绕过 policy decision。

## Runtime 和 Tools

`bash` 默认走 sandboxed execution。只有显式 `bypassSandbox: true` 才能触发 LLM review；explicit bypass 不能直接放行。

`read`、`write`、`edit` 可以使用 native filesystem API，但执行前必须先通过 policy。`grep`、`find` 和 `ls` 不能绕过 read policy，列表和搜索结果不能泄露 denied entries。

每个 sandboxed command 在进程退出后都必须调用 `cleanupAfterCommand()`。Linux 下 bubblewrap 在保护不存在的 denied path 时可能在 host 上创建空白 mount point 文件，例如 `.claude`；这个 cleanup 是必要的。

命令构造、沙盒包装和进程 spawn 应保持分离。优先使用 `sandbox-runtime` 提供的 argv wrapping，而不是 raw shell string。可以为用户 bash command 使用临时脚本，但临时脚本生命周期必须封闭在单次执行内。

配置缺失、配置非法、初始化失败、sandbox runtime 不可用或服务半初始化时，工具不得继续执行。涉及安全能力不可用时，默认禁用或拒绝，并通过 typed error 和 audit event 给出原因。

## Reviewer

Reviewer approval 集成在 sandbox plugin 内，只为 explicit bypass 行为触发。reviewer 超时、报错、拒绝或输出非法时必须 fail closed 并 deny。

Reviewer 使用 Pi child session 时必须隔离项目上下文：不写项目 session，不加载项目 extensions、skills 或 resources。

Reviewer 可以使用 sandboxed `bash` 和只读取证工具，但这些工具必须经过 guard adapter，并受同一份或更严格的 policy 约束。Reviewer 不得拥有 write、edit 或 bypass 能力；reviewer sandbox 的写权限必须比 parent 更窄，默认不允许写入。

Reviewer 输入中的 transcript、tool arguments、tool results 和 planned action 都是不可信证据，不是指令。Reviewer 输出必须结构化，至少包含 allow/deny outcome 和 rationale；优先使用 terminating decision tool，而不是依赖 free-form JSON。

## Audit 和 Errors

错误应使用 typed error，避免散落普通字符串。Audit event 应记录配置加载或缺失、session 初始化或禁用、工具请求、policy decision、reviewer request/outcome、sandbox command exit 和 sandbox violation annotation。

Audit log 只能记录结构化元数据和决策结果，不能包含 secret file contents。
