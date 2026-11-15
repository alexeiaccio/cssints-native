// Chromium, from the **project's** Playwright. `import("playwright")` inside an installed package resolves against the
// package's own directory — Bun keeps the installed copy in its global cache — so a project that has Playwright as a
// peer would not find it there (`Cannot find package 'playwright' from …/cssints-native@0.1.8/…`). `createRequire` from
// the working directory is the project's own resolution; the first branch keeps a bundler's or a hoisted install's.
//
// Node-only: every caller here prints a document or a PDF, which is a build step, never a page.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Playwright = typeof import("playwright");

/** The project's `playwright`, or the one this package's own `node_modules` holds. */
export async function loadPlaywright(): Promise<Playwright> {
  try {
    return await import("playwright");
  } catch {
    const require = createRequire(join(process.cwd(), "noop.js"));
    const path = require.resolve("playwright");
    return (await import(pathToFileURL(path).href)) as Playwright;
  }
}

/** What the callers use: Playwright's `chromium`. */
export const loadChromium = async (): Promise<Playwright["chromium"]> => (await loadPlaywright()).chromium;
