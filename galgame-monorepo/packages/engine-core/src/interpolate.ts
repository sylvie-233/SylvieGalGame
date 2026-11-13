/**
 * 对话文本的变量插值。
 *
 * 语法只有 `{variable}`，变量名规则与表达式解析器保持一致；
 * `{{` / `}}` 是转义后的花括号。插值在引擎阻塞到 text 时求值一次，
 * 因此同一句台词在本次显示期间不会随变量变化。
 */
import type { VariableTable } from '@sylvie/types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 校验文本中的 `{variable}` 占位符语法。
 * `{{` / `}}` 视为转义后的花括号，不参与替换。
 *
 * @returns 无错误时返回 null，否则返回面向作者的中文错误信息。
 */
export function validateInterpolation(template: string): string | null {
  let index = 0;
  while (index < template.length) {
    const char = template[index] ?? '';
    if (char === '{' && template[index + 1] === '{') {
      index += 2;
      continue;
    }
    if (char === '}' && template[index + 1] === '}') {
      index += 2;
      continue;
    }
    if (char !== '{') {
      index += 1;
      continue;
    }

    const end = template.indexOf('}', index + 1);
    if (end < 0) {
      return `占位符 ${JSON.stringify(template.slice(index))} 缺少结束的 "}"`;
    }
    const name = template.slice(index + 1, end);
    if (!IDENTIFIER.test(name)) {
      return `占位符 "${name}" 不是合法变量名（位置 ${index}）`;
    }
    index = end + 1;
  }
  return null;
}

/**
 * 把 `{variable}` 替换为当前变量值；未定义变量保留原占位符并发出警告。
 *
 * 单次扫描完成替换：变量值里的花括号不会被再次解析，避免递归展开。
 * 格式非法的占位符（如 `{a-b}`）原样保留，不视为变量。
 */
export function interpolateText(
  template: string,
  variables: VariableTable,
  warn?: (message: string) => void,
): string {
  if (!template.includes('{')) return template;

  let result = '';
  let index = 0;

  while (index < template.length) {
    const char = template[index] ?? '';

    // 成对花括号是转义：只输出一个，双写即可在文本中表示字面量。
    if (char === '{' && template[index + 1] === '{') {
      result += '{';
      index += 2;
      continue;
    }
    if (char === '}' && template[index + 1] === '}') {
      result += '}';
      index += 2;
      continue;
    }

    if (char !== '{') {
      result += char;
      index += 1;
      continue;
    }

    const end = template.indexOf('}', index + 1);
    if (end < 0) {
      result += template.slice(index);
      break;
    }

    const name = template.slice(index + 1, end);
    if (!IDENTIFIER.test(name)) {
      result += template.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    // 未定义变量不替换，保留原样让作者能从画面上直接发现问题。
    const value = variables[name];
    if (value === undefined) {
      warn?.(`[文本] 未定义变量 "${name}"，已保留占位符`);
      result += template.slice(index, end + 1);
    } else {
      result += String(value);
    }
    index = end + 1;
  }

  return result;
}
