# Naming Dictionary

`docs/naming/dictionary.json` is the canonical source of truth for Tiny-Chu names. Generated state under `.tiny/naming/` is not canonical and must not be used as the review source for new names.

The dictionary records each canonical entry with a stable `id`, displayed `name`, normalized collision key, semantic `kind`, `namespace`, expected `casing`, token composition, lifecycle `status`, collision group, aliases, blocked variants, source references, and meaning.

Before inventing a public variable, function, method, type, setting, or tool name, load a bounded naming context for the namespace and query stem. Use `createNamingContext({ root, query, namespace, kind, maxEntries })` or the future `naming_context` tool, then prefer an existing canonical name when it matches the concept.

## Casing Rules

Variables use `camelCase` and should combine a domain noun with a role noun when exported, such as `contextPacket` or `workflowStatus`. Short local variables may stay plain when their scope is small.

Functions and methods use `camelCase` and start with an action verb. Public functions should include the domain object after the verb, such as `createWorkflowStatus`, `loadContextBundle`, or `parseNamingDictionary`.

Constants use `SCREAMING_SNAKE_CASE` only when they are immutable policy values or lookup tables. Local immutable values still use `camelCase`.

Types, interfaces, and classes use `PascalCase`. Prefer a domain prefix or suffix for exported shapes, such as `NamingEntry`, `WikiBundle`, or `PublicDispatcher`.

Tool and file-state names may use `snake_case` only when they are user-facing command names or persisted external identifiers.

## Composition Rules

Use one name for one concept. If a stem is overloaded, add a domain token before exposing it publicly: `workflowResult`, `symbolRecord`, or `namingInput` are clearer than plain `result`, `symbol`, or `input`.

Model settings are reserved in the `model-settings` namespace. Use the canonical camelCase spellings `temperature`, `topP`, `topK`, `openaiEffort`, `anthropicBudgetTokens`, `providerServiceTier`, and `providerToolChoice`.

Blocked variants document spellings that agents should not introduce. For example, `top_k` is blocked for the canonical `topK` setting.

When adding a public name, cite the source file or plan in `sourceRefs` and write a `meaning` that distinguishes it from entries in the same collision group.

## Agent Workflow

1. Choose the nearest namespace and kind for the name you are about to add.
2. Query the dictionary with the meaningful stem, such as `topk`, `workflow`, or `context`.
3. Reuse the returned canonical spelling when the meaning matches.
4. Avoid every returned `blockedVariants` spelling, even if it looks natural in another style.
5. Add a reviewed dictionary entry only when no returned entry covers the new concept.

Keep committed policy in `docs/naming/dictionary.json` and `docs/naming/dictionary.schema.json`. Treat `.tiny/naming/index.json` and `.tiny/naming/events.jsonl` as generated cache/history that can be rebuilt or appended by tools.
