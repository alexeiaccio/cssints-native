// The story files, listed: the native build is the Solid compiler through Bun and the cssints plugin, not Vite, so there is
// no `import.meta.glob` here and a new file is one line. `@cssints/stories` takes the record either way.
import type { Module } from "@cssints/stories";

import type { Node } from "../src/renderer.ts";
import * as widgets from "./widgets.stories.tsx";

export const modules: Record<string, Module<Node>> = {
  "./widgets.stories.tsx": widgets as unknown as Module<Node>,
};
