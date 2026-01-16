# agent-browser 指令操作封装方案选型

## 背景

目前 agent-browser 只支持单个指令的形式在终端运行。为了提升使用效率，需要支持封装常用的指令操作（如登录、表单提交、数据抓取等），实现一次调用执行一系列指令。

## 典型使用场景

1. **登录操作**: 访问登录页 → 输入账号密码 → 点击登录 → 验证登录成功
2. **表单提交**: 打开表单 → 填写多个字段 → 提交 → 验证成功
3. **数据抓取**: 访问列表页 → 翻页 → 提取数据 → 循环直到结束
4. **购物流程**: 搜索商品 → 加入购物车 → 结算 → 填写地址 → 支付

---

## 方案一: Shell 脚本封装

### 描述

使用 Bash/PowerShell 脚本将多个 agent-browser 命令串联起来。

### 实现示例

```bash
#!/bin/bash
# login.sh - 登录脚本

URL=$1
USERNAME=$2
PASSWORD=$3

agent-browser open "$URL"
agent-browser snapshot -i

agent-browser fill @e1 "$USERNAME"
agent-browser fill @e2 "$PASSWORD"
agent-browser click @e3

agent-browser wait --load networkidle
agent-browser wait --url "**/dashboard"

# 验证登录成功
TITLE=$(agent-browser get title)
if [[ "$TITLE" == *"Dashboard"* ]]; then
    echo "Login successful"
else
    echo "Login failed"
    exit 1
fi
```

### 优点

- 零开发成本，直接使用现有命令
- 灵活性高，可使用 shell 的条件判断和循环
- 易于调试和修改
- 跨平台 (Bash/PowerShell)

### 缺点

- 每个命令都是独立进程，性能开销大
- 错误处理不够优雅
- 脚本可读性较差
- 参数传递不够灵活
- Windows 和 Unix 需要维护两套脚本

### 适用场景

- 简单的自动化任务
- 临时性的操作封装
- 开发调试阶段

---

## 方案二: 批量指令文件 (Batch Command File)

### 描述

定义一种简单的指令文件格式，支持一次性读取并执行多条命令。

### 实现示例

**指令文件格式 (login.ab)**:
```yaml
# agent-browser batch file
name: login
description: Login to a website
args:
  - name: url
    required: true
  - name: username
    required: true
  - name: password
    required: true

steps:
  - open ${url}
  - snapshot -i
  - fill @e1 ${username}
  - fill @e2 ${password}
  - click @e3
  - wait --load networkidle
  - wait --url "**/dashboard"
```

**CLI 调用**:
```bash
agent-browser run login.ab --url https://example.com --username user --password pass
```

### 优点

- 用户友好，语法简洁
- 所有命令在同一进程执行，性能好
- 支持参数化
- 易于分享和复用

### 缺点

- 需要开发新的解析器
- 控制流支持有限（需要额外语法支持条件和循环）
- 不支持复杂逻辑
- 需要维护新的文件格式规范

### 适用场景

- 线性的操作流程
- 需要参数化的重复操作
- 团队共享的标准化流程

---

## 方案三: JSON/YAML 工作流定义

### 描述

使用 JSON 或 YAML 定义完整的工作流，支持条件判断、循环、变量等高级特性。

### 实现示例

**workflow.yaml**:
```yaml
name: login-workflow
version: "1.0"

variables:
  loginUrl: "https://example.com/login"
  dashboardUrl: "https://example.com/dashboard"

inputs:
  username:
    type: string
    required: true
  password:
    type: string
    required: true
    secret: true

steps:
  - id: navigate
    action: open
    args:
      url: ${loginUrl}

  - id: get-elements
    action: snapshot
    options:
      interactive: true

  - id: fill-username
    action: fill
    args:
      selector: "@e1"
      value: ${inputs.username}

  - id: fill-password
    action: fill
    args:
      selector: "@e2"
      value: ${inputs.password}

  - id: submit
    action: click
    args:
      selector: "@e3"

  - id: wait-navigation
    action: wait
    args:
      load: networkidle

  - id: verify-login
    action: get
    args:
      type: url
    assert:
      contains: dashboard

outputs:
  success: ${steps.verify-login.success}
  currentUrl: ${steps.verify-login.result}
```

**CLI 调用**:
```bash
agent-browser workflow run login-workflow.yaml \
  --input username=admin \
  --input password=secret
```

### 优点

- 结构化定义，支持版本控制
- 支持变量、断言、输出
- 可扩展性强
- 便于与 CI/CD 集成
- 支持复杂的业务逻辑

### 缺点

- 学习曲线较高
- 实现复杂度高
- YAML 格式对缩进敏感，容易出错
- 调试困难

### 适用场景

- 企业级自动化流程
- 需要版本管理的测试用例
- CI/CD 集成
- 复杂的多步骤工作流

---

## 方案四: JavaScript/TypeScript SDK

### 描述

提供 JavaScript/TypeScript SDK，允许用户用编程方式调用 agent-browser。

### 实现示例

**login.ts**:
```typescript
import { AgentBrowser, Session } from 'agent-browser';

interface LoginOptions {
  url: string;
  username: string;
  password: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

async function login(options: LoginOptions): Promise<boolean> {
  const browser = new AgentBrowser();
  
  try {
    await browser.open(options.url);
    const snapshot = await browser.snapshot({ interactive: true });
    
    // 自动识别或使用指定选择器
    const usernameField = options.usernameSelector || snapshot.findByLabel('username', 'email');
    const passwordField = options.passwordSelector || snapshot.findByLabel('password');
    const submitButton = options.submitSelector || snapshot.findByRole('button', 'submit');
    
    await browser.fill(usernameField, options.username);
    await browser.fill(passwordField, options.password);
    await browser.click(submitButton);
    
    await browser.wait({ load: 'networkidle' });
    
    const currentUrl = await browser.getUrl();
    return currentUrl.includes('dashboard');
  } catch (error) {
    console.error('Login failed:', error);
    return false;
  }
}

// 使用
const success = await login({
  url: 'https://example.com/login',
  username: 'admin',
  password: 'secret'
});
```

**发布为可复用模块**:
```typescript
// agent-browser-recipes/src/login.ts
export { login } from './recipes/login';
export { fillForm } from './recipes/form';
export { scrapeTable } from './recipes/scrape';
```

### 优点

- 完全的编程能力（条件、循环、异常处理）
- 类型安全（TypeScript）
- 可复用、可测试、可组合
- 与现有 Node.js 生态系统集成
- IDE 支持完善（代码补全、跳转定义）

### 缺点

- 需要 JavaScript 开发经验
- 非技术用户难以使用
- 需要额外的构建步骤
- 进程间通信复杂度增加

### 适用场景

- 开发者使用
- 复杂的业务逻辑
- 需要与其他系统集成
- 可复用的自动化库

---

## 方案五: 内置 Recipe 命令

### 描述

在 CLI 中内置一些常用的操作封装，作为一级命令提供。

### 实现示例

```bash
# 内置登录 recipe
agent-browser recipe login \
  --url https://example.com/login \
  --username-selector "@e1" \
  --password-selector "@e2" \
  --submit-selector "@e3" \
  --username admin \
  --password secret \
  --success-url "**/dashboard"

# 内置表单填写 recipe
agent-browser recipe form \
  --url https://example.com/form \
  --data '{"name": "John", "email": "john@example.com"}' \
  --submit-selector "@e5"

# 内置截图对比 recipe
agent-browser recipe visual-diff \
  --url https://example.com \
  --baseline ./baseline.png \
  --threshold 0.1

# 列出可用 recipes
agent-browser recipe list

# 查看 recipe 帮助
agent-browser recipe login --help
```

**Rust 实现** (cli/src/recipes.rs):
```rust
pub fn run_login_recipe(args: &LoginArgs) -> Result<Value, Error> {
    let commands = vec![
        json!({"action": "navigate", "url": args.url}),
        json!({"action": "snapshot", "interactive": true}),
        json!({"action": "fill", "selector": args.username_selector, "value": args.username}),
        json!({"action": "fill", "selector": args.password_selector, "value": args.password}),
        json!({"action": "click", "selector": args.submit_selector}),
        json!({"action": "wait", "load": "networkidle"}),
    ];
    
    for cmd in commands {
        send_command(&cmd)?;
    }
    
    // 验证
    let url_result = send_command(&json!({"action": "get_url"}))?;
    if url_result.contains(&args.success_url) {
        Ok(json!({"success": true, "message": "Login successful"}))
    } else {
        Err(Error::LoginFailed)
    }
}
```

### 优点

- 开箱即用，无需额外配置
- 高性能（原生 Rust 实现）
- 用户友好的 CLI 接口
- 可以覆盖常见场景

### 缺点

- 灵活性受限，只能使用预定义的 recipe
- 新增 recipe 需要修改源码并发布新版本
- 难以满足个性化需求

### 适用场景

- 标准化的常见操作
- 快速上手的新用户
- 不想编写脚本的场景

---

## 方案六: 插件/扩展系统

### 描述

设计插件系统，允许用户安装和使用第三方封装的操作。

### 实现示例

**插件结构**:
```
agent-browser-plugin-auth/
  ├── package.json
  ├── plugin.json
  └── src/
      ├── login.ts
      ├── logout.ts
      └── register.ts
```

**plugin.json**:
```json
{
  "name": "auth",
  "version": "1.0.0",
  "commands": {
    "login": {
      "description": "Login to a website",
      "handler": "./src/login.js",
      "options": [
        {"name": "url", "type": "string", "required": true},
        {"name": "username", "type": "string", "required": true},
        {"name": "password", "type": "string", "required": true, "secret": true}
      ]
    },
    "logout": {
      "description": "Logout from current session",
      "handler": "./src/logout.js"
    }
  }
}
```

**CLI 调用**:
```bash
# 安装插件
agent-browser plugin install agent-browser-plugin-auth

# 使用插件命令
agent-browser auth:login --url https://example.com --username admin --password secret

# 列出已安装插件
agent-browser plugin list

# 卸载插件
agent-browser plugin uninstall agent-browser-plugin-auth
```

### 优点

- 高度可扩展
- 社区可以贡献插件
- 核心保持精简
- 按需安装，不占用资源

### 缺点

- 实现复杂度高
- 需要建立插件生态系统
- 版本兼容性管理困难
- 安全性考虑（运行第三方代码）

### 适用场景

- 成熟的产品阶段
- 需要社区贡献的场景
- 企业定制化需求

---

## 方案七: 管道模式 (Pipe Mode)

### 描述

支持从 stdin 读取多条命令，或通过管道连续执行命令。

### 实现示例

```bash
# 从 stdin 读取命令
cat << 'EOF' | agent-browser pipe
open https://example.com/login
snapshot -i
fill @e1 admin
fill @e2 secret
click @e3
wait --load networkidle
get url
EOF

# 从文件读取命令
agent-browser pipe < login-commands.txt

# 带变量替换
cat login-commands.txt | envsubst | agent-browser pipe

# 交互模式 (REPL)
agent-browser repl
> open https://example.com
> snapshot -i
> fill @e1 "test"
> .save login-macro.txt  # 保存当前会话的命令
> .quit
```

**login-commands.txt**:
```
open https://example.com/login
snapshot -i
fill @e1 ${USERNAME}
fill @e2 ${PASSWORD}
click @e3
wait --load networkidle
get url
```

### 优点

- 实现简单
- 与 Unix 管道哲学一致
- 灵活的组合方式
- 可以配合其他 CLI 工具使用

### 缺点

- 没有变量和控制流（除非配合外部工具）
- 错误处理能力有限
- 调试困难

### 适用场景

- Unix/Linux 高级用户
- 与其他脚本语言配合使用
- 快速测试和原型

---

## 方案八: Macro 录制与回放

### 描述

录制用户的操作，保存为可回放的 macro 文件。

### 实现示例

```bash
# 开始录制
agent-browser macro record login-macro
# ... 执行各种操作 ...
# 按 Ctrl+C 或执行 stop 结束录制

# 回放 macro
agent-browser macro play login-macro

# 带参数回放
agent-browser macro play login-macro \
  --var USERNAME=admin \
  --var PASSWORD=secret

# 列出已保存的 macros
agent-browser macro list

# 编辑 macro
agent-browser macro edit login-macro

# 导出/导入
agent-browser macro export login-macro > login.macro
agent-browser macro import < login.macro
```

**Macro 文件格式 (login.macro)**:
```json
{
  "name": "login-macro",
  "createdAt": "2026-01-15T10:00:00Z",
  "variables": ["USERNAME", "PASSWORD"],
  "commands": [
    {"action": "navigate", "url": "https://example.com/login"},
    {"action": "snapshot", "interactive": true},
    {"action": "fill", "selector": "@e1", "value": "${USERNAME}"},
    {"action": "fill", "selector": "@e2", "value": "${PASSWORD}"},
    {"action": "click", "selector": "@e3"},
    {"action": "wait", "load": "networkidle"}
  ]
}
```

### 优点

- 无需编写代码，录制即可
- 所见即所得
- 适合非技术用户
- 可以编辑和参数化

### 缺点

- 录制的操作可能不稳定（依赖特定选择器）
- 难以处理动态内容
- 维护成本高
- 不支持条件逻辑

### 适用场景

- 非技术用户
- 快速创建自动化脚本
- 回归测试

---

## 方案对比

| 方案 | 实现复杂度 | 用户友好度 | 灵活性 | 性能 | 可扩展性 |
|------|-----------|-----------|--------|------|----------|
| Shell 脚本 | 低 | 中 | 高 | 低 | 中 |
| 批量指令文件 | 中 | 高 | 中 | 高 | 中 |
| JSON/YAML 工作流 | 高 | 中 | 高 | 高 | 高 |
| JS/TS SDK | 中 | 低 | 极高 | 高 | 极高 |
| 内置 Recipe | 中 | 极高 | 低 | 极高 | 低 |
| 插件系统 | 极高 | 高 | 极高 | 高 | 极高 |
| 管道模式 | 低 | 中 | 中 | 高 | 中 |
| Macro 录制 | 高 | 极高 | 低 | 高 | 低 |

---

## 推荐方案

根据不同阶段和目标，推荐以下实施路径：

### 第一阶段: 快速实现（1-2 周）

**推荐: 方案七 管道模式 + 方案二 批量指令文件**

- 实现 `agent-browser pipe` 命令，支持从 stdin 读取多条命令
- 实现 `agent-browser run <file>` 命令，支持读取和执行指令文件
- 支持简单的变量替换 `${VAR}`

**理由**:
- 实现简单，改动量小
- 立即可用，解决痛点
- 为后续方案打基础

### 第二阶段: 能力增强（1-2 月）

**推荐: 方案四 JS/TS SDK + 方案五 内置 Recipe**

- 提供完整的 JavaScript/TypeScript API
- 内置 3-5 个常用 recipe（login, form, scrape 等）
- 发布 npm 包供开发者使用

**理由**:
- 满足开发者需求
- 提升产品竞争力
- 建立用户基础

### 第三阶段: 生态建设（3-6 月）

**推荐: 方案六 插件系统 + 方案八 Macro 录制**

- 设计并实现插件系统
- 支持社区贡献
- 提供可视化录制工具

**理由**:
- 长期可持续发展
- 降低使用门槛
- 建立社区生态

---

## 快速开始建议

如果只选择一个方案立即开始，建议选择 **方案七 管道模式**，原因如下：

1. **实现最简单**: 只需在 CLI 添加一个循环读取 stdin 的模式
2. **兼容性最好**: 现有命令格式无需改变
3. **灵活性足够**: 可配合 shell 脚本实现复杂逻辑
4. **可演进**: 后续可以在此基础上添加变量支持、条件判断等

**最小实现示例** (cli/src/main.rs):
```rust
fn run_pipe_mode(session: &str, json_mode: bool) {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let line = line.trim();
        
        // 跳过空行和注释
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        
        // 解析并执行命令
        let args: Vec<String> = shell_words::split(line).unwrap();
        match parse_command(&args, &Flags::default()) {
            Ok(cmd) => {
                let response = send_command(&cmd, session);
                print_response(&response, json_mode);
            }
            Err(e) => {
                eprintln!("Error: {}", e.format());
            }
        }
    }
}
```
