import type { TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";

export const TINY_CHU_TUI_LOGO_TEXT = "TinyChu";

export interface TinyChuSolidRuntime {
  readonly createElement: (tag: "text") => JSX.Element;
  readonly insert: (parent: JSX.Element, accessor: string) => JSX.Element;
}

let loadSolidRuntime = async (): Promise<TinyChuSolidRuntime> => {
  const runtime = await import("@opentui/solid");
  return {
    createElement: (tag) => runtime.createElement(tag),
    insert: (parent, accessor) => runtime.insert(parent, accessor),
  };
};

export function setTinyChuTuiRuntimeLoaderForTest(loader: () => Promise<TinyChuSolidRuntime>): () => void {
  const previous = loadSolidRuntime;
  loadSolidRuntime = loader;
  return () => {
    loadSolidRuntime = previous;
  };
}

export function renderTinyChuHomeLogo(runtime: TinyChuSolidRuntime): JSX.Element {
  const text = runtime.createElement("text");
  runtime.insert(text, TINY_CHU_TUI_LOGO_TEXT);
  return text;
}

function createTinyChuLogoSlotPlugin(runtime: TinyChuSolidRuntime): TuiSlotPlugin {
  return {
    slots: {
      home_logo: () => renderTinyChuHomeLogo(runtime),
    },
  };
}

export const TinyChuOpenCodeTuiPlugin: TuiPluginModule = {
  id: "tiny-chu.logo",
  async tui(api) {
    api.slots.register(createTinyChuLogoSlotPlugin(await loadSolidRuntime()));
  },
};

export default TinyChuOpenCodeTuiPlugin;
