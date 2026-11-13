import type { VariableTable, VariableValue } from '@sylvie/types';

export type ExprValue = VariableValue;

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

const TWO_CHAR_OPERATORS = new Set(['&&', '||', '==', '!=', '<=', '>=']);
const ONE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '!', '<', '>', '(', ')']);

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

function truthy(value: ExprValue): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && Number.isFinite(value);
  }
  return value.length > 0;
}

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

function toStringValue(value: ExprValue): string {
  return String(value);
}

class ExpressionParser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: VariableTable,
    private readonly allowUnknownVariables = false,
  ) {}

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

/** 求值，出错时抛出 ExpressionError。 */
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

/** 编译期校验，返回错误信息；无错误时返回 null。 */
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
