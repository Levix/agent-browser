# agent-browser 操作封装方案选型 (V2)

## 第一性原理分析

### 核心问题

当前 AI Agent 使用 agent-browser 存在以下问题：

1. **行为不确定性**: AI 每次执行相同操作（如打开弹框）时，可能采用不同的步骤，导致结果不稳定
2. **Token 浪费**: AI 需要反复思考如何执行常见操作，消耗大量推理 token
3. **时间开销**: 每次都要 snapshot → 分析 → 决策 → 执行，链路过长
4. **知识无法复用**: 人类已知的组件操作方式无法传递给 AI

### 设计目标

| 目标 | 说明 |
|------|------|
| **AI-First** | 操作封装是为 AI Agent 调用设计的，不是给人类终端用户 |
| **确定性行为** | 封装后的操作执行路径固定，消除 AI 决策的随机性 |
| **低封装成本** | 人类可以快速定义新操作，无需复杂编程 |
| **可发现性** | AI 能够知道有哪些可用的封装操作及其用途 |
| **可缓存/回放** | 执行成功后可缓存，后续直接回放，无需重新执行 |
| **可扩展性** | 易于为新组件库（如 eresh）添加操作定义 |

### 核心场景示例

**场景: eresh 组件库 - 打开弹框**

当前 AI 行为（不稳定）:
```
AI思考: 需要打开弹框，让我先看看页面...
→ snapshot -i
AI思考: 看到有个按钮叫"新建"，可能是触发弹框的...
→ click @e5
AI思考: 让我验证弹框是否打开...
→ snapshot -i
AI思考: 看到了弹框内容...
```

理想 AI 行为（确定性）:
```
AI思考: 需要打开弹框
→ agent-browser action eresh:dialog:open --trigger "新建"
返回: { success: true, dialogTitle: "新建项目" }
```

---

## 方案一: 语义化操作注册表 (Semantic Action Registry)

### 核心思想

建立一个**操作注册表**，人类预先定义组件的语义化操作，AI 通过查询注册表获取可用操作并直接调用。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│  "我需要打开一个弹框"                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Action Registry                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ eresh:dialog│  │ eresh:table │  │ eresh:form  │          │
│  │   :open     │  │   :sort     │  │   :submit   │          │
│  │   :close    │  │   :filter   │  │   :validate │          │
│  │   :confirm  │  │   :select   │  │   :reset    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   agent-browser daemon                       │
│  执行预定义的操作序列，返回结构化结果                          │
└─────────────────────────────────────────────────────────────┘
```

### 操作定义格式

**操作定义文件** (`~/.agent-browser/actions/eresh.yaml`):

```yaml
namespace: eresh
version: "1.0.0"
description: "eresh 组件库操作定义"

actions:
  dialog:open:
    description: "打开弹框"
    params:
      trigger:
        type: string
        description: "触发弹框的按钮文本或选择器"
        required: true
      waitFor:
        type: string
        description: "等待弹框中出现的文本"
        default: null
    
    steps:
      - action: find
        args:
          role: button
          name: "${trigger}"
        output: triggerButton
      
      - action: click
        args:
          selector: "${triggerButton}"
      
      - action: wait
        args:
          selector: ".eresh-dialog"
          timeout: 5000
      
      - action: snapshot
        args:
          selector: ".eresh-dialog"
          interactive: true
        output: dialogContent
    
    returns:
      success: true
      dialogTitle: "${dialogContent.title}"
      dialogRef: "${dialogContent.ref}"

  dialog:close:
    description: "关闭弹框"
    params:
      method:
        type: enum
        values: [button, escape, overlay]
        default: button
    
    steps:
      - when: "${method} == 'button'"
        action: click
        args:
          selector: ".eresh-dialog .close-button"
      
      - when: "${method} == 'escape'"
        action: press
        args:
          key: Escape
      
      - when: "${method} == 'overlay'"
        action: click
        args:
          selector: ".eresh-dialog-overlay"
      
      - action: wait
        args:
          hidden: ".eresh-dialog"
    
    returns:
      success: true

  dialog:confirm:
    description: "确认弹框操作"
    params:
      buttonText:
        type: string
        default: "确定"
    steps:
      - action: find
        args:
          role: button
          name: "${buttonText}"
          within: ".eresh-dialog"
        output: confirmButton
      - action: click
        args:
          selector: "${confirmButton}"
      - action: wait
        args:
          hidden: ".eresh-dialog"
    returns:
      success: true

  table:sort:
    description: "表格排序"
    params:
      column:
        type: string
        required: true
      order:
        type: enum
        values: [asc, desc]
        default: asc
    steps:
      - action: find
        args:
          role: columnheader
          name: "${column}"
        output: header
      - action: click
        args:
          selector: "${header}"
      - when: "${order} == 'desc'"
        action: click
        args:
          selector: "${header}"
      - action: wait
        args:
          load: networkidle
    returns:
      success: true
      sortedBy: "${column}"
      order: "${order}"
```

### CLI 接口

```bash
# 查看可用的操作命名空间
agent-browser action list
# 输出:
# Available namespaces:
#   eresh     - eresh 组件库操作定义 (12 actions)
#   antd      - Ant Design 操作定义 (8 actions)
#   common    - 通用操作定义 (5 actions)

# 查看某个命名空间的所有操作
agent-browser action list eresh
# 输出:
# eresh:dialog:open    - 打开弹框
# eresh:dialog:close   - 关闭弹框
# eresh:dialog:confirm - 确认弹框操作
# eresh:table:sort     - 表格排序
# ...

# 查看操作详情（给 AI 的 schema）
agent-browser action describe eresh:dialog:open --json
# 输出:
# {
#   "name": "eresh:dialog:open",
#   "description": "打开弹框",
#   "params": {
#     "trigger": { "type": "string", "required": true, "description": "触发弹框的按钮文本或选择器" },
#     "waitFor": { "type": "string", "required": false, "description": "等待弹框中出现的文本" }
#   },
#   "returns": { "success": "boolean", "dialogTitle": "string", "dialogRef": "string" }
# }

# 执行操作
agent-browser action run eresh:dialog:open --trigger "新建"
# 输出:
# { "success": true, "dialogTitle": "新建项目", "dialogRef": "@dialog1" }

# 注册新的操作定义
agent-browser action register ./my-actions.yaml
```

### AI Agent 集成

**更新 SKILL.md，添加操作发现能力**:

```markdown
## Semantic Actions (推荐)

对于已知组件库的操作，优先使用预定义的语义化操作：

### 发现可用操作
\`\`\`bash
agent-browser action list              # 列出所有命名空间
agent-browser action list <namespace>  # 列出命名空间下的操作
agent-browser action describe <action> # 获取操作详情
\`\`\`

### 执行操作
\`\`\`bash
agent-browser action run <action> [--param value...]
\`\`\`

### 示例
\`\`\`bash
# 打开弹框
agent-browser action run eresh:dialog:open --trigger "新建"

# 表格排序
agent-browser action run eresh:table:sort --column "创建时间" --order desc

# 提交表单
agent-browser action run eresh:form:submit --validate true
\`\`\`

**注意**: 使用语义化操作比手动执行 click/fill 更可靠，应优先使用。
```

### 优点

- AI 可直接调用语义化操作，无需决策底层步骤
- YAML 定义简单，封装成本低
- 操作可复用，支持命名空间隔离
- 返回结构化数据，便于 AI 后续处理

### 缺点

- 需要预先定义操作，无法处理未知场景
- 选择器可能因版本更新失效
- 需要维护操作定义的版本兼容性

---

## 方案二: 操作录制 + 智能回放 (Record & Replay)

### 核心思想

人类执行一次操作后自动录制，系统将其转化为可回放的操作序列。后续 AI 或人类需要相同操作时直接回放，无需重新执行。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  第一次执行 (Recording)                                      │
│                                                              │
│  AI/Human → snapshot → click @e5 → wait → snapshot          │
│                              │                               │
│                              ▼                               │
│                      ┌──────────────┐                        │
│                      │ 录制操作序列  │                        │
│                      │ + 页面快照   │                        │
│                      │ + 元素指纹   │                        │
│                      └──────────────┘                        │
│                              │                               │
│                              ▼                               │
│                      ┌──────────────┐                        │
│                      │ 操作缓存存储  │                        │
│                      │ key: 语义标识 │                        │
│                      └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  后续执行 (Replay)                                           │
│                                                              │
│  AI: "打开新建弹框"                                           │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐    匹配成功    ┌──────────────┐            │
│  │ 查询操作缓存  │ ────────────→ │ 直接回放操作  │            │
│  └──────────────┘               └──────────────┘            │
│         │                                                    │
│         │ 匹配失败                                            │
│         ▼                                                    │
│  ┌──────────────┐                                            │
│  │ 正常执行并录制│                                            │
│  └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### 录制格式

```json
{
  "id": "op_123456",
  "name": "open-create-dialog",
  "description": "打开新建项目弹框",
  "namespace": "eresh",
  "tags": ["dialog", "create"],
  "createdAt": "2026-01-15T10:00:00Z",
  "context": {
    "url": "https://app.example.com/projects",
    "urlPattern": "**/projects",
    "pageTitle": "项目列表"
  },
  "fingerprints": {
    "triggerElement": {
      "role": "button",
      "name": "新建",
      "testId": "create-btn",
      "cssSelector": ".header .create-btn",
      "xpath": "//button[text()='新建']"
    },
    "resultElement": {
      "role": "dialog",
      "name": "新建项目",
      "cssSelector": ".eresh-dialog"
    }
  },
  "steps": [
    {
      "action": "click",
      "target": {
        "ref": "@e5",
        "fingerprint": "triggerElement"
      },
      "timestamp": 0
    },
    {
      "action": "wait",
      "condition": {
        "selector": ".eresh-dialog",
        "state": "visible"
      },
      "timestamp": 150
    }
  ],
  "result": {
    "success": true,
    "snapshot": "base64-encoded-snapshot-data",
    "outputs": {
      "dialogTitle": "新建项目",
      "dialogRef": "@dialog1"
    }
  }
}
```

### CLI 接口

```bash
# 开启录制模式
agent-browser record start "open-create-dialog" --namespace eresh --tags dialog,create
# ... 执行操作 ...
agent-browser record stop

# 自动录制模式（每个操作序列自动保存）
agent-browser --auto-record

# 查看已录制的操作
agent-browser record list
agent-browser record list --namespace eresh

# 回放操作
agent-browser replay "open-create-dialog"

# 带上下文匹配的智能回放
agent-browser replay --match "打开新建弹框"

# 导出/导入录制
agent-browser record export "open-create-dialog" > operation.json
agent-browser record import < operation.json

# 删除录制
agent-browser record delete "open-create-dialog"
```

### 智能匹配策略

当 AI 请求执行某操作时，系统按以下优先级匹配:

1. **精确名称匹配**: `replay "open-create-dialog"`
2. **语义匹配**: 使用操作的 description 和 tags 进行模糊匹配
3. **上下文匹配**: 当前 URL、页面结构与录制时相似度
4. **元素指纹匹配**: 页面上存在与录制时相同指纹的元素

```bash
# AI 可以用自然语言查找操作
agent-browser replay --match "打开新建对话框" --context-url "https://app.example.com/projects"
```

### 回放容错机制

```yaml
replay_config:
  # 选择器降级策略
  selector_fallback:
    - testId      # 优先使用 data-testid
    - role+name   # 然后是 role + accessible name
    - css         # 最后是 CSS 选择器
  
  # 超时配置
  timeout: 10000
  
  # 失败时行为
  on_failure:
    - retry: 2
    - fallback_to_manual: true  # 失败后回退到正常执行模式
  
  # 元素位置容差
  position_tolerance: 50px
```

### 优点

- 零编码封装：执行一次即可录制
- 支持复杂操作序列
- 智能匹配减少 AI 决策成本
- 回放速度快

### 缺点

- 录制的操作可能因页面变化而失效
- 需要维护录制数据
- 参数化能力有限

---

## 方案三: 组件操作协议 (Component Operation Protocol)

### 核心思想

定义一套标准协议，让组件库开发者在组件中嵌入操作定义。agent-browser 通过页面上的协议声明自动发现可用操作。

### 协议设计

**组件库在页面中声明操作协议**:

```html
<!-- 组件库在页面注入的协议声明 -->
<script type="application/agent-browser+json" id="ab-protocol">
{
  "version": "1.0",
  "namespace": "eresh",
  "components": {
    "Dialog": {
      "selector": ".eresh-dialog",
      "operations": {
        "open": {
          "description": "打开弹框",
          "trigger": "[data-dialog-trigger]",
          "params": {
            "triggerId": { "type": "string", "from": "data-dialog-id" }
          },
          "steps": [
            { "action": "click", "target": "[data-dialog-trigger='${triggerId}']" },
            { "action": "wait", "condition": ".eresh-dialog[data-id='${triggerId}']" }
          ],
          "verify": ".eresh-dialog[data-id='${triggerId}']:visible"
        },
        "close": {
          "description": "关闭弹框",
          "steps": [
            { "action": "click", "target": ".eresh-dialog .close-btn" },
            { "action": "wait", "condition": ".eresh-dialog:hidden" }
          ]
        },
        "submit": {
          "description": "提交弹框表单",
          "steps": [
            { "action": "click", "target": ".eresh-dialog .submit-btn" },
            { "action": "wait", "condition": ".eresh-dialog:hidden" }
          ]
        }
      }
    },
    "Table": {
      "selector": ".eresh-table",
      "operations": {
        "sort": {
          "description": "表格排序",
          "params": {
            "column": { "type": "string", "required": true },
            "order": { "type": "enum", "values": ["asc", "desc"] }
          },
          "steps": [
            { "action": "click", "target": "th[data-col='${column}']" },
            { "action": "wait", "condition": "networkidle" }
          ]
        },
        "selectRow": {
          "description": "选择表格行",
          "params": {
            "index": { "type": "number" }
          },
          "steps": [
            { "action": "click", "target": "tr:nth-child(${index}) .checkbox" }
          ]
        }
      }
    }
  }
}
</script>
```

### CLI 接口

```bash
# 自动发现页面上的可用操作
agent-browser discover
# 输出:
# Found protocol: eresh v1.0
# Available operations:
#   eresh:Dialog:open    - 打开弹框
#   eresh:Dialog:close   - 关闭弹框
#   eresh:Dialog:submit  - 提交弹框表单
#   eresh:Table:sort     - 表格排序
#   eresh:Table:selectRow - 选择表格行

# 执行发现的操作
agent-browser operate eresh:Dialog:open --triggerId "create-project"

# 获取操作 schema (供 AI 使用)
agent-browser discover --json
```

### 组件库集成

**eresh 组件库只需添加少量代码**:

```typescript
// eresh/src/protocol.ts
export function injectAgentBrowserProtocol() {
  const protocol = {
    version: "1.0",
    namespace: "eresh",
    components: {
      Dialog: DialogProtocol,
      Table: TableProtocol,
      Form: FormProtocol,
      // ...
    }
  };
  
  const script = document.createElement('script');
  script.type = 'application/agent-browser+json';
  script.id = 'ab-protocol';
  script.textContent = JSON.stringify(protocol);
  document.head.appendChild(script);
}

// 在组件库入口调用
if (process.env.NODE_ENV === 'development' || window.__AGENT_BROWSER__) {
  injectAgentBrowserProtocol();
}
```

### 优点

- 操作定义与组件代码一起维护，版本同步
- 自动发现，无需额外配置
- 组件库开发者最了解如何操作组件
- 支持任意组件库接入

### 缺点

- 需要组件库配合实现
- 第三方组件库可能不支持
- 协议设计需要标准化

---

## 方案四: 操作意图映射 (Intent-to-Action Mapping)

### 核心思想

定义高层意图到底层操作的映射，AI 表达意图，系统自动选择最佳执行策略。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│  意图: "在项目列表页面创建一个新项目"                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Intent Parser                              │
│  解析意图:                                                   │
│    - context: 项目列表页面                                   │
│    - action: 创建                                            │
│    - object: 项目                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Action Resolver                            │
│  匹配策略:                                                   │
│    1. 查找 intent mapping: "create project" → ?             │
│    2. 查找 recorded operation: 相似上下文 + 相似意图         │
│    3. 查找 action registry: eresh:dialog:open              │
│    4. Fallback: 常规 snapshot + AI 决策                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Executor                                   │
│  执行选中的策略，返回结果                                     │
└─────────────────────────────────────────────────────────────┘
```

### 意图映射定义

```yaml
# intent-mappings.yaml
version: "1.0"
context: "项目管理系统"

mappings:
  - intent: 
      patterns:
        - "创建(新)?项目"
        - "新建项目"
        - "添加项目"
      context:
        url: "**/projects"
    
    resolution:
      # 优先级1: 使用预定义 action
      - type: action
        name: eresh:dialog:open
        params:
          trigger: "新建"
      
      # 优先级2: 使用录制的操作
      - type: recorded
        match: "open-create-dialog"
      
      # 优先级3: 使用通用策略
      - type: generic
        steps:
          - find button with text "新建" or "创建" or "添加"
          - click the button
          - wait for dialog

  - intent:
      patterns:
        - "删除项目 (.+)"
        - "移除项目 (.+)"
      context:
        url: "**/projects"
    
    resolution:
      - type: action
        name: eresh:table:select-by-name
        params:
          name: "$1"  # 从 pattern 捕获
      - type: action
        name: eresh:dialog:confirm
        params:
          buttonText: "确认删除"

  - intent:
      patterns:
        - "登录(系统)?"
      context:
        url: "**/login"
    
    resolution:
      - type: recorded
        match: "login-flow"
        params:
          username: "${env.USERNAME}"
          password: "${env.PASSWORD}"
```

### CLI 接口

```bash
# 执行意图
agent-browser intent "创建新项目"
agent-browser intent "删除项目 test-project"
agent-browser intent "登录系统"

# 查看意图映射
agent-browser intent list
agent-browser intent describe "创建项目"

# 添加意图映射
agent-browser intent add "创建项目" --action eresh:dialog:open --params trigger="新建"

# 训练意图（从操作历史学习）
agent-browser intent learn --from-history
```

### 优点

- AI 只需表达意图，不需要知道具体操作
- 支持多种解析策略
- 可从历史操作中学习
- 高度灵活

### 缺点

- 意图解析可能不准确
- 需要维护意图映射
- 实现复杂度高

---

## 方案五: 操作缓存层 (Operation Cache Layer)

### 核心思想

在 agent-browser daemon 中添加操作缓存层，自动识别重复操作并缓存结果，后续直接返回缓存结果。

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                                │
│  click @e5 (触发弹框)                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Operation Cache Layer                      │
│                                                              │
│  生成操作指纹:                                               │
│    fingerprint = hash(page_url + element_fingerprint +      │
│                       action + expected_result_pattern)     │
│                                                              │
│  查询缓存:                                                   │
│    if cache[fingerprint] exists and is_valid:               │
│      return cached_result (快速路径)                         │
│    else:                                                     │
│      execute_and_cache (慢速路径)                            │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
      ┌──────────────┐                ┌──────────────┐
      │ 缓存命中      │                │ 实际执行      │
      │ 返回已知结果  │                │ 并缓存结果    │
      └──────────────┘                └──────────────┘
```

### 缓存策略

```yaml
cache_config:
  # 缓存键生成策略
  key_strategy:
    include:
      - page_url_pattern    # URL 模式而非完整 URL
      - element_fingerprint # 元素指纹
      - action_type         # 操作类型
      - action_params       # 操作参数
    exclude:
      - timestamp
      - element_ref        # ref 是动态的，不应包含
  
  # 缓存有效性判断
  validity:
    max_age: 3600          # 最大缓存时间（秒）
    invalidate_on:
      - page_navigation    # 页面导航后失效
      - significant_dom_change  # DOM 显著变化后失效
  
  # 缓存内容
  cached_data:
    - result_snapshot      # 操作后的页面快照
    - element_refs         # 新出现的元素引用
    - timing_info          # 执行时间信息
  
  # 分层缓存
  layers:
    - memory: 100MB        # 内存缓存
    - disk: 1GB            # 磁盘缓存
```

### CLI 接口

```bash
# 启用缓存（默认启用）
agent-browser --cache

# 禁用缓存（调试用）
agent-browser --no-cache

# 查看缓存统计
agent-browser cache stats
# 输出:
# Cache statistics:
#   Entries: 156
#   Hit rate: 78%
#   Size: 45MB
#   Saved operations: 1,234
#   Time saved: ~2.5 hours

# 清理缓存
agent-browser cache clear
agent-browser cache clear --older-than 7d

# 预热缓存（执行一系列操作并缓存）
agent-browser cache warm < operations.txt

# 导出/导入缓存
agent-browser cache export > cache-backup.json
agent-browser cache import < cache-backup.json
```

### 智能预加载

```yaml
# 基于操作历史预测下一步操作并预加载
prefetch:
  enabled: true
  strategy:
    # 如果 A 操作后 80% 的情况会执行 B 操作，预加载 B 的结果
    - pattern: "sequence"
      threshold: 0.8
    
    # 常见操作序列预加载
    - pattern: "common_flows"
      flows:
        - [open_dialog, fill_form, submit]
        - [login, navigate_dashboard]
```

### 优点

- 对 AI Agent 完全透明，无需修改调用方式
- 自动识别重复操作
- 显著减少重复执行的时间和 token 消耗
- 支持跨会话缓存

### 缺点

- 缓存失效判断复杂
- 可能返回过期数据
- 占用存储空间

---

## 方案对比

| 方案 | 封装成本 | AI 调用复杂度 | 确定性 | 可缓存 | 可扩展性 | 实现复杂度 |
|------|---------|--------------|--------|--------|---------|-----------|
| 语义化操作注册表 | 中 | 低 | 高 | 是 | 高 | 中 |
| 操作录制+回放 | 极低 | 低 | 高 | 是 | 中 | 高 |
| 组件操作协议 | 中* | 极低 | 高 | 是 | 极高 | 中 |
| 意图映射 | 高 | 极低 | 中 | 是 | 高 | 高 |
| 操作缓存层 | 无 | 无变化 | 中 | 是 | 低 | 中 |

\* 组件库需要配合实现

---

## 推荐方案

### 综合推荐: 组合方案

建议采用 **方案一 + 方案二 + 方案五** 的组合：

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Agent                              │
│  调用: action run eresh:dialog:open --trigger "新建"         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Operation Cache Layer (方案五)                 │
│  检查缓存 → 命中则直接返回                                   │
└─────────────────────────────────────────────────────────────┘
                              │ 未命中
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            Action Registry (方案一) + Replay (方案二)        │
│  1. 查找预定义 action → 执行 YAML 中的 steps                │
│  2. 或查找录制的操作 → 回放录制序列                          │
│  3. 执行成功后存入缓存                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   agent-browser daemon                       │
│  执行底层 Playwright 操作                                    │
└─────────────────────────────────────────────────────────────┘
```

### 实施路径

#### 第一阶段: 基础能力 (2-3 周)

1. **实现操作缓存层** (方案五)
   - 在 daemon 中添加缓存逻辑
   - 实现缓存键生成和有效性判断
   - 对 AI Agent 透明，无需修改调用方式

2. **实现基础 action 命令**
   ```bash
   agent-browser action list
   agent-browser action run <name> [params]
   ```

#### 第二阶段: 操作定义 (2-3 周)

3. **实现 YAML action 定义解析** (方案一)
   - 支持 steps、params、returns
   - 支持条件执行 (when)
   - 支持变量引用

4. **为 eresh 组件库创建初始操作定义**
   - dialog:open/close/confirm
   - table:sort/filter/select
   - form:fill/submit/validate

#### 第三阶段: 录制能力 (2-3 周)

5. **实现操作录制** (方案二)
   - record start/stop 命令
   - 元素指纹提取
   - 回放时选择器降级

6. **更新 SKILL.md**
   - 添加语义化操作说明
   - 指导 AI 优先使用 action 命令

### 快速验证 (MVP)

如果时间紧张，可先只实现 **方案一的最小版本**：

```bash
# 只需要 2-3 天实现

# 1. 支持 action 文件格式 (简化版)
cat > ~/.agent-browser/actions/eresh.yaml << 'EOF'
actions:
  dialog-open:
    steps:
      - find role button click --name "${trigger}"
      - wait .eresh-dialog
EOF

# 2. 实现 action run 命令
agent-browser action run dialog-open --trigger "新建"
```

这个 MVP 已经能解决：
- AI 调用确定性问题
- 操作复用问题
- Token 浪费问题

后续再逐步添加缓存、录制等高级功能。

---

## 附录: eresh 组件库操作定义示例

```yaml
# ~/.agent-browser/actions/eresh.yaml
namespace: eresh
version: "1.0.0"

actions:
  # === Dialog 操作 ===
  dialog:open:
    description: "打开弹框"
    params:
      trigger: { type: string, required: true, description: "触发按钮文本" }
    steps:
      - find role button click --name "${trigger}"
      - wait .eresh-dialog
      - snapshot -i --selector .eresh-dialog
    
  dialog:close:
    description: "关闭弹框"
    steps:
      - click .eresh-dialog .eresh-dialog-close
      - wait --hidden .eresh-dialog

  dialog:confirm:
    description: "点击弹框确认按钮"
    params:
      text: { type: string, default: "确定" }
    steps:
      - find role button click --name "${text}" --within .eresh-dialog
      - wait --hidden .eresh-dialog

  # === Table 操作 ===
  table:sort:
    description: "表格排序"
    params:
      column: { type: string, required: true }
      order: { type: enum, values: [asc, desc], default: asc }
    steps:
      - click .eresh-table th[data-col="${column}"]
      - wait --load networkidle

  table:select-row:
    description: "选择表格行"
    params:
      index: { type: number, required: true }
    steps:
      - click .eresh-table tbody tr:nth-child(${index}) .eresh-checkbox

  table:select-all:
    description: "全选表格"
    steps:
      - click .eresh-table thead .eresh-checkbox

  # === Form 操作 ===
  form:fill:
    description: "填写表单字段"
    params:
      label: { type: string, required: true }
      value: { type: string, required: true }
    steps:
      - find label "${label}" fill "${value}"

  form:submit:
    description: "提交表单"
    params:
      buttonText: { type: string, default: "提交" }
    steps:
      - find role button click --name "${buttonText}"
      - wait --load networkidle

  form:validate:
    description: "检查表单验证状态"
    steps:
      - eval "document.querySelector('.eresh-form').checkValidity()"
```
