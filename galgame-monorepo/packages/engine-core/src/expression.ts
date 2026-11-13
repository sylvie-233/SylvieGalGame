/**
 * 剧本条件 / 赋值表达式的小型求值器。
 *
 * 语法刻意保持最小：数字、布尔、字符串、变量、算术、比较、`&&` / `||` / `!`。
 * 不使用 eval，保证剧本内容不能执行任意代码。错误统一抛 ExpressionError，
 * 由调用方决定是警告后继续还是中止（引擎通常警告并保持原状态）。
 */
import type { VariableTable, VariableValue } from '@sylvie/types';

/** 表达式求值结果，复用剧情变量的标量类型。 */
export type ExprValue = VariableValue;

/** 表达式词法 / 语法 / 求值错误；message 面向剧本作者，可直接展示。 */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type TokenKind = 'number' | 'string' | 'identifier' | 'operator' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

// 双字符运算符必须先于单字符匹配，否则 "==" 会被拆成两个 "="。
const TWO_CHAR_OPERATORS = new Set(['&&', '||', '==', '!=', '<=', '>=']);
// 括号也归入 operator，简化递归下降的匹配逻辑。
const ONE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '!', '<', '>', '(', ')']);

/**
 * 词法分析：跳过空白，产出带源码位置的记号。
 * 字符串支持 `\n` / `\t` 与反斜杠转义；数字支持整数与小数（需以数字开头）。
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = '';
      while (index < source.length && source[index] !== quote) {
        const current = source[index] ?? '';
        if (current === '\\' && index + 1 < source.length) {
          const next = source[index + 1] ?? '';
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          index += 2;
        } else {
          value += current;
          index += 1;
        }
      }
      if (index >= source.length) {
        throw new ExpressionError(`字符串缺少结束引号（位置 ${start}）`);
      }
      index += 1;
      tokens.push({ kind: 'string', value, pos: start });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)/.exec(source.slice(index));
      if (!match) {
        throw new ExpressionError(`数字格式错误（位置 ${index}）`);
      }
      tokens.push({ kind: 'number', value: match[0], pos: index });
      index += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
      if (!match) {
        throw new ExpressionError(`标识符格式错误（位置 ${index}）`);
      }
      tokens.push({ kind: 'identifier', value: match[0], pos: index });
      index += match[0].length;
      continue;
    }

    const two = source.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({ kind: 'operator', value: two, pos: index });
      index += 2;
      continue;
    }

    if (ONE_CHAR_OPERATORS.has(char)) {
      tokens.push({ kind: 'operator', value: char, pos: index });
      index += 1;
      continue;
    }

    throw new ExpressionError(`无法识别的字符 "${char}"（位置 ${index}）`);
  }

  tokens.push({ kind: 'eof', value: '', pos: source.length });
  return tokens;
}

/**
 * 统一真值语义：false、0、非有限数与空字符串为假，其余为真。
 * 显式限定语义而不是依赖 JavaScript 隐式转换，保证剧本行为可预期。
 */
function truthy(value: ExprValue): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && Number.isFinite(value);
  }
  return value.length > 0;
}

/**
 * 转为数字：数字原样返回；字符串需形如数字（允许首尾空格）；
 * 其他类型或空字符串抛错，而不是静默变成 0 / NaN。
 */
function toNumber(value: ExprValue, context: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (value.trim() !== '' && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new ExpressionError(`${context}需要数字，实际是 ${typeof value} (${String(value)})`);
}

/** 字符串拼接时的统一转换。 */
function toStringValue(value: ExprValue): string {
  return String(value);
}

/**
 * 递归下降解析器，每次 parse() 消费完整表达式。
 *
 * allowUnknownVariables 仅供编译期校验使用：未知变量按 0 处理，
 * 这样即使变量尚未定义，也能检查语法与结构是否合法。
 */
class ExpressionParser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: VariableTable,
    private readonly allowUnknownVariables = false,
  ) {}

  /** 解析完整表达式；末尾必须恰好是 eof，否则视为多余内容。 */
  parse(): ExprValue {
    const value = this.parseOr();
    if (this.peek().kind !== 'eof') {
      throw new ExpressionError(`表达式多余内容 "${this.peek().value}"（位置 ${this.peek().pos}）`);
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.position] ?? { kind: 'eof', value: '', pos: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private matchOperator(operator: string): boolean {
    const token = this.peek();
    if (token.kind === 'operator' && token.value === operator) {
      this.position += 1;
      return true;
    }
    return false;
  }

  // 以下 parseXxx 按优先级从低到高递归；注意两侧都会求值，不做短路。
  private parseOr(): ExprValue {
    let left = this.parseAnd();
    while (this.matchOperator('||')) {
      const right = this.parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  private parseAnd(): ExprValue {
    let left = this.parseEquality();
    while (this.matchOperator('&&')) {
      const right = this.parseEquality();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  private parseEquality(): ExprValue {
    let left = this.parseComparison();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'operator' || (token.value !== '==' && token.value !== '!=')) {
        return left;
      }
      this.position += 1;
      const right = this.parseComparison();
      const equal = valuesEqual(left, right);
      left = token.value === '==' ? equal : !equal;
    }
  }

  private parseComparison(): ExprValue {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.peek();
      if (
        token.kind !== 'operator' ||
        (token.value !== '<' && token.value !== '<=' && token.value !== '>' && token.value !== '>=')
      ) {
        return left;
      }
      this.position += 1;
      const right = this.parseAdditive();
      const comparison = compareValues(left, right, token.value);
      left = comparison;
    }
  }

  // 任一侧是字符串时 `+` 做拼接，否则两侧都必须能转成数字。
  private parseAdditive(): ExprValue {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'operator' || (token.value !== '+' && token.value !== '-')) {
        return left;
      }
      this.position += 1;
      const right = this.parseMultiplicative();
      if (token.value === '+' && (typeof left === 'string' || typeof right === 'string')) {
        left = `${toStringValue(left)}${toStringValue(right)}`;
        continue;
      }
      const leftNumber = toNumber(left, '运算符 “+/-” ');
      const rightNumber = toNumber(right, '运算符 “+/-” ');
      left = token.value === '+' ? leftNumber + rightNumber : leftNumber - rightNumber;
    }
  }

  // 除数为 0 直接报错，避免产生 Infinity / NaN 污染后续判断。
  private parseMultiplicative(): ExprValue {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'operator' || (token.value !== '*' && token.value !== '/')) {
        return left;
      }
      this.position += 1;
      const right = this.parseUnary();
      const leftNumber = toNumber(left, '运算符 "*" 或 "/" ');
      const rightNumber = toNumber(right, '运算符 "*" 或 "/" ');
      if (token.value === '/' && rightNumber === 0) {
        throw new ExpressionError('除数不能为 0');
      }
      left = token.value === '*' ? leftNumber * rightNumber : leftNumber / rightNumber;
    }
  }

  // 一元运算符右结合，允许 `!!x` / `--x` 这类写法。
  private parseUnary(): ExprValue {
    if (this.matchOperator('!')) {
      return !truthy(this.parseUnary());
    }
    const token = this.peek();
    if (token.kind === 'operator' && (token.value === '-' || token.value === '+')) {
      this.position += 1;
      const value = toNumber(this.parseUnary(), '一元运算符');
      return token.value === '-' ? -value : value;
    }
    return this.parsePrimary();
  }

  // 标识符优先识别 true / false 字面量，其余按变量表取值。
  private parsePrimary(): ExprValue {
    const token = this.advance();
    if (token.kind === 'number') {
      return Number(token.value);
    }
    if (token.kind === 'string') {
      return token.value;
    }
    if (token.kind === 'identifier') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (!Object.prototype.hasOwnProperty.call(this.variables, token.value)) {
        if (this.allowUnknownVariables) {
          return 0;
        }
        throw new ExpressionError(`变量 "${token.value}" 未定义`);
      }
      return this.variables[token.value] as ExprValue;
    }
    if (token.kind === 'operator' && token.value === '(') {
      const value = this.parseOr();
      if (!this.matchOperator(')')) {
        throw new ExpressionError('缺少右括号');
      }
      return value;
    }
    throw new ExpressionError(`意外的记号 "${token.value}"（位置 ${token.pos}）`);
  }
}

/**
 * 相等比较：同类型按严格相等；数字与可解析为数字的字符串按数值比较。
 * 无法比较时返回 false，而不是抛错（`==` 用于判断而非强制类型转换）。
 */
function valuesEqual(left: ExprValue, right: ExprValue): boolean {
  if (typeof left === typeof right) {
    if (typeof left === 'number' || typeof left === 'string' || typeof left === 'boolean') {
      return left === right;
    }
  }
  if (
    (typeof left === 'number' && typeof right === 'string') ||
    (typeof left === 'string' && typeof right === 'number')
  ) {
    const leftText = toStringValue(left).trim();
    const rightText = toStringValue(right).trim();
    const leftNumber = Number(leftText);
    const rightNumber = Number(rightText);
    if (leftText !== '' && rightText !== '' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber === rightNumber;
    }
  }
  return false;
}

/**
 * 大小比较：字符串与字符串按字典序；数字 / 数字字符串按数值。
 * 布尔或其他类型组合直接报错，避免隐式转换产生歧义结果。
 */
function compareValues(left: ExprValue, right: ExprValue, operator: string): boolean {
  let leftComparable: number | string;
  let rightComparable: number | string;

  if (typeof left === 'string' && typeof right === 'string') {
    leftComparable = left;
    rightComparable = right;
  } else if (
    (typeof left === 'number' || typeof left === 'string') &&
    (typeof right === 'number' || typeof right === 'string')
  ) {
    const leftNumber = typeof left === 'number' ? left : Number(left.trim());
    const rightNumber = typeof right === 'number' ? right : Number(right.trim());
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
      throw new ExpressionError(`无法比较 "${String(left)}" 与 "${String(right)}"`);
    }
    leftComparable = leftNumber;
    rightComparable = rightNumber;
  } else {
    throw new ExpressionError(`无法比较 ${typeof left} 与 ${typeof right}`);
  }

  switch (operator) {
    case '<':
      return leftComparable < rightComparable;
    case '<=':
      return leftComparable <= rightComparable;
    case '>':
      return leftComparable > rightComparable;
    case '>=':
      return leftComparable >= rightComparable;
    default:
      throw new ExpressionError(`未知比较运算符 "${operator}"`);
  }
}

/**
 * 求值并返回原始结果。
 * 空表达式、未知变量、类型不匹配等都会抛出 ExpressionError，由调用方处理。
 */
export function evaluateExpression(source: string, variables: VariableTable): ExprValue {
  if (!source.trim()) {
    throw new ExpressionError('表达式为空');
  }
  const parser = new ExpressionParser(tokenize(source), variables);
  return parser.parse();
}

/** 条件求值：truthy 语义（false / 0 / 空字符串为假）。 */
export function evaluateCondition(source: string, variables: VariableTable): boolean {
  return truthy(evaluateExpression(source, variables));
}

/**
 * 编译期校验，返回错误信息；无错误时返回 null。
 * 未知变量按 0 处理，因此这里只检查语法 / 结构，不检查变量是否存在。
 */
export function validateExpression(source: string): string | null {
  try {
    if (!source.trim()) {
      return '表达式为空';
    }
    const parser = new ExpressionParser(tokenize(source), {}, true);
    parser.parse();
    return null;
  } catch (error) {
    if (error instanceof ExpressionError) {
      return error.message;
    }
    return String(error);
  }
}

export { truthy };
