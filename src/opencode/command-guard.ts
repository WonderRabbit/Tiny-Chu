export interface CommandGuardDiagnostic {
  readonly code: "unix_grep" | "unix_find" | "xargs" | "bash_syntax" | "powershell_alias";
  readonly message: string;
}

export interface PowerShellCommandGuardResult {
  readonly valid: boolean;
  readonly command: string;
  readonly diagnostics: readonly CommandGuardDiagnostic[];
  readonly safeAlternatives: readonly string[];
}

function commandInput(input: Record<string, unknown>): string {
  return typeof input.command === "string" ? input.command.trim() : "";
}

export function createPowerShellCommandGuard(input: Record<string, unknown>): PowerShellCommandGuardResult {
  const command = commandInput(input);
  const diagnostics: CommandGuardDiagnostic[] = [];
  if (/\bgrep\s+-R\b/.test(command)) diagnostics.push({ code: "unix_grep", message: "Use ripgrep JSON output instead of grep -R in PowerShell workflows." });
  if (/\bfind\s+[^|&;]*-name\b/.test(command)) diagnostics.push({ code: "unix_find", message: "Use fd instead of Unix find -name." });
  if (/\bxargs\b/.test(command)) diagnostics.push({ code: "xargs", message: "Avoid xargs pipelines; pass bounded file lists directly to the native tool." });
  if (/<<|<\(|\$\([^)]+\)|^\w+=\w+\s+\w+/.test(command)) diagnostics.push({ code: "bash_syntax", message: "Bash-only syntax is not PowerShell-safe." });
  if (/^(cat|ls|curl|wget|where|sort)\b/.test(command)) diagnostics.push({ code: "powershell_alias", message: "Invoke native tools by executable name instead of PowerShell aliases." });
  return {
    valid: diagnostics.length === 0,
    command,
    diagnostics,
    safeAlternatives: [
      "rg --json --line-number --column --no-heading '<pattern>' <paths>",
      "fd --type f --hidden --exclude .git --exclude node_modules --exclude dist",
      "ast-grep run --lang ts -p '<pattern>' src",
    ],
  };
}
