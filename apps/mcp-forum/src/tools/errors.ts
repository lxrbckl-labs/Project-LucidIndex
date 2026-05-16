// Application-level errors raised by tool handlers. The wrapper in
// tools/index.ts turns these into MCP `CallToolResult` payloads with
// `isError: true` and a stable machine-readable `code` field that
// clients branch on.

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}
