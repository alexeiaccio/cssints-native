// `solid/samples/jetstream.json`, collected from the AT Protocol's public firehose — the one dataset this repository
// does not have and cannot compute: real accounts, posting.
//
// Jetstream is Bluesky's public, JSON firehose (no auth, no key): one websocket, one event per commit. This script
// subscribes to `app.bsky.feed.post` creations for a fixed window and records, for every account that posted, the
// minutes of the window in which it posted. From that the `cohort` spec is computed (`from-cohort.ts`): the accounts
// of minute M, and how many of them posted again at M+1 … M+5 — a retention curve of the public network, over minutes.
//
//   bun native/solid/specs/collect-jetstream.ts            20 minutes, into the file below
//   bun native/solid/specs/collect-jetstream.ts 5          5 minutes (a smoke test, not the stored sample)
//
// The sample is a **recording**, not a build product: re-running it gives other numbers (the network is not a build).
// So it is committed once, with the minute it was taken, and `from-cohort.ts` + a `cmp` hold the spec to it.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The window, in minutes. Cohorts are minutes 0 … MINUTES-5, so the last lag still has a minute to be seen in. */
const MINUTES = Number(process.argv[2] ?? 20);
/** Jetstream's collection filter: only the posts, which is what an account's activity is here. */
const ENDPOINT =
  "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
const OUT = fileURLToPath(new URL("../samples/jetstream.json", import.meta.url));

/** An account's minutes in the window: the only thing this script keeps (no text, no handles, no DIDs in the file). */
const seen = new Map<string, number[]>();
let events = 0;
let posts = 0;
let t0 = 0;

const socket = new WebSocket(ENDPOINT);
socket.onmessage = (event) => {
  const now = Date.now();
  if (!t0) t0 = now;
  events++;
  let message: { did?: string; commit?: { record?: { text?: unknown } } };
  try {
    message = JSON.parse(String(event.data)) as typeof message;
  } catch {
    return;
  }
  if (message.commit?.record?.text === undefined) return;
  posts++;
  const did = message.did;
  if (!did) return;
  const minute = Math.floor((now - t0) / 60_000);
  const minutes = seen.get(did);
  if (!minutes) seen.set(did, [minute]);
  else if (minutes[minutes.length - 1] !== minute) minutes.push(minute);
};
socket.onerror = () => {
  console.error(`jetstream: the socket failed after ${events} events`);
  process.exit(1);
};

console.log(`collecting ${MINUTES} minutes of app.bsky.feed.post from ${ENDPOINT}`);
const tick = setInterval(() => {
  const minute = Math.floor((Date.now() - (t0 || Date.now())) / 60_000);
  console.log(`minute ${minute}: ${events} events, ${posts} posts, ${seen.size} accounts`);
  if (minute >= MINUTES) finish();
}, 30_000);

function finish(): void {
  clearInterval(tick);
  socket.close();
  const authors = [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, minutes]) => minutes);
  const sample = {
    $comment:
      "Collected by solid/specs/collect-jetstream.ts from Bluesky's public Jetstream firehose: the minutes (0-based, from the first event) in which each account that created an app.bsky.feed.post appeared. No handles, no text.",
    url: ENDPOINT,
    minutes: MINUTES,
    taken: new Date(t0).toISOString().slice(0, 16),
    events,
    posts,
    accounts: authors.length,
    authors,
  };
  writeFileSync(OUT, `${JSON.stringify(sample, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${authors.length} accounts, ${posts} posts, ${events} events`);
  process.exit(0);
}
