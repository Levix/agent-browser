# 语义化操作注册表实现计划（细粒度任务清单）

> 基于 [docs/design-v2.md](design-v2.md) 输出的可拆分 PR 级别计划，按阶段拆分为细粒度任务，便于人工 review 和逐步合并。
> 
> 本文档与设计文档同步更新，确保实现任务与设计规范一致。

---

## 0. 前置准备（Repo 级）

### 0.1 代码结构与约定

- [x] 新增目录结构（仅创建空目录）
  - [x] src/actions/
  - [x] actions/（内置操作定义目录）
- [x] 明确 CLI 命令命名规范（action list/describe/run/validate 等）
- [x] 明确 YAML schema 版本号（例如 `schema_version: 1`）
- [x] 明确默认配置来源（~/.agent-browser/config.yaml 与环境变量优先级）

### 0.2 依赖评估与引入

- [x] 确认 Node 侧 YAML 解析库：`yaml` ^2.3.0 (ISC)
- [x] 确认 Schema 校验库：`zod` ^3.22.0 (MIT)
- [x] 确认版本比较库：`semver` ^7.5.0 (ISC)
- [x] 确认 Rust 侧是否需要 YAML 解析（建议仅由 Node 侧解析）
- [x] 确认 CLI 与 daemon 通信协议需要新增 `action` 类型
- [x] 评估依赖库的安全性与许可证合规性

---

## 1. 数据结构与类型定义（TypeScript）

### 1.1 核心类型定义（src/actions/types.ts）

- [x] 定义 `ActionRegistry`
- [x] 定义 `ActionDefinition`
- [x] 定义 `ActionStep`
- [x] 定义 `ActionParam`
- [x] 定义 `ActionResult`
- [x] 定义 `ActionSelectorSet`
- [x] 定义 `ActionCompatibility`
- [x] 定义 `ActionError`（包含 code、step、message、details）

### 1.2 Schema 校验器（src/actions/validator.ts）

#### 1.2.1 基础 Schema 定义
- [x] 定义 YAML schema（使用 Zod）
- [x] 定义 `NamespaceFileSchema`（顶层结构）
- [x] 定义 `ActionDefinitionSchema`
- [x] 定义 `ActionStepSchema`（支持递归 fallback）
- [x] 定义 `ActionParamSchema`

#### 1.2.2 结构校验
- [x] 校验文件级字段（namespace/version/description）
- [x] 校验 actions 字段完整性
- [x] 校验 step 结构（action/args/when/timeout 等）
- [x] 校验 params 类型与默认值
- [x] 校验 selectors 定义（支持 primary/fallback）

#### 1.2.3 深度校验
- [x] 校验参数引用的合法性
- [x] 校验选择器引用的存在性
- [x] 校验 step action 的合法性
- [x] 校验表达式语法（when/verify）
- [x] 检测 fallback 循环引用
- [x] 检测 action 递归调用（run）

#### 1.2.4 运行时校验
- [x] 实现 `validateParams` 运行时参数校验
- [x] 类型检查与转换
- [x] 必填参数检查
- [x] 枚举值检查

### 1.3 变量插值与表达式系统（src/actions/vars.ts）

#### 1.3.1 变量插值
- [x] 实现 `${var}` 基础插值功能
- [x] 支持多层级路径访问（`params.user.name`）
- [x] 支持 `params.*`、`selectors.*`、`env.*`、`steps.*` 四大作用域
- [x] 实现 `resolveObject` 递归解析对象中的所有字符串
- [x] 防止原型链污染（拒绝 `__proto__`、`constructor`、`prototype`）

#### 1.3.2 表达式解析与求值
- [x] 实现词法分析器（Tokenizer）
- [x] 实现递归下降语法解析器（Parser）
- [x] 实现 AST 求值器（Evaluator）
- [x] 支持比较操作符（`==`, `!=`, `>`, `<`, `>=`, `<=`）
- [x] 支持逻辑操作符（`&&`, `||`, `!`）
- [x] 支持括号分组
- [x] 实现类型转换（toBoolean、toNumber）

#### 1.3.3 安全限制
- [x] 禁止函数调用
- [x] 禁止对象/数组字面量
- [x] 禁止赋值操作
- [x] AST 深度限制（防止递归攻击）
- [x] 操作符白名单检查
- [x] 错误位置标注（Token position）

---

## 2. Action Registry（加载与合并）

### 2.1 Loader（src/actions/loader.ts）

- [x] 支持多路径加载（内置、用户、项目、环境变量）
- [x] 支持目录扫描（*.yaml, *.yml）
- [x] 支持单文件/目录混用
- [x] 支持 `_config.yaml` 的 `extends/overrides`

### 2.2 Merge 规则（src/actions/registry.ts）

- [x] 后加载覆盖先加载
- [x] 同名 action 覆盖
- [x] 同名 selector 覆盖
- [x] 记录来源路径（用于 debug）

### 2.3 Index 索引（src/actions/registry.ts）

- [x] 按 `namespace:component:action` 建索引
- [x] 按 `namespace` 聚合
- [x] 按关键词搜索索引（description/params）

---

## 3. 版本管理与兼容性

### 3.1 版本检测（src/actions/version.ts）

- [x] 实现 `detectComponentVersion(page, namespace)`
- [x] 支持 `window.__ERESH_VERSION__` / meta tag / 全局对象检测
- [x] 提供可插拔版本检测策略

### 3.2 兼容性选择（src/actions/version.ts）

- [x] 解析 `compatibility.min_version/max_version`
- [x] 判断版本是否兼容
- [x] 应用 `version_overrides` 到 selectors
- [x] 实现高级集成函数（getCompatibleAction, isNamespaceCompatible, selectBestAction）

### 3.3 选择器降级策略（src/actions/selectors.ts）

- [x] 支持 `primary/fallback` 选择器链
- [x] 执行失败时自动降级并重试

---

## 4. 执行器（Action Executor）

### 4.1 Step 执行引擎（src/actions/executor.ts）

#### 4.1.1 基础执行
- [x] 支持 action step 解析与执行
- [x] 支持 `when` 条件判断
- [x] 支持 `timeout` 覆盖
- [x] 支持 `output` 字段输出到 context
- [x] 支持 step 之间的数据传递

#### 4.1.2 错误处理与重试
- [x] 支持 `retry` 重试机制
- [x] 支持 `on_error` 策略（continue/abort/fallback）
- [x] 支持 `fallback` 子步骤
- [x] 实现指数退避重试
- [x] 捕获并转换 Playwright 错误

#### 4.1.3 安全与资源限制
- [x] 实现递归深度限制（max_depth: 10）
- [x] 实现单步超时控制（step_timeout: 30s）
- [x] 实现整体超时控制（action_timeout: 5min）
- [x] 实现最大步骤数限制（max_steps: 100）
- [x] 防止无限循环调用

#### 4.1.4 调试与追踪
- [x] 实现 dry-run 模式（仅解析不执行）
- [x] 实现 debug 模式（详细日志输出）
- [x] 实现 step tracing（记录每步执行信息）
- [x] 实现 context dump（错误时输出完整上下文）
- [x] 敏感参数脱敏（secret: true）

### 4.2 内置 step action 映射

- [x] `open` → navigate
- [x] `click` → click
- [x] `fill` → fill
- [x] `type` → type
- [x] `press` → press
- [x] `wait` → wait
- [x] `snapshot` → snapshot
- [x] `eval` → evaluate
- [x] `find` → semantic locator
- [x] `run` → 调用另一个 action
- [x] `fail` → 主动失败

### 4.3 结果聚合与返回（executor.ts）

- [x] 收集 step 输出（output 字段）
- [x] 执行 `returns` 表达式
- [x] 执行 `verify` 校验
- [x] 返回结构化结果

---

## 5. CLI 层新增命令（Rust）

### 5.1 子命令解析（cli/src/commands.rs）

- [ ] 新增 `action` 子命令入口
- [ ] 实现 `action list [namespace]` - 列出可用操作
- [ ] 实现 `action describe <action> [--json]` - 获取操作定义
- [ ] 实现 `action run <action> [--param key=value]` - 执行操作
- [ ] 实现 `action validate <file>` - 校验定义文件
- [ ] 实现 `action search <keyword>` - 关键词搜索
- [ ] 实现 `action reload` - 重新加载定义
- [ ] 实现 `action dry-run <action>` - 干跑模式
- [ ] 实现 `action debug <action>` - 调试模式
- [ ] 参数解析与错误提示
- [ ] 支持 `--json` 输出格式

### 5.2 CLI 输出格式（cli/src/output.rs）

- [ ] 表格化输出
- [ ] `--json` 输出结构
- [ ] 错误格式统一

### 5.3 CLI → daemon 协议

- [ ] 定义 `action.*` 的 JSON 指令格式
- [ ] 补充 `Command` 类型（src/types.ts）

---

## 6. daemon 侧协议与服务

### 6.1 新增命令类型（src/types.ts）

- [ ] `ActionListCommand` - 列出操作
- [ ] `ActionDescribeCommand` - 获取操作定义
- [ ] `ActionRunCommand` - 执行操作
- [ ] `ActionDryRunCommand` - 干跑模式
- [ ] `ActionDebugCommand` - 调试模式
- [ ] `ActionValidateCommand` - 校验定义文件
- [ ] `ActionSearchCommand` - 关键词搜索
- [ ] `ActionReloadCommand` - 重新加载
- [ ] 定义各命令的参数和返回值类型

### 6.2 服务入口（src/actions/index.ts）

- [ ] 暴露 `list/describe/run/validate/search/reload` API
- [ ] 与 `browser.ts`/`actions.ts` 交互

### 6.3 注册到 command router

- [ ] 在 daemon 请求路由中注册 action 相关命令
- [ ] 将 command 转发到 Action Registry Service

---

## 7. 配置与路径解析

### 7.1 配置文件

- [ ] 支持 `~/.agent-browser/config.yaml` 全局配置
- [ ] 支持项目级 `.agent-browser/config.yaml`
- [ ] 支持 `actions.paths` - 额外加载路径
- [ ] 支持 `actions.packages` - npm 包引用
- [ ] 支持 `default_timeout` - 默认超时
- [ ] 支持 `max_depth` - 最大递归深度
- [ ] 支持 `max_steps` - 最大步骤数
- [ ] 支持 `debug` - 调试模式开关
- [ ] 支持 `detect_version` - 版本检测开关

### 7.2 环境变量

- [ ] `AGENT_BROWSER_ACTIONS_PATH` - 操作定义路径
- [ ] `AGENT_BROWSER_ACTIONS_DEBUG` - 调试模式
- [ ] `AGENT_BROWSER_ACTIONS_TIMEOUT` - 超时配置
- [ ] `AGENT_BROWSER_ACTIONS_MAX_DEPTH` - 最大深度

### 7.3 路径解析与优先级

- [ ] 实现配置加载优先级（环境变量 > 项目 > 用户 > 内置）
- [ ] 实现路径规范化（统一为 POSIX 风格）
- [ ] 实现相对路径解析
- [ ] 实现波浪线（~）展开

---

## 8. 内置操作定义

### 8.1 common.yaml

- [ ] 创建 [actions/common.yaml](actions/common.yaml)
- [ ] 定义 `common:login`、`common:form:submit` 等最小可用操作

### 8.2 eresh 初始版本（可选先空）

- [ ] 预留 `actions/eresh.yaml`（可先放空）

---

## 9. 错误处理与调试

### 9.1 错误类型与映射

- [ ] 定义完整的错误码枚举（ActionErrorCode）
  - [ ] `ACTION_NOT_FOUND` - 操作不存在
  - [ ] `VALIDATION_ERROR` - 校验失败
  - [ ] `PARAM_MISSING` - 参数缺失
  - [ ] `PARAM_TYPE_ERROR` - 参数类型错误
  - [ ] `SELECTOR_NOT_FOUND` - 选择器不存在
  - [ ] `ELEMENT_NOT_FOUND` - 元素未找到
  - [ ] `TIMEOUT` - 超时
  - [ ] `VERIFY_FAILED` - 验证失败
  - [ ] `EXPRESSION_ERROR` - 表达式错误
  - [ ] `MAX_DEPTH_EXCEEDED` - 超过最大深度
- [ ] 实现 Playwright 错误映射
- [ ] 标注 `step`、`action`、`sourcePath` 信息
- [ ] 提供错误建议（suggestion）
- [ ] 实现错误堆栈追踪

### 9.2 调试功能

#### 9.2.1 Dry-Run 模式
- [ ] 实现参数解析（不执行）
- [ ] 实现流程输出（显示执行计划）
- [ ] 实现变量插值预览
- [ ] 输出预期的步骤序列

#### 9.2.2 Debug 模式
- [ ] 打印操作加载信息
- [ ] 打印参数解析结果
- [ ] 打印每步执行详情（输入、输出、耗时）
- [ ] 打印上下文变量快照
- [ ] 打印选择器降级过程
- [ ] 打印版本检测结果

#### 9.2.3 Step Tracing
- [ ] 记录每步开始时间
- [ ] 记录每步结束时间
- [ ] 记录每步执行状态
- [ ] 记录每步返回值
- [ ] 生成执行时间线

---

## 10. 文档与 SKILL 集成

### 10.1 SKILL.md 更新

- [ ] 添加 `action list/describe/run` 使用示例
- [ ] 强调优先使用语义化操作

### 10.2 README.md 更新

- [ ] 新增 “Semantic Actions” 章节
- [ ] 提供最小示例

---

## 11. 测试与验证

### 11.1 单元测试（Node）

#### 11.1.1 Validator 测试
- [ ] 合法 YAML 配置测试
- [ ] 非法 YAML 配置测试
- [ ] 循环引用检测测试
- [ ] 表达式语法校验测试
- [ ] 参数类型校验测试

#### 11.1.2 变量插值测试
- [ ] 基础插值测试
- [ ] 多层级路径访问测试
- [ ] 各作用域变量测试（params/env/selectors/steps）
- [ ] 原型链污染防护测试
- [ ] 边界情况测试（undefined、null）

#### 11.1.3 表达式解析测试
- [ ] 词法分析器测试
- [ ] 语法解析器测试
- [ ] 求值器测试
- [ ] 操作符优先级测试
- [ ] 类型转换测试
- [ ] 错误定位测试

#### 11.1.4 Registry 测试
- [ ] 单文件加载测试
- [ ] 多文件加载测试
- [ ] 继承（extends）测试
- [ ] 合并覆盖测试
- [ ] npm 包加载测试

#### 11.1.5 安全性测试
- [ ] 表达式注入防护测试
- [ ] 函数调用拦截测试
- [ ] 路径遍历防护测试
- [ ] 资源限制测试（深度、步骤数、超时）

### 11.2 集成测试

#### 11.2.1 Mock 设计
- [ ] 实现 `MockBrowserAdapter`
- [ ] 模拟 click/fill/type/wait 等操作
- [ ] 记录调用历史
- [ ] 支持可配置的返回值

#### 11.2.2 执行器测试
- [ ] 基础步骤执行测试
- [ ] 条件判断测试（when）
- [ ] 重试机制测试
- [ ] 降级机制测试（fallback）
- [ ] 错误处理测试（on_error）
- [ ] 递归调用测试（run）
- [ ] 超时测试

#### 11.2.3 E2E 测试
- [ ] `action list` 命令测试
- [ ] `action describe` 命令测试
- [ ] `action run` 命令测试
- [ ] `action validate` 命令测试
- [ ] `action search` 命令测试
- [ ] 选择器降级链测试
- [ ] 版本覆盖测试
- [ ] 真实浏览器测试（Sample App）

---

## 12. PR 切分建议（建议顺序）

1. **PR-01**: 新增 src/actions 目录与核心类型定义
   - 创建目录结构
   - 定义 types.ts 中的所有接口
   - 定义错误码枚举

2. **PR-02**: 变量插值与表达式系统（vars.ts）
   - 实现词法分析器
   - 实现语法解析器
   - 实现求值器
   - 安全限制
   - 单元测试

3. **PR-03**: YAML schema + validator
   - Zod Schema 定义
   - 结构校验
   - 深度校验
   - 循环检测
   - 单元测试

4. **PR-04**: Registry loader + merge
   - 文件加载
   - 继承解析
   - 合并逻辑
   - 索引构建
   - 单元测试

5. **PR-05**: Executor 最小实现
   - 基础步骤执行（open/click/fill/wait/snapshot）
   - 变量插值集成
   - 条件判断（when）
   - 基础错误处理
   - Mock 测试

6. **PR-06**: Executor 高级特性
   - 重试机制
   - 降级机制（fallback）
   - 递归调用（run）
   - 资源限制
   - 集成测试

7. **PR-07**: CLI action 子命令（list/describe/run/validate）
   - Rust 侧命令解析
   - 输出格式化
   - 协议定义

8. **PR-08**: Daemon 协议与服务路由
   - 扩展 Command 类型
   - 实现 action service
   - 注册路由
   - 集成测试

9. **PR-09**: 版本管理与选择器降级
   - 版本检测器
   - 版本覆盖应用
   - 选择器降级链
   - 单元测试

10. **PR-10**: 调试与诊断功能
    - Dry-run 模式
    - Debug 模式
    - Step tracing
    - Context dump
    - CLI debug/dry-run 子命令

11. **PR-11**: 安全加固
    - 表达式沙箱加固
    - 资源限制完善
    - 敏感参数脱敏
    - 安全测试

12. **PR-12**: 文档与内置操作
    - README 更新
    - SKILL.md 更新
    - actions/common.yaml
    - 使用示例

13. **PR-13**: E2E 测试与验收
    - 完整的 E2E 测试
    - 性能测试
    - 验收标准检查

---

## 13. 里程碑验收标准

### 13.1 功能完整性
- [ ] `action list` 能列出所有 namespace
- [ ] `action describe` 输出完整 schema（含参数、步骤、兼容性）
- [ ] `action run` 可执行包含 `find/click/wait/snapshot` 的操作
- [ ] `action search` 能按关键词搜索操作
- [ ] `action validate` 能校验 YAML 文件并输出详细错误
- [ ] `action reload` 能重新加载定义
- [ ] 支持 `.agent-browser/actions/` 覆盖
- [ ] 支持 `extends` 继承机制
- [ ] 支持 `version_overrides` 与 selector fallback

### 13.2 执行引擎
- [ ] 支持所有内置 step action（open/click/fill/type/press/wait/snapshot/find/eval/run/fail）
- [ ] 支持变量插值（params/env/selectors/steps）
- [ ] 支持条件判断（when）
- [ ] 支持重试机制（retry）
- [ ] 支持降级机制（fallback）
- [ ] 支持递归调用（run）且有深度限制
- [ ] 支持结果验证（verify）

### 13.3 安全性
- [ ] 表达式不能执行任意代码（禁止 eval）
- [ ] 防止原型链污染
- [ ] 资源限制生效（深度、步骤数、超时）
- [ ] 敏感参数脱敏（secret: true）
- [ ] 路径遍历防护

### 13.4 调试性
- [ ] `action dry-run` 能输出执行计划而不实际执行
- [ ] `action debug` 能输出详细的执行日志
- [ ] 错误信息包含 step、action、sourcePath
- [ ] 错误信息提供修复建议（suggestion）
- [ ] Step tracing 记录完整执行信息

### 13.5 可测试性
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试覆盖主要场景
- [ ] E2E 测试通过真实浏览器验证
- [ ] Mock 机制工作正常

### 13.6 文档完整性
- [ ] README 包含 Semantic Actions 章节
- [ ] SKILL.md 包含 action 命令使用示例
- [ ] 至少有 3 个可用的内置操作（common.yaml）
- [ ] 有完整的 YAML schema 文档

---

## 14. 风险与对策

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| YAML 格式复杂 | 维护成本高 | 中 | 提供 schema 校验 + 示例模板 + 文档 |
| 选择器失效 | 操作失败 | 高 | 版本覆盖 + 选择器降级链 + 多级 fallback |
| 执行器复杂 | Bug 多 | 中 | 小步迭代 + dry-run + debug + 充分测试 |
| 业务扩展混乱 | 命名冲突 | 中 | namespace 强制约束 + 覆盖策略 |
| 表达式注入攻击 | 安全风险 | 高 | 禁用 eval + 操作符白名单 + 原型链防护 |
| 资源耗尽 | 服务不可用 | 中 | 深度限制 + 步骤数限制 + 超时控制 |
| 性能开销 | 启动变慢 | 低 | 懒加载 + 索引缓存 + 性能优化 |
| 版本检测失败 | 选择器不适配 | 中 | 提供默认配置 + 可插拔检测策略 |
| 循环依赖 | 执行死循环 | 低 | 循环检测 + 深度限制 |
| 依赖库安全漏洞 | 供应链风险 | 低 | 定期更新 + 漏洞扫描 |

---

## 15. 交付物清单

### 15.1 代码实现
- [x] src/actions/types.ts - 核心类型定义
- [x] src/actions/vars.ts - 变量插值与表达式系统（完整实现）
- [x] src/actions/validator.ts - Schema 校验器（基础 Schema 定义）
- [x] src/actions/loader.ts - 文件加载器（完整实现）
- [x] src/actions/registry.ts - Registry 服务（合并规则、索引、搜索）
- [ ] src/actions/executor.ts - 执行引擎
- [x] src/actions/version.ts - 版本管理器（完整实现，含高级集成函数）
- [x] src/actions/selectors.ts - 选择器管理器（完整实现，含降级策略）
- [ ] src/actions/index.ts - 统一导出
- [ ] src/types.ts - Command 类型扩展

### 15.2 CLI 实现
- [ ] cli/src/commands.rs - action 子命令
- [ ] cli/src/output.rs - 输出格式化
- [ ] bin/agent-browser - CLI 入口（更新）

### 15.3 操作定义
- [ ] actions/common.yaml - 通用操作
- [ ] actions/eresh.yaml - Eresh 组件库操作（可选）
- [ ] 示例操作定义（docs/examples/）

### 15.4 配置文件
- [ ] 全局配置示例（~/.agent-browser/config.yaml.example）
- [ ] 项目配置示例（.agent-browser/config.yaml.example）

### 15.5 测试
- [x] src/actions/vars.tokenizer.test.ts - 词法分析器测试
- [x] src/actions/vars.parser.test.ts - 语法解析器测试
- [x] src/actions/vars.evaluator.test.ts - 求值器测试
- [x] src/actions/validator.test.ts - Schema 校验器测试
- [x] src/actions/loader.test.ts - 加载器测试（完整实现）
- [x] src/actions/registry.test.ts - Registry 测试（合并规则、查询、搜索）
- [x] src/actions/version.test.ts - 版本检测与兼容性测试（43 个测试全部通过）
- [x] src/actions/selectors.test.ts - 选择器降级策略测试（40 个测试全部通过）
- [ ] src/actions/*.test.ts - 其他单元测试
- [ ] test/actions-e2e.test.ts - E2E 测试
- [ ] test/actions-security.test.ts - 安全性测试
- [ ] test/fixtures/ - 测试用例数据
- [ ] test/mocks/ - Mock 实现

### 15.6 文档
- [ ] README.md - 新增 Semantic Actions 章节
- [ ] docs/design-v2.md - 设计文档（已有）
- [x] docs/plan.md - 实施计划（本文档）
- [ ] docs/cases-v2.md - 使用场景（需创建）
- [ ] docs/api.md - API 参考（需创建）
- [ ] docs/yaml-schema.md - YAML Schema 文档（需创建）
- [x] docs/expression-evaluator.md - 表达式求值器使用文档
- [x] src/actions/README.version.md - 版本管理与兼容性使用文档
- [x] src/actions/README.selectors.md - 选择器降级策略使用文档
- [ ] skills/agent-browser/SKILL.md - 更新 AI Agent 使用指南

### 15.7 依赖
- [ ] package.json - 更新依赖（yaml, zod, semver）
- [ ] pnpm-lock.yaml - 锁定版本

### 15.8 CI/CD
- [ ] 测试流程（GitHub Actions）
- [ ] 安全扫描（npm audit）
- [ ] 代码覆盖率报告
