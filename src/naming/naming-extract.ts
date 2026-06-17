import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";
import { isPathInsideRoot } from "../state/path-safety.js";
import type { NamingEntryKind, NamingNamespace } from "./naming-types.js";

export type NamingSymbolSourceKind = "declaration" | "export" | "model-setting-key" | "tool-seed";

export interface NamingSymbolRecord {
  readonly symbolId: string;
  readonly name: string;
  readonly kind: NamingEntryKind;
  readonly namespace: NamingNamespace;
  readonly modulePath: string;
  readonly line: number;
  readonly exported: boolean;
  readonly sourceKind: NamingSymbolSourceKind;
  readonly sourceRefs: readonly string[];
}

export interface NamingExtractionResult {
  readonly root: string;
  readonly symbols: readonly NamingSymbolRecord[];
  readonly diagnostics: readonly string[];
}

const MODEL_SETTING_NAMES = new Set(["temperature", "topP", "topK", "openaiEffort", "anthropicBudgetTokens", "providerServiceTier", "providerToolChoice"]);
const TOOL_SEED_FACTORIES = new Set(["markdown", "readJson", "readJsonOptionalNetwork", "writeMarkdown", "writeSource", "writeState"]);

export class NamingExtractionPathError extends Error {
  readonly name = "NamingExtractionPathError";

  constructor(message: string) {
    super(message);
  }
}

export async function extractNamingSymbols(root: string): Promise<NamingExtractionResult> {
  const absoluteRoot = path.resolve(root);
  const sourceRoot = await resolveSafeSourceRoot(absoluteRoot);
  const files = await collectTsFiles(sourceRoot);
  const program = ts.createProgram(files, readCompilerOptions(absoluteRoot));
  const symbols: NamingSymbolRecord[] = [];

  for (const sourceFile of program.getSourceFiles().filter((file) => files.includes(file.fileName))) {
    visitSourceFile(absoluteRoot, sourceFile, symbols);
  }

  return {
    root: absoluteRoot,
    symbols: symbols.sort(compareSymbols),
    diagnostics: [],
  };
}

function visitSourceFile(root: string, sourceFile: ts.SourceFile, symbols: NamingSymbolRecord[]): void {
  const modulePath = toModulePath(root, sourceFile.fileName);
  const namespace = namespaceForModule(modulePath);
  const ancestors: ts.Node[] = [];

  function visit(node: ts.Node): void {
    const record = symbolFromNode(sourceFile, modulePath, namespace, node, ancestors);
    if (record !== undefined) symbols.push(record);

    const toolRecord = toolSeedFromNode(sourceFile, modulePath, node);
    if (toolRecord !== undefined) symbols.push(toolRecord);

    ancestors.push(node);
    ts.forEachChild(node, visit);
    ancestors.pop();
  }

  visit(sourceFile);
}

function symbolFromNode(sourceFile: ts.SourceFile, modulePath: string, namespace: NamingNamespace, node: ts.Node, ancestors: readonly ts.Node[]): NamingSymbolRecord | undefined {
  if (ts.isFunctionDeclaration(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name?.text, "function", "declaration");
  if (ts.isClassDeclaration(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name?.text, "class", "declaration");
  if (ts.isInterfaceDeclaration(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name.text, "interface", "declaration");
  if (ts.isTypeAliasDeclaration(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name.text, "type", "declaration");
  if (ts.isEnumMember(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, propertyNameText(node.name), "constant", "declaration");
  if (ts.isVariableDeclaration(node)) return variableRecord(sourceFile, modulePath, namespace, node, ancestors);
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, propertyNameText(node.name), "method", "declaration");
  if (ts.isPropertySignature(node)) return propertyRecord(sourceFile, modulePath, namespace, node, ancestors, propertyNameText(node.name), "declaration");
  if (ts.isPropertyAssignment(node)) return propertyRecord(sourceFile, modulePath, namespace, node, ancestors, propertyNameText(node.name), "model-setting-key");
  if (ts.isExportSpecifier(node)) return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name.text, "term", "export", true);
  return undefined;
}

function variableRecord(sourceFile: ts.SourceFile, modulePath: string, namespace: NamingNamespace, node: ts.VariableDeclaration, ancestors: readonly ts.Node[]): NamingSymbolRecord | undefined {
  if (!ts.isIdentifier(node.name)) return undefined;
  const parent = ancestors[ancestors.length - 1];
  const isConst = parent !== undefined && ts.isVariableDeclarationList(parent) && (parent.flags & ts.NodeFlags.Const) !== 0;
  return namedRecord(sourceFile, modulePath, namespace, node, ancestors, node.name.text, isConst ? "constant" : "variable", "declaration");
}

function propertyRecord(
  sourceFile: ts.SourceFile,
  modulePath: string,
  namespace: NamingNamespace,
  node: ts.Node,
  ancestors: readonly ts.Node[],
  name: string | undefined,
  fallbackSourceKind: NamingSymbolSourceKind,
): NamingSymbolRecord | undefined {
  if (name === undefined) return undefined;
  if (MODEL_SETTING_NAMES.has(name)) return namedRecord(sourceFile, modulePath, "model-settings", node, ancestors, name, "setting", "model-setting-key");
  if (fallbackSourceKind === "model-setting-key") return undefined;
  return namedRecord(sourceFile, modulePath, namespace, node, ancestors, name, "variable", fallbackSourceKind);
}

function toolSeedFromNode(sourceFile: ts.SourceFile, modulePath: string, node: ts.Node): NamingSymbolRecord | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !TOOL_SEED_FACTORIES.has(node.expression.text)) return undefined;
  const firstArg = node.arguments[0];
  if (firstArg === undefined || !ts.isStringLiteral(firstArg)) return undefined;
  return makeRecord(sourceFile, modulePath, "opencode", firstArg, firstArg.text, "tool", "tool-seed", false);
}

function namedRecord(
  sourceFile: ts.SourceFile,
  modulePath: string,
  namespace: NamingNamespace,
  node: ts.Node,
  ancestors: readonly ts.Node[],
  name: string | undefined,
  kind: NamingEntryKind,
  sourceKind: NamingSymbolSourceKind,
  exported = isExportedNode(node, ancestors),
): NamingSymbolRecord | undefined {
  if (name === undefined || name.length === 0) return undefined;
  return makeRecord(sourceFile, modulePath, namespace, node, name, kind, sourceKind, exported);
}

function makeRecord(sourceFile: ts.SourceFile, modulePath: string, namespace: NamingNamespace, node: ts.Node, name: string, kind: NamingEntryKind, sourceKind: NamingSymbolSourceKind, exported: boolean): NamingSymbolRecord {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const sourceRef = `${modulePath}:${line}`;
  return {
    symbolId: `${namespace}:${kind}:${name}:${sourceRef}:${node.pos}:${sourceKind}`,
    name,
    kind,
    namespace,
    modulePath,
    line,
    exported,
    sourceKind,
    sourceRefs: [sourceRef],
  };
}

function propertyNameText(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function isExportedNode(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
  const nodes = [node, ...ancestors].reverse();
  for (const current of nodes) {
    if (ts.isSourceFile(current)) continue;
    const modifiers = ts.canHaveModifiers(current) ? ts.getModifiers(current) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return true;
  }
  return false;
}

async function collectTsFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTsFiles(child)));
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(child);
  }
  return files.sort();
}

async function resolveSafeSourceRoot(root: string): Promise<string> {
  const sourceRoot = path.join(root, "src");
  if (!isPathInsideRoot(root, sourceRoot)) throw new NamingExtractionPathError(`Naming extraction source root is outside configured root: ${sourceRoot}`);
  const stat = await lstat(sourceRoot);
  if (stat.isSymbolicLink()) throw new NamingExtractionPathError(`Naming extraction source root cannot be a symlink: ${sourceRoot}`);
  if (!stat.isDirectory()) throw new NamingExtractionPathError(`Naming extraction source root is not a directory: ${sourceRoot}`);
  const [rootReal, sourceReal] = await Promise.all([realpath(root), realpath(sourceRoot)]);
  if (!isPathInsideRoot(rootReal, sourceReal)) throw new NamingExtractionPathError(`Naming extraction source root escapes root: ${sourceRoot}`);
  return sourceRoot;
}

function readCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) return { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 };
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error !== undefined) return { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 };
  return ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath)).options;
}

function toModulePath(root: string, fileName: string): string {
  return path.relative(root, fileName).replaceAll(/[\\\/]+/g, "/");
}

function namespaceForModule(modulePath: string): NamingNamespace {
  if (modulePath.startsWith("src/context/")) return "context";
  if (modulePath.startsWith("src/dispatcher/")) return "dispatcher";
  if (modulePath.startsWith("src/opencode/")) return "opencode";
  if (modulePath.startsWith("src/state/")) return "state";
  if (modulePath.startsWith("src/ulw-loop/")) return "ulw-loop";
  if (modulePath.startsWith("src/wiki/")) return "wiki";
  return "shared";
}

function compareSymbols(left: NamingSymbolRecord, right: NamingSymbolRecord): number {
  return left.modulePath.localeCompare(right.modulePath) || left.line - right.line || left.name.localeCompare(right.name) || left.symbolId.localeCompare(right.symbolId);
}
