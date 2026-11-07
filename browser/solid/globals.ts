// The two host globals the desktop's modules read, for the browser: Bun.nanoseconds, which src/frame.ts times a frame's
// phases with, and Buffer.from, which src/entry.ts encodes the page's root id with. Neither is a framework: the page
// imports this module first, so both exist before the tree is rendered or a frame runs. Nothing else of Bun or Node is
// used by the modules the Sensors page pulls in (src/renderer.ts, src/frame.ts, src/pack.ts, src/motion.ts, src/entry.ts).
const globals = globalThis as unknown as {
  Bun?: { nanoseconds: () => number };
  Buffer?: { from: (text: string) => Uint8Array };
};

globals.Bun ??= { nanoseconds: () => performance.now() * 1e6 };
globals.Buffer ??= { from: (text: string) => new TextEncoder().encode(text) };
