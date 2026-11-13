import type { VariableTable } from '@sylvie/types';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 校验文本中的 `{variable}` 占位符语法。
 * `{{` / `}}` 视为转义后的花括号，不参与替换。
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
