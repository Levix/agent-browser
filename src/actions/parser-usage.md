# Parser 使用示例

本文档展示递归下降语法解析器（Parser）的功能。

## 基础用法

```typescript
import { parseExpression } from './vars';

// 解析简单的比较表达式
const ast1 = parseExpression('5 > 3');
// 返回 BinaryOpNode { operator: '>', left: NumberNode, right: NumberNode }

// 解析逻辑表达式
const ast2 = parseExpression('true && false');
// 返回 BinaryOpNode { operator: '&&', left: BooleanNode, right: BooleanNode }

// 解析带括号的表达式
const ast3 = parseExpression('(5 > 3) && (2 < 4)');
// 返回正确的 AST 结构
```

## 支持的语法

### 字面量

- **数字**: `42`, `3.14`
- **字符串**: `"hello"`, `'world'`
- **布尔值**: `true`, `false`
- **空值**: `null`
- **标识符**: `params.username`, `env.API_KEY`

### 比较运算符

- `==` - 等于
- `!=` - 不等于
- `>` - 大于
- `<` - 小于
- `>=` - 大于等于
- `<=` - 小于等于

### 逻辑运算符

- `&&` - 逻辑与
- `||` - 逻辑或
- `!` - 逻辑非

### 括号分组

使用括号 `()` 可以改变运算优先级。

## 运算符优先级

从高到低：

1. 一元运算符（`!`）
2. 比较运算符（`>`, `<`, `>=`, `<=`）
3. 相等运算符（`==`, `!=`）
4. 逻辑与（`&&`）
5. 逻辑或（`||`）

## 复杂表达式示例

```typescript
// 检查用户状态和权限
parseExpression('(params.status == "active" || params.status == "pending") && params.role == "admin"');

// 范围检查
parseExpression('params.age >= 18 && params.age <= 65');

// 多重否定
parseExpression('!!params.enabled');

// 复杂的逻辑表达式
parseExpression('!(params.disabled) && (params.count > 0 || params.force == true)');
```

## AST 结构

Parser 生成抽象语法树（AST），包含以下节点类型：

- `NumberNode` - 数字字面量
- `StringNode` - 字符串字面量
- `BooleanNode` - 布尔字面量
- `NullNode` - null 字面量
- `IdentifierNode` - 变量引用
- `BinaryOpNode` - 二元运算
- `UnaryOpNode` - 一元运算

每个节点都包含位置信息（`position`），便于错误定位。

## 错误处理

Parser 会在遇到语法错误时抛出 `ParserError`：

```typescript
try {
  parseExpression('5 > (3'); // 缺少右括号
} catch (error) {
  if (error instanceof ParserError) {
    console.log(error.message); // "Expected closing parenthesis ")" at position X"
    console.log(error.position); // 错误位置
    console.log(error.input); // 原始输入
  }
}
```

## 安全特性

- **无函数调用** - 不支持函数调用语法
- **无对象/数组字面量** - 仅支持基本字面量
- **无赋值操作** - 纯表达式求值
- **有限的运算符** - 仅支持白名单中的运算符
- **位置追踪** - 所有错误都包含位置信息

## 下一步

Parser 生成的 AST 将传递给 Evaluator（求值器）进行实际的表达式求值。
