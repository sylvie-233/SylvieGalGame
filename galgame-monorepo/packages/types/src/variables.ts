/**
 * 剧情变量允许的标量类型。
 * 刻意不支持对象 / 数组，便于存档序列化与表达式求值保持一致。
 */
export type VariableValue = number | boolean | string;

/** 全局变量表，随存档持久化；键名需满足表达式标识符规则。 */
export type VariableTable = Record<string, VariableValue>;
