/** Escape precisely the declared grammar; retain Unicode and other literal text without JSON escapes. */
export function quote(text: string): string {
  return (
    '"' +
    text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') +
    '"'
  );
}
/** Indent authored statements without changing any quoted multiline payload. */
export function body(
  header: string,
  statements: readonly string[],
): string {
  return `${header} {\n${statements.map((item) => `  ${item}`).join('\n')}\n}`;
}
