export type VariableValue = number | boolean | string;

/** 全局变量表，随存档持久化。 */
export type VariableTable = Record<string, VariableValue>;
