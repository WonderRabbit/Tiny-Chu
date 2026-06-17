#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkNamingDictionary } from "../dist/naming/naming-check.js";
import { extractNamingSymbols } from "../dist/naming/naming-extract.js";

function parseArgs(argv) {
  const parsed = { root: ".", dictionary: "docs/naming/dictionary.json", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--root") index = readValue(argv, index, "root", parsed);
    else if (arg === "--dictionary") index = readValue(argv, index, "dictionary", parsed);
    else if (arg === "--candidate-name") index = readValue(argv, index, "candidateName", parsed);
    else if (arg === "--candidate-kind") index = readValue(argv, index, "candidateKind", parsed);
    else if (arg === "--candidate-namespace") index = readValue(argv, index, "candidateNamespace", parsed);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readValue(argv, index, key, parsed) {
  const value = argv[index + 1];
  if (!value) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} requires a value`);
  parsed[key] = value;
  return index + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const dictionaryPath = path.isAbsolute(args.dictionary) ? args.dictionary : path.join(root, args.dictionary);
  const dictionary = await readFile(dictionaryPath, "utf8");
  const extraction = await extractNamingSymbols(root);
  const result = checkNamingDictionary({ dictionary, symbols: extraction.symbols, candidate: candidateFromArgs(args) });
  const output = { ...result, root, dictionary: dictionaryPath, symbolCount: extraction.symbols.length };
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else printText(output);
  if (result.status === "fail") process.exitCode = 1;
}

function candidateFromArgs(args) {
  if (!args.candidateName && !args.candidateKind && !args.candidateNamespace) return undefined;
  if (!args.candidateName || !args.candidateKind || !args.candidateNamespace) throw new Error("--candidate-name, --candidate-kind, and --candidate-namespace must be provided together");
  return { name: args.candidateName, kind: args.candidateKind, namespace: args.candidateNamespace, sourceRefs: ["cli:candidate"] };
}

function printText(output) {
  console.log(`Naming check ${output.status}: ${output.diagnostics.length} diagnostics across ${output.symbolCount} source symbols`);
  for (const diagnostic of output.diagnostics) {
    console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.namespace}:${diagnostic.kind}:${diagnostic.name} ${diagnostic.message}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
