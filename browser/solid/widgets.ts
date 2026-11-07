// The Widgets page in the browser: the page that needs keys, on the same modules and the same shell as Sensors
// (browser/solid/page.ts). The page's props are main.ts's: its own `Input` (the focus manager and the parts), a drag state
// for its slider and the host's motion hook for its first-mount entry. The keys are the DOM's (browser/solid/keys.ts) into
// that same `Input`, so Tab, Shift+Tab, Space, Enter, the arrows, Home and End are the desktop's — and the page itself is
// solid/app/Widgets.tsx unmodified.
import { Widgets, size } from "../../solid/app/Widgets.tsx";
import { createInput } from "../../solid/src/input.ts";
import { mountPage } from "./shell.ts";

const input = createInput();
await mountPage({
  width: size.width,
  height: size.height,
  input,
  // a dev server's `hot` event re-mounts this page instead of reloading it (browser/serve.ts; `?hot=0` is the reload)
  hot: true,
  tree: ({ drag, motion }) => () => Widgets({ input, drag, motion }),
});
