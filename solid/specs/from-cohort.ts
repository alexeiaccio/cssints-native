// `solid/specs/cohort.json`, computed from `solid/samples/jetstream.json` — the one recording this repository has of
// a real population: Bluesky's public Jetstream firehose, twenty minutes of `app.bsky.feed.post`, collected by
// `collect-jetstream.ts`. Every number in this spec is the sample's, and the shape is a cohort grid:
//
//   a cohort   the accounts that posted in one minute of the window (`0m`, `1m`, …)
//   a column   one lag later (`+1m` … `+5m`), and the share of that cohort's accounts that posted again in it
//
// So a row reads "of the 1,983 accounts that posted in minute 0, 12% posted again a minute later, 8% two minutes later".
// It is the network's own behaviour over minutes, not a model: the sample is the data, this file is arithmetic on it.
//
//   bun native/solid/specs/from-cohort.ts               rewrites cohort.json here in place
//   bun native/solid/specs/from-cohort.ts <dir>         writes it into <dir> (the check's own way)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "../src/figure/spec.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The recording, and the lags a row is measured at: five minutes after a minute is the window's own edge. */
const SAMPLE = resolve(HERE, "../samples/jetstream.json");
const LAGS = [1, 2, 3, 4, 5];

interface Sample {
  url: string;
  minutes: number;
  taken: string;
  events: number;
  posts: number;
  accounts: number;
  authors: number[][];
}

const sample = JSON.parse(readFileSync(SAMPLE, "utf8")) as Sample;
if (!Array.isArray(sample.authors) || !sample.authors.length) {
  console.error('solid/samples/jetstream.json has no accounts: collect one with "bun native/solid/specs/collect-jetstream.ts".');
  process.exit(1);
}

/** Who posted in a minute: the cohort's members, as indexes into the sample's accounts. */
const byMinute = new Map<number, number[]>();
sample.authors.forEach((minutes, account) => {
  for (const minute of minutes) {
    if (minute < 0 || minute >= sample.minutes) continue;
    const members = byMinute.get(minute);
    if (!members) byMinute.set(minute, [account]);
    else members.push(account);
  }
});

/** A minute's cohort and its retention: the share of its accounts seen again `lag` minutes later, in whole percent. */
const cohorts = [...byMinute.keys()]
  .sort((a, b) => a - b)
  .filter((minute) => minute + Math.max(...LAGS) < sample.minutes)
  .map((minute) => {
    const members = byMinute.get(minute)!;
    const values = LAGS.map((lag) => {
      const retained = members.filter((account) => sample.authors[account]!.includes(minute + lag)).length;
      return Math.round((100 * retained) / members.length);
    });
    return { label: `${minute}m`, size: members.length, values };
  });

const total = cohorts.reduce((sum, cohort) => sum + cohort.size, 0);
const spec = {
  kind: "cohort",
  title: "The firehose's minute cohorts",
  intent:
    "Bluesky's public Jetstream for twenty minutes: the accounts that posted in one minute, and the share of them that " +
    "posted again one to five minutes later. A cell is a whole percent; a row's n is its cohort. " +
    `${sample.accounts.toLocaleString("en-US")} accounts posted ${sample.posts.toLocaleString("en-US")} posts in the ` +
    `window, and the ${cohorts.length} cohorts count ${total.toLocaleString("en-US")} accounts between them — an ` +
    "account that posted in three minutes is in three rows.",
  source: `Jetstream, app.bsky.feed.post, ${sample.minutes} minutes from ${sample.taken}Z`,
  data: { window: sample.minutes, lags: LAGS, cohorts },
  options: {},
};

const problems = check(spec);
if (problems.length) {
  console.error(`from-cohort: ${problems.join(" ")}`);
  process.exit(1);
}

const out = process.argv[2] ?? HERE;
const file = resolve(out, "cohort.json");
writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
const first = cohorts[0]!;
console.log(
  `from-cohort: ${file} (${cohorts.length} cohorts of ${sample.minutes} minutes, ${total.toLocaleString("en-US")} ` +
    `accounts; ${first.label} ${first.size}: ${first.values.join("/")}%)`,
);
