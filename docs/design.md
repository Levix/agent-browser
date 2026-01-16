# agent-browser 语义化操作注册表 (Semantic Action Registry) 设计文档

## 文档信息

| 项目 | 内容 |
|------|------|
| 版本 | v1.0 |
| 日期 | 2026-01-15 |
| 状态 | Draft |
| 相关文档 | [cases-v2.md](cases-v2.md) |

---

## 1. 概述

### 1.1 背景

当前 AI Agent 使用 agent-browser 执行常见操作（如打开弹框、表单提交）时，每次都需要经过 snapshot → 分析 → 决策 → 执行的完整链路，导致：

- 行为不确定性：相同操作可能采用不同步骤
- Token 浪费：反复推理如何执行常见操作
- 时间开销：链路过长
- 知识无法复用：人类已知的组件操作方式无法传递给 AI

### 1.2 目标

设计并实现**语义化操作注册表 (Semantic Action Registry)**，允许：

1. **中台团队**：为组件库（如 eresh）定义标准操作
2. **业务团队**：扩展业务级操作（如登录流程、创建云主机）
3. **AI Agent**：发现并直接调用预定义操作，获得确定性行为

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **AI-First** | 操作定义面向 AI Agent 调用，而非人类终端用户 |
| **确定性** | 操作执行路径固定，消除 AI 决策随机性 |
| **低封装成本** | YAML 声明式定义，无需编程 |
| **可发现性** | AI 可查询可用操作及其 schema |
| **可扩展性** | 支持分层定义，业务团队可扩展 |
| **可维护性** | 支持版本管理、兼容性检测、优雅降级 |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AI Agent                                    │
│  agent-browser action run eresh:dialog:open --trigger "新建"             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLI Layer (Rust)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ action list │  │action describe│ │ action run  │  │action validate│   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Action Registry Service                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Registry Loader                               │  │
│  │  加载顺序 (后加载覆盖先加载):                                       │  │
│  │  1. 内置操作 (built-in)                                           │  │
│  │  2. 全局操作 (~/.agent-browser/actions/)                          │  │
│  │  3. 项目操作 (./.agent-browser/actions/)                          │  │
│  │  4. 环境变量指定 (AGENT_BROWSER_ACTIONS_PATH)                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Action Executor                               │  │
│  │  解析 steps → 变量替换 → 条件判断 → 执行 → 收集输出                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      Version Manager                               │  │
│  │  版本兼容性检查 → 选择器降级 → 执行失败告警                         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         agent-browser daemon                             │
│  执行底层 Playwright 操作                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 分层架构

操作定义采用分层架构，支持多层级覆盖：

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: 项目级操作定义 (最高优先级)                            │
│  位置: ./.agent-browser/actions/                                │
│  维护者: 业务开发者                                              │
│  示例: 项目特定的登录流程、业务操作                               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: 用户级操作定义                                         │
│  位置: ~/.agent-browser/actions/                                │
│  维护者: 用户个人                                                │
│  示例: 个人常用操作、调试用操作                                   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: 团队级操作定义 (通过环境变量或配置指定)                 │
│  位置: $AGENT_BROWSER_ACTIONS_PATH 或 npm 包                    │
│  维护者: 中台团队 / 组件库团队                                   │
│  示例: eresh 组件库操作、公司级通用操作                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: 内置操作定义 (最低优先级)                              │
│  位置: agent-browser 安装包内置                                  │
│  维护者: agent-browser 维护者                                   │
│  示例: common:login, common:form:submit 等通用操作              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 操作定义加载流程

```
                    启动 / 首次调用
                          │
                          ▼
              ┌───────────────────────┐
              │ 扫描所有操作定义源     │
              └───────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ 内置操作  │   │ 全局操作  │   │ 项目操作  │
    └──────────┘   └──────────┘   └──────────┘
          │               │               │
          └───────────────┼───────────────┘
                          ▼
              ┌───────────────────────┐
              │ 解析 YAML 文件         │
              │ 验证 schema           │
              │ 检查版本兼容性         │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ 合并到 Registry       │
              │ (后加载覆盖先加载)     │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ 构建操作索引          │
              │ namespace:component:action │
              └───────────────────────┘
```

---

## 3. 操作定义规范

### 3.1 文件结构

```
actions/
├── eresh.yaml           # eresh 组件库操作定义
├── eresh/               # 或使用目录形式组织
│   ├── dialog.yaml
│   ├── table.yaml
│   └── form.yaml
├── business/            # 业务操作
│   ├── auth.yaml        # 认证相关
│   └── cloud.yaml       # 云主机操作
└── _meta.yaml           # 元数据配置（可选）
```

### 3.2 操作定义 Schema

```yaml
# 文件级元数据
namespace: string          # 命名空间，如 "eresh", "business"
version: string            # 语义化版本，如 "1.0.0"
description: string        # 描述
compatibility:             # 兼容性声明
  min_version: string      # 最低兼容的组件库版本
  max_version: string      # 最高兼容的组件库版本（可选）

# 操作定义
actions:
  <component>:<action>:    # 操作名，如 "dialog:open"
    description: string    # 操作描述（必填，供 AI 理解）
    deprecated: boolean    # 是否已废弃
    deprecated_message: string  # 废弃提示
    since: string          # 引入版本
    
    # 参数定义
    params:
      <param_name>:
        type: string | number | boolean | enum | array | object
        description: string
        required: boolean
        default: any
        values: array      # 仅 enum 类型
        
    # 执行步骤
    steps:
      - action: string     # agent-browser 命令
        args: object       # 命令参数，支持 ${variable} 插值
        output: string     # 输出变量名（可选）
        when: string       # 条件表达式（可选）
        timeout: number    # 超时时间 ms（可选）
        retry: number      # 重试次数（可选）
        on_error: continue | abort | fallback  # 错误处理
        fallback:          # 降级步骤（可选）
          - action: ...
    
    # 返回值定义
    returns:
      <key>: <value or expression>
    
    # 验证条件（可选）
    verify:
      - condition: string  # 验证表达式
        message: string    # 失败消息
        
    # 选择器别名（可选，用于版本兼容）
    selectors:
      dialog: ".eresh-dialog"
      closeBtn: ".eresh-dialog .close-button"
```

### 3.3 完整示例

```yaml
# eresh.yaml - eresh 组件库操作定义
namespace: eresh
version: "2.1.0"
description: "eresh 组件库 v2.x 操作定义"

compatibility:
  min_version: "2.0.0"
  max_version: "2.99.99"

# 选择器别名定义（便于版本更新时统一修改）
selectors:
  dialog: ".eresh-dialog"
  dialogOverlay: ".eresh-dialog-overlay"
  dialogClose: ".eresh-dialog .eresh-dialog-header .close-icon"
  dialogConfirm: ".eresh-dialog .eresh-dialog-footer .eresh-btn-primary"
  dialogCancel: ".eresh-dialog .eresh-dialog-footer .eresh-btn-default"
  table: ".eresh-table"
  tableHeader: ".eresh-table .eresh-table-header"
  tableBody: ".eresh-table .eresh-table-body"

actions:
  # ============ Dialog 操作 ============
  dialog:open:
    description: |
      打开弹框。通过点击触发按钮打开指定的弹框。
      适用于需要通过按钮触发的模态对话框场景。
    since: "1.0.0"
    
    params:
      trigger:
        type: string
        description: "触发弹框的按钮文本（优先）或 CSS 选择器"
        required: true
      triggerBy:
        type: enum
        values: [text, selector, testid]
        description: "触发方式：text=按钮文本, selector=CSS选择器, testid=data-testid"
        default: text
      waitTimeout:
        type: number
        description: "等待弹框出现的超时时间（毫秒）"
        default: 5000
        
    steps:
      # 根据 triggerBy 类型选择不同的查找方式
      - when: "${triggerBy} == 'text'"
        action: find
        args:
          type: role
          role: button
          name: "${trigger}"
          subaction: click
        timeout: 3000
        on_error: fallback
        fallback:
          # 降级：尝试用文本匹配
          - action: find
            args:
              type: text
              text: "${trigger}"
              subaction: click
              
      - when: "${triggerBy} == 'selector'"
        action: click
        args:
          selector: "${trigger}"
          
      - when: "${triggerBy} == 'testid'"
        action: find
        args:
          type: testid
          id: "${trigger}"
          subaction: click
          
      # 等待弹框出现
      - action: wait
        args:
          selector: "${selectors.dialog}"
        timeout: "${waitTimeout}"
        
      # 获取弹框快照
      - action: snapshot
        args:
          interactive: true
          selector: "${selectors.dialog}"
        output: dialogSnapshot
        
    returns:
      success: true
      dialogTitle: "${dialogSnapshot.title}"
      dialogRef: "${dialogSnapshot.ref}"
      elements: "${dialogSnapshot.elements}"
      
    verify:
      - condition: "document.querySelector('${selectors.dialog}') !== null"
        message: "弹框未成功打开"

  dialog:close:
    description: |
      关闭当前打开的弹框。支持多种关闭方式。
    since: "1.0.0"
    
    params:
      method:
        type: enum
        values: [button, escape, overlay]
        description: "关闭方式：button=点击关闭按钮, escape=按ESC键, overlay=点击遮罩层"
        default: button
      force:
        type: boolean
        description: "是否强制关闭（忽略未保存提示）"
        default: false
        
    steps:
      - when: "${method} == 'button'"
        action: click
        args:
          selector: "${selectors.dialogClose}"
        on_error: fallback
        fallback:
          - action: press
            args:
              key: Escape
              
      - when: "${method} == 'escape'"
        action: press
        args:
          key: Escape
          
      - when: "${method} == 'overlay'"
        action: click
        args:
          selector: "${selectors.dialogOverlay}"
          
      # 处理未保存提示
      - when: "${force} == true"
        action: wait
        args:
          timeout: 500
      - when: "${force} == true"
        action: eval
        args:
          expression: |
            const confirmBtn = document.querySelector('.eresh-confirm-dialog .confirm-btn');
            if (confirmBtn) confirmBtn.click();
            
      # 等待弹框消失
      - action: wait
        args:
          hidden: "${selectors.dialog}"
        timeout: 3000
        
    returns:
      success: true

  dialog:confirm:
    description: |
      点击弹框的确认按钮（如"确定"、"提交"等）。
    since: "1.0.0"
    
    params:
      buttonText:
        type: string
        description: "确认按钮的文本"
        default: "确定"
      waitForClose:
        type: boolean
        description: "是否等待弹框关闭"
        default: true
        
    steps:
      - action: find
        args:
          type: role
          role: button
          name: "${buttonText}"
          within: "${selectors.dialog}"
          subaction: click
        on_error: fallback
        fallback:
          - action: click
            args:
              selector: "${selectors.dialogConfirm}"
              
      - when: "${waitForClose} == true"
        action: wait
        args:
          hidden: "${selectors.dialog}"
        timeout: 5000
        
    returns:
      success: true

  # ============ Table 操作 ============
  table:sort:
    description: |
      对表格按指定列进行排序。
    since: "1.0.0"
    
    params:
      column:
        type: string
        description: "要排序的列名"
        required: true
      order:
        type: enum
        values: [asc, desc, toggle]
        description: "排序顺序：asc=升序, desc=降序, toggle=切换"
        default: toggle
        
    steps:
      - action: find
        args:
          type: role
          role: columnheader
          name: "${column}"
          subaction: click
          
      # 如果需要降序且当前是升序，再点一次
      - when: "${order} == 'desc'"
        action: wait
        args:
          timeout: 300
      - when: "${order} == 'desc'"
        action: find
        args:
          type: role
          role: columnheader
          name: "${column}"
          subaction: click
          
      - action: wait
        args:
          load: networkidle
        timeout: 5000
        
    returns:
      success: true
      sortedBy: "${column}"
      order: "${order}"

  table:select-row:
    description: |
      选择表格中的某一行。
    since: "1.0.0"
    
    params:
      index:
        type: number
        description: "行索引（从1开始）"
        required: true
      method:
        type: enum
        values: [checkbox, click]
        description: "选择方式"
        default: checkbox
        
    steps:
      - when: "${method} == 'checkbox'"
        action: click
        args:
          selector: "${selectors.tableBody} tr:nth-child(${index}) .eresh-checkbox"
          
      - when: "${method} == 'click'"
        action: click
        args:
          selector: "${selectors.tableBody} tr:nth-child(${index})"
          
    returns:
      success: true
      selectedIndex: "${index}"

  table:filter:
    description: |
      设置表格筛选条件。
    since: "1.1.0"
    
    params:
      column:
        type: string
        description: "要筛选的列名"
        required: true
      value:
        type: string
        description: "筛选值"
        required: true
      operator:
        type: enum
        values: [equals, contains, startsWith, endsWith]
        description: "匹配方式"
        default: contains
        
    steps:
      - action: click
        args:
          selector: "${selectors.tableHeader} th[data-col='${column}'] .filter-icon"
          
      - action: wait
        args:
          selector: ".eresh-table-filter-dropdown"
          
      - action: fill
        args:
          selector: ".eresh-table-filter-dropdown input"
          value: "${value}"
          
      - action: click
        args:
          selector: ".eresh-table-filter-dropdown .apply-btn"
          
      - action: wait
        args:
          load: networkidle
          
    returns:
      success: true

  # ============ Form 操作 ============
  form:fill-field:
    description: |
      填写表单中的单个字段。
    since: "1.0.0"
    
    params:
      label:
        type: string
        description: "字段标签文本"
        required: true
      value:
        type: string
        description: "要填入的值"
        required: true
      fieldType:
        type: enum
        values: [input, select, date, checkbox, radio]
        description: "字段类型"
        default: input
        
    steps:
      - when: "${fieldType} == 'input'"
        action: find
        args:
          type: label
          label: "${label}"
          subaction: fill
          value: "${value}"
          
      - when: "${fieldType} == 'select'"
        action: find
        args:
          type: label
          label: "${label}"
          subaction: click
      - when: "${fieldType} == 'select'"
        action: find
        args:
          type: text
          text: "${value}"
          subaction: click
          
      - when: "${fieldType} == 'date'"
        action: find
        args:
          type: label
          label: "${label}"
          subaction: click
      - when: "${fieldType} == 'date'"
        action: eval
        args:
          expression: |
            // 日期选择器处理逻辑
            const picker = document.querySelector('.eresh-date-picker');
            // ...
            
    returns:
      success: true

  form:submit:
    description: |
      提交表单。
    since: "1.0.0"
    
    params:
      buttonText:
        type: string
        description: "提交按钮文本"
        default: "提交"
      validate:
        type: boolean
        description: "提交前是否校验表单"
        default: true
      waitForResult:
        type: boolean
        description: "是否等待提交结果"
        default: true
        
    steps:
      - when: "${validate} == true"
        action: eval
        args:
          expression: |
            const form = document.querySelector('form, .eresh-form');
            return form ? form.checkValidity() : true;
        output: isValid
        
      - when: "${validate} == true && ${isValid} == false"
        action: fail
        args:
          message: "表单验证失败"
          
      - action: find
        args:
          type: role
          role: button
          name: "${buttonText}"
          subaction: click
          
      - when: "${waitForResult} == true"
        action: wait
        args:
          load: networkidle
        timeout: 10000
        
    returns:
      success: true
```

### 3.4 业务操作定义示例

```yaml
# business/auth.yaml - 业务认证操作
namespace: business
version: "1.0.0"
description: "业务级认证操作定义"

actions:
  auth:login:
    description: |
      执行登录操作。支持账号密码登录。
      使用前需确保已在登录页面。
    
    params:
      username:
        type: string
        description: "用户名"
        required: true
      password:
        type: string
        description: "密码"
        required: true
      rememberMe:
        type: boolean
        description: "是否勾选记住我"
        default: false
      successUrl:
        type: string
        description: "登录成功后的 URL 模式"
        default: "**/dashboard"
        
    steps:
      - action: find
        args:
          type: label
          label: "用户名"
          subaction: fill
          value: "${username}"
        on_error: fallback
        fallback:
          - action: find
            args:
              type: placeholder
              placeholder: "请输入用户名"
              subaction: fill
              value: "${username}"
              
      - action: find
        args:
          type: label
          label: "密码"
          subaction: fill
          value: "${password}"
        on_error: fallback
        fallback:
          - action: find
            args:
              type: placeholder
              placeholder: "请输入密码"
              subaction: fill
              value: "${password}"
              
      - when: "${rememberMe} == true"
        action: find
        args:
          type: label
          label: "记住我"
          subaction: check
          
      - action: find
        args:
          type: role
          role: button
          name: "登录"
          subaction: click
        on_error: fallback
        fallback:
          - action: find
            args:
              type: text
              text: "登录"
              subaction: click
              
      - action: wait
        args:
          url: "${successUrl}"
        timeout: 10000
        
    returns:
      success: true
      redirectUrl: "${currentUrl}"
      
    verify:
      - condition: "!window.location.href.includes('login')"
        message: "登录失败，仍在登录页面"

  auth:logout:
    description: |
      执行登出操作。
    
    params:
      confirmLogout:
        type: boolean
        description: "是否确认登出（如有确认弹框）"
        default: true
        
    steps:
      - action: find
        args:
          type: text
          text: "退出登录"
          subaction: click
        on_error: fallback
        fallback:
          - action: find
            args:
              type: text
              text: "登出"
              subaction: click
              
      - when: "${confirmLogout} == true"
        action: wait
        args:
          timeout: 500
      - when: "${confirmLogout} == true"
        action: eval
        args:
          expression: |
            const confirmBtn = document.querySelector('.confirm-btn, .eresh-btn-primary');
            if (confirmBtn && confirmBtn.textContent.includes('确')) {
              confirmBtn.click();
              return true;
            }
            return false;
            
      - action: wait
        args:
          url: "**/login"
        timeout: 5000
        
    returns:
      success: true

# business/cloud.yaml - 云主机操作
namespace: business
version: "1.0.0"
description: "云主机相关业务操作"

actions:
  cloud:create-vm:
    description: |
      创建云主机实例。完成创建表单的填写和提交。
    
    params:
      name:
        type: string
        description: "实例名称"
        required: true
      spec:
        type: string
        description: "规格，如 2C4G"
        default: "2C4G"
      image:
        type: string
        description: "镜像名称"
        default: "CentOS 7.9"
      network:
        type: string
        description: "网络"
        default: "default"
        
    steps:
      # 点击创建按钮打开弹框
      - action: run
        args:
          action: eresh:dialog:open
          params:
            trigger: "创建实例"
            
      # 填写表单
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "实例名称"
            value: "${name}"
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "规格"
            value: "${spec}"
            fieldType: select
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "镜像"
            value: "${image}"
            fieldType: select
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "网络"
            value: "${network}"
            fieldType: select
            
      # 提交
      - action: run
        args:
          action: eresh:dialog:confirm
          params:
            buttonText: "确认创建"
            
      # 等待创建结果
      - action: wait
        args:
          text: "创建成功"
        timeout: 30000
        
    returns:
      success: true
      instanceName: "${name}"
```

---

## 4. CLI 接口设计

### 4.1 命令列表

```bash
# 操作发现
agent-browser action list [namespace]           # 列出可用操作
agent-browser action describe <action>          # 查看操作详情
agent-browser action search <keyword>           # 搜索操作

# 操作执行
agent-browser action run <action> [--param value...]  # 执行操作

# 操作管理
agent-browser action validate <file>            # 验证操作定义文件
agent-browser action register <file|dir>        # 注册操作定义
agent-browser action unregister <namespace>     # 注销操作定义
agent-browser action reload                     # 重新加载所有操作定义

# 调试
agent-browser action dry-run <action> [params]  # 干运行（不实际执行）
agent-browser action debug <action> [params]    # 调试模式执行
```

### 4.2 命令输出格式

#### action list

```bash
$ agent-browser action list

Namespaces:
  eresh      eresh 组件库 v2.1.0 (12 actions)
  business   业务操作 v1.0.0 (5 actions)
  common     通用操作 (内置) (3 actions)

$ agent-browser action list eresh

eresh (v2.1.0) - eresh 组件库 v2.x 操作定义
  dialog:open      打开弹框
  dialog:close     关闭弹框
  dialog:confirm   点击弹框确认按钮
  table:sort       表格排序
  table:select-row 选择表格行
  table:filter     设置表格筛选
  form:fill-field  填写表单字段
  form:submit      提交表单
  ...
```

#### action describe

```bash
$ agent-browser action describe eresh:dialog:open

eresh:dialog:open
  Description: 打开弹框。通过点击触发按钮打开指定的弹框。
  Since: v1.0.0
  
  Parameters:
    trigger (string, required)
      触发弹框的按钮文本（优先）或 CSS 选择器
    
    triggerBy (enum: text|selector|testid, default: text)
      触发方式
    
    waitTimeout (number, default: 5000)
      等待弹框出现的超时时间（毫秒）
  
  Returns:
    success      (boolean) 是否成功
    dialogTitle  (string)  弹框标题
    dialogRef    (string)  弹框元素引用
    elements     (array)   弹框内的交互元素
  
  Example:
    agent-browser action run eresh:dialog:open --trigger "新建"
    agent-browser action run eresh:dialog:open --trigger "#create-btn" --triggerBy selector

$ agent-browser action describe eresh:dialog:open --json
{
  "name": "eresh:dialog:open",
  "namespace": "eresh",
  "description": "打开弹框...",
  "params": {
    "trigger": { "type": "string", "required": true, "description": "..." },
    "triggerBy": { "type": "enum", "values": ["text", "selector", "testid"], "default": "text" },
    "waitTimeout": { "type": "number", "default": 5000 }
  },
  "returns": {
    "success": "boolean",
    "dialogTitle": "string",
    "dialogRef": "string",
    "elements": "array"
  }
}
```

#### action run

```bash
$ agent-browser action run eresh:dialog:open --trigger "新建"

{
  "success": true,
  "dialogTitle": "新建项目",
  "dialogRef": "@dialog1",
  "elements": [
    {"ref": "@e1", "role": "textbox", "name": "项目名称"},
    {"ref": "@e2", "role": "textbox", "name": "描述"},
    {"ref": "@e3", "role": "button", "name": "确定"},
    {"ref": "@e4", "role": "button", "name": "取消"}
  ]
}

# 失败时
$ agent-browser action run eresh:dialog:open --trigger "不存在的按钮"

{
  "success": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "找不到文本为"不存在的按钮"的按钮",
    "step": 1,
    "action": "find"
  }
}
```

### 4.3 JSON Schema 输出（供 AI 使用）

```bash
$ agent-browser action schema --json

{
  "namespaces": [
    {
      "name": "eresh",
      "version": "2.1.0",
      "description": "eresh 组件库 v2.x 操作定义",
      "actions": [
        {
          "name": "dialog:open",
          "fullName": "eresh:dialog:open",
          "description": "打开弹框...",
          "params": {...},
          "returns": {...}
        },
        ...
      ]
    }
  ]
}
```

---

## 5. 版本管理与兼容性

### 5.1 版本兼容性策略

```yaml
# 操作定义中的兼容性声明
compatibility:
  min_version: "2.0.0"      # 最低支持的组件库版本
  max_version: "2.99.99"    # 最高支持的组件库版本
  
  # 版本特定的选择器覆盖
  version_overrides:
    "2.0.x":
      selectors:
        dialog: ".eresh-modal"  # 旧版本使用不同类名
        dialogClose: ".eresh-modal .close-icon"
    "2.1.0+":
      selectors:
        dialog: ".eresh-dialog"
        dialogClose: ".eresh-dialog .eresh-dialog-header .close-icon"
```

### 5.2 运行时版本检测

```typescript
// 执行操作前检测组件库版本
async function detectComponentVersion(page: Page, namespace: string): Promise<string | null> {
  const detectors: Record<string, string> = {
    eresh: `
      window.__ERESH_VERSION__ || 
      document.querySelector('meta[name="eresh-version"]')?.content ||
      window.Eresh?.version
    `,
    antd: `window.antd?.version`,
  };
  
  const detector = detectors[namespace];
  if (!detector) return null;
  
  return await page.evaluate(detector);
}

// 选择匹配的操作定义版本
function selectCompatibleAction(
  action: ActionDefinition, 
  componentVersion: string
): ActionDefinition {
  // 检查版本兼容性
  if (!isVersionCompatible(componentVersion, action.compatibility)) {
    throw new Error(`操作定义不兼容当前组件库版本 ${componentVersion}`);
  }
  
  // 应用版本特定的选择器覆盖
  const override = findVersionOverride(action.compatibility.version_overrides, componentVersion);
  if (override) {
    return mergeActionWithOverride(action, override);
  }
  
  return action;
}
```

### 5.3 选择器降级策略

当主选择器失败时，自动尝试备选策略：

```yaml
# 在操作定义中声明选择器降级链
selectors:
  dialog:
    primary: ".eresh-dialog"
    fallback:
      - ".eresh-modal"           # 旧版类名
      - "[role='dialog']"        # ARIA role
      - "[data-testid='dialog']" # test id
```

### 5.4 操作定义更新流程

```
组件库发布新版本
        │
        ▼
┌─────────────────────────┐
│ 中台团队更新操作定义     │
│ 1. 修改选择器           │
│ 2. 添加版本覆盖         │
│ 3. 更新兼容性声明       │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ 发布操作定义包          │
│ npm publish             │
│ @company/ab-actions-eresh │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ 业务团队更新依赖        │
│ npm update              │
└─────────────────────────┘
```

### 5.5 废弃操作处理

```yaml
actions:
  dialog:open:
    description: "打开弹框"
    deprecated: false
    
  dialog:show:  # 旧操作名
    description: "打开弹框（已废弃，请使用 dialog:open）"
    deprecated: true
    deprecated_message: "此操作已废弃，请使用 eresh:dialog:open"
    deprecated_since: "2.0.0"
    alias_of: dialog:open  # 自动转发到新操作
```

---

## 6. 扩展机制

### 6.1 业务团队扩展操作

业务团队可以在项目目录下创建操作定义：

```
project/
├── .agent-browser/
│   └── actions/
│       ├── _config.yaml      # 配置
│       └── project.yaml      # 项目特定操作
├── src/
└── ...
```

**_config.yaml**:
```yaml
# 继承其他操作定义
extends:
  - "@company/ab-actions-eresh"  # npm 包
  - "~/.agent-browser/actions/"  # 用户级

# 覆盖配置
overrides:
  eresh:
    selectors:
      dialog: ".custom-dialog"  # 项目使用了自定义样式
```

**project.yaml**:
```yaml
namespace: project
version: "1.0.0"
description: "项目特定操作"

actions:
  workflow:create-order:
    description: "创建订单完整流程"
    steps:
      - action: run
        args:
          action: business:auth:login
          params:
            username: "${env.TEST_USER}"
            password: "${env.TEST_PASS}"
            
      - action: open
        args:
          url: "/orders/new"
          
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "商品"
            value: "${productName}"
            
      # ... 更多步骤
```

### 6.2 操作组合 (Composition)

支持在操作中调用其他操作：

```yaml
actions:
  workflow:complete-registration:
    description: "完成用户注册流程"
    params:
      email: { type: string, required: true }
      password: { type: string, required: true }
      
    steps:
      # 调用其他操作
      - action: run
        args:
          action: eresh:dialog:open
          params:
            trigger: "注册"
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "邮箱"
            value: "${email}"
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "密码"
            value: "${password}"
            
      - action: run
        args:
          action: eresh:form:fill-field
          params:
            label: "确认密码"
            value: "${password}"
            
      - action: run
        args:
          action: eresh:dialog:confirm
          params:
            buttonText: "注册"
```

### 6.3 npm 包分发

中台团队可以将操作定义发布为 npm 包：

```json
// package.json
{
  "name": "@company/ab-actions-eresh",
  "version": "2.1.0",
  "description": "agent-browser actions for eresh component library",
  "main": "index.yaml",
  "files": [
    "*.yaml",
    "components/"
  ],
  "keywords": ["agent-browser", "actions", "eresh"],
  "peerDependencies": {
    "eresh": "^2.0.0"
  }
}
```

业务团队安装：
```bash
npm install @company/ab-actions-eresh --save-dev
```

配置使用：
```yaml
# .agent-browser/actions/_config.yaml
extends:
  - "@company/ab-actions-eresh"
```

---

## 7. 错误处理与调试

### 7.1 错误类型

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `ACTION_NOT_FOUND` | 操作不存在 | 检查操作名是否正确 |
| `PARAM_REQUIRED` | 缺少必填参数 | 补充必填参数 |
| `PARAM_INVALID` | 参数值无效 | 检查参数类型和格式 |
| `ELEMENT_NOT_FOUND` | 找不到目标元素 | 检查选择器或页面状态 |
| `TIMEOUT` | 操作超时 | 增加超时时间或检查页面 |
| `STEP_FAILED` | 步骤执行失败 | 查看详细错误信息 |
| `VERSION_INCOMPATIBLE` | 版本不兼容 | 更新操作定义 |
| `VERIFY_FAILED` | 验证失败 | 检查操作是否成功执行 |

### 7.2 错误响应格式

```json
{
  "success": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "找不到文本为"新建"的按钮",
    "action": "eresh:dialog:open",
    "step": 1,
    "stepAction": "find",
    "details": {
      "selector": "role:button[name='新建']",
      "timeout": 3000,
      "pageUrl": "https://app.example.com/projects"
    },
    "suggestion": "请确认页面上存在该按钮，或尝试使用 selector 方式指定元素"
  }
}
```

### 7.3 调试模式

```bash
# 启用调试模式
agent-browser action run eresh:dialog:open --trigger "新建" --debug

# 输出：
[DEBUG] Loading action: eresh:dialog:open
[DEBUG] Resolved params: { trigger: "新建", triggerBy: "text", waitTimeout: 5000 }
[DEBUG] Step 1: find (role:button, name: "新建")
[DEBUG]   → Found element: @e5
[DEBUG] Step 2: click (@e5)
[DEBUG]   → Clicked successfully
[DEBUG] Step 3: wait (.eresh-dialog)
[DEBUG]   → Element appeared after 120ms
[DEBUG] Step 4: snapshot (.eresh-dialog)
[DEBUG]   → Captured 4 elements
[DEBUG] Verify: document.querySelector('.eresh-dialog') !== null
[DEBUG]   → Passed
[DEBUG] Action completed successfully
{
  "success": true,
  "dialogTitle": "新建项目",
  ...
}
```

### 7.4 干运行模式

```bash
# 干运行（不实际执行）
agent-browser action dry-run eresh:dialog:open --trigger "新建"

# 输出：
Action: eresh:dialog:open
Params: { trigger: "新建", triggerBy: "text", waitTimeout: 5000 }

Execution plan:
  1. find role:button with name "新建"
  2. click the found element
  3. wait for .eresh-dialog (timeout: 5000ms)
  4. snapshot .eresh-dialog with interactive: true

Verify conditions:
  - document.querySelector('.eresh-dialog') !== null

Expected returns:
  - success: boolean
  - dialogTitle: string
  - dialogRef: string
  - elements: array
```

---

## 8. SKILL.md 集成

更新 agent-browser SKILL.md，添加操作发现和调用说明：

```markdown
## Semantic Actions (推荐)

对于已注册的组件库，优先使用预定义的语义化操作，而非手动执行 click/fill 等基础命令。

### 发现可用操作

\`\`\`bash
# 列出所有可用操作
agent-browser action list

# 列出特定命名空间的操作
agent-browser action list eresh

# 查看操作详情和参数
agent-browser action describe eresh:dialog:open

# 获取 JSON schema（用于理解参数结构）
agent-browser action describe eresh:dialog:open --json
\`\`\`

### 执行操作

\`\`\`bash
agent-browser action run <namespace>:<component>:<action> [--param value...]
\`\`\`

### 常用操作示例

\`\`\`bash
# 打开弹框
agent-browser action run eresh:dialog:open --trigger "新建"

# 关闭弹框
agent-browser action run eresh:dialog:close

# 表格排序
agent-browser action run eresh:table:sort --column "创建时间" --order desc

# 填写表单字段
agent-browser action run eresh:form:fill-field --label "名称" --value "测试项目"

# 登录
agent-browser action run business:auth:login --username admin --password secret
\`\`\`

### 最佳实践

1. **优先使用语义化操作**: 比手动操作更可靠、更快速
2. **先发现再使用**: 执行前用 `action describe` 了解参数要求
3. **检查返回值**: 操作返回结构化结果，可用于后续判断
4. **组合使用**: 可以将多个操作组合完成复杂流程
```

---

## 9. 实现计划

### 9.1 第一阶段: 核心功能 (2 周)

| 任务 | 说明 | 工时 |
|------|------|------|
| YAML 解析器 | 实现操作定义 YAML 文件解析 | 2d |
| Registry 服务 | 实现操作注册、查找、加载 | 2d |
| CLI 命令 | 实现 action list/describe/run | 2d |
| 步骤执行器 | 实现 steps 解析和执行 | 3d |
| 变量系统 | 实现参数/输出变量替换 | 1d |

**里程碑**: 能够定义和执行简单操作

### 9.2 第二阶段: 增强功能 (2 周)

| 任务 | 说明 | 工时 |
|------|------|------|
| 条件执行 | 实现 when 条件判断 | 1d |
| 错误处理 | 实现 on_error、fallback、retry | 2d |
| 验证系统 | 实现 verify 条件检查 | 1d |
| 版本管理 | 实现版本兼容性检查和选择器覆盖 | 2d |
| 调试功能 | 实现 debug、dry-run 模式 | 2d |
| 操作组合 | 实现 action: run 调用其他操作 | 2d |

**里程碑**: 支持复杂操作定义和调试

### 9.3 第三阶段: 生态建设 (2 周)

| 任务 | 说明 | 工时 |
|------|------|------|
| 分层加载 | 实现多层级操作定义加载 | 2d |
| npm 包支持 | 实现从 npm 包加载操作定义 | 2d |
| SKILL.md 更新 | 更新 AI Agent 使用说明 | 1d |
| eresh 操作定义 | 为 eresh 组件库编写完整操作定义 | 3d |
| 文档 | 编写使用文档和最佳实践 | 2d |

**里程碑**: 完整可用的操作注册表系统

---

## 10. 附录

### 10.1 目录结构

```
agent-browser/
├── src/
│   ├── actions/
│   │   ├── registry.ts       # 操作注册表
│   │   ├── loader.ts         # 操作定义加载器
│   │   ├── executor.ts       # 操作执行器
│   │   ├── parser.ts         # YAML 解析器
│   │   ├── validator.ts      # 定义验证器
│   │   └── types.ts          # 类型定义
│   └── ...
├── cli/
│   └── src/
│       ├── commands/
│       │   └── action.rs     # action 子命令
│       └── ...
├── actions/                   # 内置操作定义
│   └── common.yaml
└── ...
```

### 10.2 配置文件

```yaml
# ~/.agent-browser/config.yaml
actions:
  # 操作定义搜索路径
  paths:
    - "~/.agent-browser/actions"
    - "./.agent-browser/actions"
  
  # npm 包
  packages:
    - "@company/ab-actions-eresh"
    
  # 默认超时
  default_timeout: 5000
  
  # 调试模式
  debug: false
  
  # 版本检测
  detect_version: true
```

### 10.3 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENT_BROWSER_ACTIONS_PATH` | 额外的操作定义路径 | - |
| `AGENT_BROWSER_ACTIONS_DEBUG` | 启用调试模式 | false |
| `AGENT_BROWSER_ACTIONS_TIMEOUT` | 默认超时时间 | 5000 |
