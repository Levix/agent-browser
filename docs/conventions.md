# 语义化操作系统约定

本文档定义 agent-browser 语义化操作系统的命名规范、版本规范和配置约定。

## CLI 命令规范

### action 子命令

所有语义化操作相关的命令都在 `action` 子命令下：

```bash
agent-browser action <subcommand> [options]
```

支持的子命令：

- `list [namespace]` - 列出所有可用操作，可选按 namespace 过滤
- `describe <action>` - 获取指定操作的详细定义（支持 --json 输出）
- `run <action>` - 执行指定操作（支持 --param key=value 传参）
- `validate <file>` - 校验 YAML 定义文件的合法性
- `search <keyword>` - 按关键词搜索操作
- `reload` - 重新加载操作定义
- `dry-run <action>` - 干跑模式（仅解析不执行）
- `debug <action>` - 调试模式（输出详细执行日志）

### 操作命名规范

操作使用三段式命名：`namespace:component:action`

- `namespace`: 命名空间，通常是组件库或业务名称（如 `common`、`eresh`）
- `component`: 组件名称（可选，如 `form`、`dialog`）
- `action`: 具体操作名称（如 `login`、`submit`、`close`）

示例：
- `common:login` - 通用登录操作
- `common:form:submit` - 通用表单提交
- `eresh:dialog:close` - Eresh 对话框关闭

## YAML Schema 版本规范

### 版本号

当前 YAML schema 版本：**1**

所有操作定义文件必须在顶层声明：

```yaml
schema_version: 1
```

### 版本兼容性

- Minor 版本更新（1.x）保持向后兼容
- Major 版本更新（2.x）可能引入破坏性变更
- 加载器会检查 schema_version 并拒绝不兼容的文件

## 配置文件优先级

配置来源按以下优先级加载（后者覆盖前者）：

1. **内置配置** - agent-browser 内置的默认配置
2. **用户全局配置** - `~/.agent-browser/config.yaml`
3. **项目配置** - 项目根目录 `.agent-browser/config.yaml`
4. **环境变量** - 以 `AGENT_BROWSER_` 开头的环境变量

### 配置文件格式

```yaml
# 操作系统配置
actions:
  # 额外加载路径（支持多个）
  paths:
    - ./custom-actions
    - ~/shared-actions
  
  # npm 包引用（未来支持）
  packages:
    - "@myorg/browser-actions"
  
  # 默认超时配置（毫秒）
  default_timeout: 30000
  
  # 最大递归深度
  max_depth: 10
  
  # 最大步骤数
  max_steps: 100
  
  # 调试模式
  debug: false
  
  # 版本检测
  detect_version: true
```

### 环境变量

支持的环境变量：

- `AGENT_BROWSER_ACTIONS_PATH` - 操作定义路径（多个路径用 `:` 分隔）
- `AGENT_BROWSER_ACTIONS_DEBUG` - 调试模式（true/false）
- `AGENT_BROWSER_ACTIONS_TIMEOUT` - 默认超时（毫秒）
- `AGENT_BROWSER_ACTIONS_MAX_DEPTH` - 最大递归深度

## 操作定义目录结构

### 内置操作

内置操作定义存放在项目根目录 `actions/` 目录下：

```
actions/
  common.yaml       # 通用操作（登录、表单等）
  eresh.yaml        # Eresh 组件库操作
  _config.yaml      # 命名空间级配置（可选）
```

### 用户自定义操作

用户可以在以下位置添加自定义操作：

1. 全局目录：`~/.agent-browser/actions/`
2. 项目目录：`.agent-browser/actions/`

### 文件组织方式

支持两种组织方式：

**方式一：单文件（推荐小规模）**
```
actions/
  common.yaml       # 包含多个操作
  eresh.yaml
```

**方式二：目录（推荐大规模）**
```
actions/
  common/
    _config.yaml    # 命名空间配置
    login.yaml      # 单个操作
    form.yaml
  eresh/
    _config.yaml
    dialog.yaml
    table.yaml
```

## 依赖库规范

### Node.js 依赖

| 库名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| yaml | ^2.3.0 | ISC | YAML 解析 |
| zod | ^3.22.0 | MIT | Schema 校验 |
| semver | ^7.5.0 | ISC | 版本比较 |

### Rust 依赖

Rust CLI 不直接解析 YAML，所有操作定义的解析和执行都在 Node.js daemon 侧完成。

Rust CLI 只负责：
- 命令行参数解析
- 与 daemon 的 JSON 协议通信
- 输出格式化

## 安全约定

### 表达式安全

- 禁止使用 `eval()`、`Function()` 等动态代码执行
- 仅支持有限的操作符白名单
- 禁止访问原型链（`__proto__`、`constructor`、`prototype`）

### 参数脱敏

标记为 `secret: true` 的参数在日志中自动脱敏：

```yaml
params:
  - name: password
    type: string
    required: true
    secret: true  # 日志中显示为 ****
```

### 资源限制

默认限制：

- 最大递归深度：10
- 最大步骤数：100
- 单步超时：30秒
- 整体超时：5分钟

## 错误码规范

所有错误使用标准错误码：

- `ACTION_NOT_FOUND` - 操作不存在
- `VALIDATION_ERROR` - 校验失败
- `PARAM_MISSING` - 参数缺失
- `PARAM_TYPE_ERROR` - 参数类型错误
- `SELECTOR_NOT_FOUND` - 选择器不存在
- `ELEMENT_NOT_FOUND` - 元素未找到
- `TIMEOUT` - 超时
- `VERIFY_FAILED` - 验证失败
- `EXPRESSION_ERROR` - 表达式错误
- `MAX_DEPTH_EXCEEDED` - 超过最大深度

错误信息格式：

```json
{
  "code": "ELEMENT_NOT_FOUND",
  "message": "Element not found: login button",
  "step": 3,
  "action": "common:login",
  "sourcePath": "actions/common.yaml",
  "suggestion": "Check if the selector is correct or try using fallback selectors"
}
```

## 调试约定

### Dry-Run 模式

使用 `--dry-run` 标志仅解析不执行：

```bash
agent-browser action dry-run common:login --param username=test
```

输出执行计划而不实际执行操作。

### Debug 模式

使用 `--debug` 标志输出详细日志：

```bash
agent-browser action debug common:login --param username=test
```

包含：
- 操作加载信息
- 参数解析结果
- 每步执行详情
- 变量上下文快照
- 选择器降级过程

## 版本管理约定

### 组件版本检测

支持以下检测方式（按优先级）：

1. `window.__<NAMESPACE>_VERSION__` 全局变量
2. `<meta name="<namespace>-version" content="1.2.3">` meta 标签
3. 自定义检测脚本（通过配置指定）

### 版本覆盖

操作定义支持按版本覆盖选择器：

```yaml
compatibility:
  min_version: "1.0.0"
  max_version: "2.0.0"
  version_overrides:
    "1.x":
      selectors:
        login_button:
          primary: "button.login-v1"
    "2.x":
      selectors:
        login_button:
          primary: "button[data-testid='login']"
```

## 扩展约定

### 自定义 step action

未来支持注册自定义 step action：

```typescript
// 插件方式注册
registerStepAction('http', async (args, context) => {
  // 自定义实现
});
```

### npm 包发布

用户可以将操作定义打包为 npm 包：

```json
{
  "name": "@myorg/browser-actions",
  "version": "1.0.0",
  "files": ["actions/**/*.yaml"]
}
```

在配置中引用：

```yaml
actions:
  packages:
    - "@myorg/browser-actions"
```

---

本约定文档随设计文档同步更新，确保实现与规范保持一致。
