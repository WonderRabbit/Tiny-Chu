export interface PowerShellNativeToolSpec {
  name: string;
  executable: string;
  role: string;
  prefer: readonly string[];
  avoid: readonly string[];
  powershellNotes: readonly string[];
  examples: readonly string[];
}

export interface PowerShellToolingProfile {
  shellSyntaxRules: readonly string[];
  environment: Readonly<Record<string, string>>;
  nativeTools: readonly PowerShellNativeToolSpec[];
}

export const POWERSHELL_TOOLING_PROFILE: PowerShellToolingProfile = {
  shellSyntaxRules: [
    "Invoke native tools by their real executable names, not PowerShell aliases such as cat, ls, curl, wget, find, sort, or where.",
    "Quote jq/yq/mdq/rg/fd/ast-grep patterns with single quotes so PowerShell does not expand $, [], {}, |, or backticks before the native tool sees them.",
    "When a native tool pattern or file name begins with '-', place the tool's own '--' argument before positional patterns or paths.",
    "Do not use bash-only syntax: here-documents, process substitution, xargs -0 pipelines, VAR=value command prefixes, single-quoted strings that need variable expansion, or unescaped backslash continuations.",
    "For multi-line input, prefer PowerShell here-strings piped to the native tool, or write a temporary UTF-8 file and pass the file path explicitly.",
    "Prefer native JSON output plus ConvertFrom-Json over fragile text parsing whenever the tool supports --json or -o json.",
    "Set $PSNativeCommandArgumentPassing = 'Standard' in PowerShell 7+ sessions before running native tools with complex quoted arguments.",
  ],
  environment: {
    NO_COLOR: "1",
    RIPGREP_CONFIG_PATH: "<unset to avoid hidden user defaults>",
    FD_OPTIONS: "--color=never",
  },
  nativeTools: [
    {
      name: "jq",
      executable: "jq",
      role: "JSON filtering and construction.",
      prefer: ["-r/--raw-output for scalar strings", "-c/--compact-output for machine pipelines", "-n/--null-input to construct JSON", "--arg/--argjson instead of interpolating PowerShell variables into filters"],
      avoid: ["PowerShell double-quoted filters containing $field", "echo for JSON payloads", "bash here-documents"],
      powershellNotes: ["Use jq --arg name $value '.items[] | select(.name == $name)'.", "Use Get-Content -Raw file.json | jq -c '.[]' when stdin is clearer than path arguments."],
      examples: ["jq -r '.scripts.test' package.json", "jq -n --arg name $Name '{name: $name}'"],
    },
    {
      name: "yq",
      executable: "yq",
      role: "YAML/JSON/TOML/XML querying and conversion with Mike Farah yq v4 syntax.",
      prefer: ["-o json for predictable downstream parsing", "-r for scalar strings", "-I 2 for deterministic indentation", "eval-all only when all documents must be loaded together"],
      avoid: ["Assuming the Python jq-wrapper yq syntax", "in-place -i edits without a file path", "unquoted expressions containing [] or |"],
      powershellNotes: ["Pin output format with -o json or -o yaml instead of relying on extension auto-detection.", "Quote expressions like '.dependencies[] | .name' with single quotes."],
      examples: ["yq -o json '.scripts' package.json", "yq -r '.name' package.json"],
    },
    {
      name: "mdq",
      executable: "mdq",
      role: "Markdown element selection with mdq selector syntax.",
      prefer: ["--output json when feeding jq", "-q/--quiet for presence checks if installed", "'- [ ]' and '# Heading' selectors for tasks and sections"],
      avoid: ["Regex-only parsing of Markdown checkboxes or headings", "unquoted selectors containing [] or #", "assuming stdin is read when file paths are also supplied unless '-' is included"],
      powershellNotes: ["Quote selectors with single quotes, for example mdq '- [ ]' README.md.", "Use '-' as an explicit file argument when mixing stdin with file paths."],
      examples: ["mdq '- [ ]' README.md", "mdq --output json '# Usage | ```bash' README.md | jq -r '.items[].text'"],
    },
    {
      name: "fd",
      executable: "fd",
      role: "Fast file and directory discovery.",
      prefer: ["--type f/--type d", "--extension ts instead of globbing when possible", "--hidden only when hidden files are required", "--exclude for deterministic pruning"],
      avoid: ["PowerShell Get-ChildItem aliases when fd semantics are intended", "find -name Unix syntax", "unquoted globs that PowerShell may expand"],
      powershellNotes: ["Use fd --type f --extension ts . src instead of Get-ChildItem -Recurse for model-generated searches.", "Use fd --type f --exclude node_modules --exclude dist."],
      examples: ["fd --type f --extension ts . src", "fd --hidden --exclude .git --type f 'AGENTS\\.md'"],
    },
    {
      name: "ast-grep",
      executable: "ast-grep",
      role: "Tree-sitter structural code search and rewrites.",
      prefer: ["run -p for ad-hoc structural searches", "--lang when language cannot be inferred", "--json=stream for machine-readable matches", "scan -c sgconfig.yml for checked-in rules"],
      avoid: ["Regex tools for syntax-aware refactors", "scan without a config or rule file", "unquoted patterns containing $ metavariables"],
      powershellNotes: ["Single-quote patterns containing ast-grep metavariables, for example '$A($$$ARGS)'.", "Use the sg executable only if ast-grep is unavailable or project tooling already standardizes on sg."],
      examples: ["ast-grep run --lang ts -p 'console.log($$$ARGS)' src", "ast-grep scan -c sgconfig.yml --json=stream"],
    },
    {
      name: "ripgrep",
      executable: "rg",
      role: "Fast recursive text search and file listing.",
      prefer: ["--line-number --column --no-heading for parseable text matches", "--json for robust machine parsing", "--files for gitignore-aware file lists", "-g for include/exclude globs"],
      avoid: ["grep -R Unix syntax", "PowerShell Select-String when rg semantics are intended", "unquoted regexes containing $, {}, [], or |"],
      powershellNotes: ["Quote regexes with single quotes, for example rg --line-number 'export .*TaskStore' src.", "Use rg --files -g '*.ts' -g '!dist/**' instead of shell-expanded globs."],
      examples: ["rg --line-number --column --no-heading 'createTinyInfiPlugin' src test", "rg --files -g '*.ts' -g '!dist/**'"],
    },
  ],
};

export function renderPowerShellToolingGuide(profile: PowerShellToolingProfile = POWERSHELL_TOOLING_PROFILE): string {
  const rules = profile.shellSyntaxRules.map((rule) => `- ${rule}`).join("\n");
  const environment = Object.entries(profile.environment)
    .map(([key, value]) => `- ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const tools = profile.nativeTools
    .map((tool) => [
      `### ${tool.name} (${tool.executable})`,
      tool.role,
      `Prefer: ${tool.prefer.join("; ")}.`,
      `Avoid: ${tool.avoid.join("; ")}.`,
      `PowerShell: ${tool.powershellNotes.join(" ")}`,
      `Examples:\n${tool.examples.map((example) => `- ${example}`).join("\n")}`,
    ].join("\n"))
    .join("\n\n");

  return [
    "# PowerShell native-tool guide",
    "## Shell syntax rules",
    rules,
    "## Environment defaults",
    environment,
    "## Tool profiles",
    tools,
  ].join("\n\n");
}

export function renderCompactPowerShellToolingGuide(profile: PowerShellToolingProfile = POWERSHELL_TOOLING_PROFILE): string {
  const rules = profile.shellSyntaxRules.slice(0, 4).map((rule) => `- ${rule}`).join("\n");
  const environment = Object.entries(profile.environment)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("; ");
  const tools = profile.nativeTools
    .map((tool) => `${tool.name}=${tool.executable}`)
    .join("; ");

  return [
    "# PowerShell compact native-tool guide",
    "profileMode: compact",
    "## Required shell rules",
    rules,
    "## Deterministic defaults",
    `Environment: ${environment}`,
    `Tools: ${tools}`,
    "Use full renderPowerShellToolingGuide only when a command-specific rule is missing.",
  ].join("\n\n");
}
