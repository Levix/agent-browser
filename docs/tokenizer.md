# 词法分析器 (Tokenizer) 实现文档

## 概述

词法分析器 (Tokenizer) 是表达式解析系统的第一层，负责将表达式字符串转换为 Token 流，为后续的语法解析提供基础。

## 功能特性

### 支持的 Token 类型

#### 字面量
- **数字** (`NUMBER`): 整数和浮点数，如 `42`, `3.14`
- **字符串** (`STRING`): 单引号或双引号字符串，如 `"hello"`, `'world'`
- **布尔值**: `true` (`TRUE`), `false` (`FALSE`)
- **空值**: `null` (`NULL`)
- **标识符** (`IDENTIFIER`): 变量名和路径，如 `age`, `params.user.name`

#### 操作符
- **比较操作符**: `==`, `!=`, `>`, `<`, `>=`, `<=`
- **逻辑操作符**: `&&` (AND), `||` (OR), `!` (NOT)

#### 分隔符
- **括号**: `(`, `)`

#### 特殊
- **文件结束** (`EOF`): 输入结束标记

### 特性

1. **精确的位置跟踪**: 每个 Token 都包含位置和长度信息，便于错误定位
2. **转义序列支持**: 字符串中支持 `\n`, `\t`, `\r`, `\\`, `\"`, `\'`
3. **空白符处理**: 自动跳过空格、制表符、换行符
4. **变量路径**: 支持点号分隔的多级路径，如 `params.user.name`
5. **友好的错误信息**: 包含位置信息的详细错误提示

## API

### Tokenizer 类

```typescript
const tokenizer = new Tokenizer('age > 18');
```

#### 方法

##### `nextToken(): Token`

返回下一个 Token：

```typescript
const token = tokenizer.nextToken();
// { type: TokenType.IDENTIFIER, value: 'age', position: 0, length: 3 }
```

##### `tokenize(): Token[]`

一次性获取所有 Token（包括 EOF）：

```typescript
const tokens = tokenizer.tokenize();
// [
//   { type: TokenType.IDENTIFIER, value: 'age', ... },
//   { type: TokenType.GT, value: '>', ... },
//   { type: TokenType.NUMBER, value: 18, ... },
//   { type: TokenType.EOF, value: '', ... }
// ]
```

### Token 接口

```typescript
interface Token {
  type: TokenType;              // Token 类型
  value: string | number | boolean | null;  // Token 值
  position: number;             // 在输入中的起始位置
  length: number;               // Token 长度
}
```

### TokenizerError

```typescript
class TokenizerError extends Error {
  position: number;    // 错误位置
  input: string;       // 输入字符串
}
```

## 使用示例

### 基础用法

```typescript
import { Tokenizer, TokenType } from './vars';

// 创建 tokenizer
const tokenizer = new Tokenizer('status == "active"');

// 获取所有 tokens
const tokens = tokenizer.tokenize();

// 遍历 tokens
for (const token of tokens) {
  if (token.type === TokenType.EOF) break;
  console.log(`${token.type}: ${token.value}`);
}
// 输出:
// IDENTIFIER: status
// EQ: ==
// STRING: active
```

### 复杂表达式

```typescript
const expr = '(age >= 18) && (status == "active" || premium == true)';
const tokenizer = new Tokenizer(expr);
const tokens = tokenizer.tokenize();

// tokens 包含所有操作符、标识符、字面量和括号
```

### 错误处理

```typescript
try {
  const tokenizer = new Tokenizer('"unterminated string');
  tokenizer.tokenize();
} catch (error) {
  if (error instanceof TokenizerError) {
    console.error(`Error at position ${error.position}: ${error.message}`);
  }
}
```

### 逐个读取 Token

```typescript
const tokenizer = new Tokenizer('a + b');
let token: Token;

do {
  token = tokenizer.nextToken();
  console.log(token.type, token.value);
} while (token.type !== TokenType.EOF);
```

## 测试覆盖

实现了 41 个测试用例，覆盖以下场景：

- ✅ 所有基本 Token 类型
- ✅ 所有操作符
- ✅ 转义序列处理
- ✅ 空白符处理
- ✅ 复杂表达式
- ✅ 边界情况（空输入、纯空白等）
- ✅ 错误场景（未闭合字符串、非法字符等）
- ✅ 位置跟踪
- ✅ 逐个读取模式

测试文件: [src/actions/vars.tokenizer.test.ts](../src/actions/vars.tokenizer.test.ts)

## 设计考虑

### 安全性

1. **无代码执行**: 仅执行词法分析，不执行任何代码
2. **严格的字符集**: 只识别预定义的操作符和关键字
3. **明确的错误**: 遇到非法字符立即抛出异常

### 性能

1. **单次扫描**: 线性时间复杂度 O(n)
2. **最小内存占用**: 只保存必要的状态
3. **惰性求值**: `nextToken()` 方法支持流式处理

### 扩展性

设计预留了扩展空间：
- Token 类型枚举可轻松添加新类型
- 操作符识别逻辑集中，便于添加新操作符
- 位置信息完整，支持更复杂的错误报告

## 下一步

词法分析器已完成，接下来需要实现：

1. **语法解析器 (Parser)**: 将 Token 流转换为抽象语法树 (AST)
2. **求值器 (Evaluator)**: 遍历 AST 并计算表达式结果
3. **类型转换**: 实现 toBoolean、toNumber 等辅助函数
4. **安全限制**: 实现 AST 深度限制、禁止函数调用等安全措施

## 相关文件

- 实现: [src/actions/vars.ts](../src/actions/vars.ts)
- 测试: [src/actions/vars.tokenizer.test.ts](../src/actions/vars.tokenizer.test.ts)
- 类型定义: [src/actions/types.ts](../src/actions/types.ts)
- 设计文档: [docs/design-v2.md](./design-v2.md)
- 实施计划: [docs/plan.md](./plan.md)
