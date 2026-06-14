import { validateAndOrderFeaturePackages } from "./feature-package-order.js";
import { FeaturePackageError, type TinyComposedRegistry, type TinyComposedToolSpec, type TinyFeaturePackage, type TinyFeaturePackageSummary, type TinyInstructionDescriptor, type TinyPromptDescriptor, type TinyResourceDescriptor } from "./feature-package-types.js";
import type { TinyToolHandler } from "./tiny-plugin-types.js";

export { FeaturePackageError } from "./feature-package-types.js";
export type {
  TinyCompatibilitySpec,
  TinyComposedRegistry,
  TinyComposedToolSpec,
  TinyFeatureCategory,
  TinyFeatureHooks,
  TinyFeaturePackage,
  TinyFeaturePackageSummary,
  TinyInstructionDescriptor,
  TinyJsonSchema,
  TinyOutputMode,
  TinyPermissionHint,
  TinyPromptDescriptor,
  TinyResourceDescriptor,
  TinySmallModelHint,
  TinyToolDescriptor,
} from "./feature-package-types.js";

export function composeFeaturePackages(featurePackages: readonly TinyFeaturePackage[]): TinyComposedRegistry {
  const { orderedIds, byId } = validateAndOrderFeaturePackages(featurePackages);
  return composeOrderedRegistry(orderedIds, byId);
}

function composeOrderedRegistry(orderedIds: readonly string[], byId: ReadonlyMap<string, TinyFeaturePackage>): TinyComposedRegistry {
  const tools: Record<string, TinyToolHandler> = {};
  const toolSpecs: TinyComposedToolSpec[] = [];
  const resources: TinyResourceDescriptor[] = [];
  const prompts: TinyPromptDescriptor[] = [];
  const instructions: TinyInstructionDescriptor[] = [];
  const packages: TinyFeaturePackageSummary[] = [];
  const nativeToolNames = new Set<string>();

  for (const id of orderedIds) {
    const featurePackage = byId.get(id);
    if (!featurePackage) continue;
    const toolNames: string[] = [];
    for (const tool of featurePackage.tools ?? []) {
      if (tools[tool.name]) {
        throw new FeaturePackageError("duplicate_tool_name", `Duplicate tool name: ${tool.name}`, {
          packageId: featurePackage.id,
          toolName: tool.name,
        });
      }
      tools[tool.name] = tool.handler;
      toolNames.push(tool.name);
      for (const nativeTool of tool.requiredNativeTools ?? []) nativeToolNames.add(nativeTool);
      toolSpecs.push({
        name: tool.name,
        description: tool.description,
        packageId: featurePackage.id,
        packageTitle: featurePackage.title,
        permission: tool.permission,
        smallModel: tool.smallModel,
        inputSchema: tool.inputSchema,
        requiredNativeTools: tool.requiredNativeTools ?? [],
      });
    }
    resources.push(...(featurePackage.resources ?? []));
    prompts.push(...(featurePackage.prompts ?? []));
    instructions.push(...(featurePackage.instructions ?? []));
    packages.push({
      id: featurePackage.id,
      title: featurePackage.title,
      category: featurePackage.category,
      dependsOn: featurePackage.dependsOn ?? [],
      compatibility: featurePackage.compatibility,
      toolNames,
      resourceNames: (featurePackage.resources ?? []).map((resource) => resource.name),
      promptNames: (featurePackage.prompts ?? []).map((prompt) => prompt.name),
      instructionNames: (featurePackage.instructions ?? []).map((instruction) => instruction.name),
    });
  }

  return {
    packageIds: orderedIds,
    packages,
    tools,
    toolSpecs,
    resources,
    prompts,
    instructions,
    requiredToolNames: toolSpecs.map((spec) => spec.name),
    nativeToolNames: [...nativeToolNames].sort(),
  };
}
