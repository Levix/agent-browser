# agent-browser 扩展命令系统设计文档

## 背景
当前架构是 Rust CLI 解析命令，然后将 JSON 发送给 daemon，daemon 通过 Playwright 执行动作。内置命令固定且集中在 `cli/src/commands.rs` 解析。

需求：支持团队将内部组件库指令、常用登录流程等封装为一等命令，并支持多级子命令，例如：

```
agent-browser antd table.getRow <selector> 0
```

## 目标
- 提供可注册的扩展系统，新增顶层命令（如 `antd`、`login`、`corp`）。
- 支持子命令、帮助文档、参数校验和示例。
- 扩展命令可映射为现有内置动作，或执行自定义逻辑。
- 兼容现有 CLI 行为，性能保持快速。

## 非目标
- 不改造现有 daemon 协议和核心执行模型。
- 默认不开放任意 OS 命令执行，避免安全风险。

## 用户故事
- 团队可以统一封装 `antd table.getRow` 并在多个项目复用。
- 企业可以配置白名单，只允许可信扩展。
- `agent-browser --help` 与 `agent-browser antd --help` 能展示扩展帮助信息。

## 总体架构

### 1) 扩展注册表
- 聚合内置命令和外部扩展命令。
- 命令解析优先级：内置命令 > 仓库级扩展 > 用户级扩展。

### 2) 扩展类型
- **宏扩展**：将扩展命令映射到一组已有内置动作。
- **外部可执行扩展**：CLI 启动外部插件进程，通过结构化 I/O 交互。
- **daemon 侧扩展（可选后续）**：用于更深度浏览器控制或性能需求。

### 3) 命令解析流程
```
args → parse_flags → command_name
if 内置命令:
  走现有解析
else:
  查找扩展注册表
  找到则交给扩展执行器
  否则返回 UnknownCommand
```

## 扩展打包与发现

### 扩展清单
- 文件名：`extension.json` 或 `extension.yaml`。
- 示例：
```json
{
  "name": "antd",
  "version": "1.0.0",
  "description": "Ant Design helpers",
  "commands": [
    {
      "name": "table.getRow",
      "description": "Return nth row text from an Antd table",
      "args": [
        { "name": "selector", "type": "string", "required": true },
        { "name": "index", "type": "int", "required": true, "default": 0 }
      ],
      "handler": {
        "type": "macro",
        "steps": [
          { "action": "snapshot", "selector": "{{selector}}", "compact": true },
          { "action": "nth", "selector": "{{selector}} tbody tr", "index": "{{index}}", "subaction": "text" }
        ]
      }
    }
  ],
  "minCliVersion": "0.7.0"
}
```

### 搜索路径
- 仓库级：`.agent-browser/extensions/*/extension.json`
- 用户级：`%APPDATA%/agent-browser/extensions/*/extension.json`（Windows）
- 可选：`AGENT_BROWSER_EXTENSIONS_DIR` 覆盖默认路径

### 冲突规则
- 内置命令优先级最高。
- 多个扩展定义同名顶层命令时，优先仓库级；发生冲突时给出提示。

## 执行模型

### 1) 宏扩展（默认）
- 通过既有 JSON 协议执行多步内置动作。
- 支持模板变量替换，将参数映射到动作字段。

### 2) 外部可执行扩展
- 清单中 `handler.type: "external"`。
- `handler.command` 指定可执行程序或路径。
- CLI 与插件进程使用 JSON 交互：
  - 输入：`{ "command": "table.getRow", "args": {...}, "session": "...", "context": {...} }`
  - 输出：`{ "success": true, "data": ... }`
- 支持 Node/Go/Python 等语言实现扩展逻辑。

### 3) daemon 侧扩展（后续）
- 在 daemon 中加载扩展，提高执行性能，支持深度浏览器钩子。
- 需要定义插件 API 和安全沙箱策略。

## CLI 体验设计

### 帮助信息
- `agent-browser --help` 展示内置命令 + 扩展顶层命令。
- `agent-browser antd --help` 展示扩展子命令。
- `agent-browser help antd table.getRow` 展示参数与示例。

### 示例
```
agent-browser antd table.getRow ".ant-table" 0
agent-browser login sso --env staging
```

## 安全与信任

### 信任模型
- 默认只加载可信目录扩展。
- 允许使用白名单控制：
  - `AGENT_BROWSER_EXTENSIONS_ALLOW=antd,login`
  - 或仓库级 `.agent-browser/allow.json`

### 执行控制
- 宏扩展默认安全可用。
- 外部扩展需要 `--allow-plugins` 或白名单允许。

## 错误处理
- 未知扩展命令：返回 `UnknownCommand`。
- 参数缺失或错误：返回 `MissingArguments` 或 `InvalidValue`，并提供扩展帮助信息。
- 插件进程异常：返回 `ExtensionError`，包含退出码与 stderr（裁剪）。

## 兼容性与版本
- 清单字段：`minCliVersion`、可选 `maxCliVersion`。
- CLI 提示不兼容扩展。

## 可观测性
- `agent-browser plugins list`
- `agent-browser plugins info antd`
- `AGENT_BROWSER_DEBUG_EXTENSIONS=1` 输出扩展加载与解析日志。

## 迭代路线

### Phase 1：宏扩展
- 清单解析
- 宏执行器
- 帮助与列表展示

### Phase 2：外部可执行扩展
- stdin/stdout JSON 协议
- 白名单与安全开关

### Phase 3：daemon 侧扩展
- daemon 插件 API
- 沙箱策略与性能优化

## 待确认问题
- 子命令是否使用点号形式（`table.getRow`）还是层级形式（`table getRow`）？
- 是否需要扩展别名（alias）和参数默认值配置？
- 扩展是否允许定义全局参数（flags）？
