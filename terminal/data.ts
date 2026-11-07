// The terminal's AppView: `apps/csssky/src/api.ts`'s model, answered from its own **recorded** fixtures instead of the
// network. The host hands the object to the Sky page (`pages` for the feed, `load` for a thread), so the page asks the
// app's questions — a feed's page at a cursor, a post's thread — and gets the app's records back; nothing here mints a
// card the app would not draw, because the page maps a `FeedViewPost` through its own `postOf`, as the profile screen
// does for its lists.
//
// What is recorded, and what is not (`apps/csssky/test/fixtures/`, scripts/record-fixtures.mjs):
//
//   homeScreen          Discover: home-discover-1, then home-discover-2 (the first page's cursor is what the second was
//                       asked with), then an empty page — the end. Science: home-science-1, then an empty page (the app's
//                       own test stands in for Science's second page with the 414 a long cursor gets, which is the end
//                       too). News: no recording, so its first page is empty — the app's empty feed.
//   threadScreen        thread.json: one thread (a parent, the post and its replies). It is shown for whichever at-uri
//                       opens it, as `terminal/thread.c` and apps/csssky's own test stub do.
//   listNotifications   **no recording**: `apps/csssky/test/fixtures` holds no `app.bsky.notification.listNotifications`
//                       answer (no `src/notifications/`, no route), so there is nothing here to answer it with and the
//                       page's notifications screen stays hand-carried (`solid/app/notify.ts`). Said, not invented.
//
// The two knobs, for terminal/test.sh: `offline` fails both calls (the page's error state), and `cursor` ignores the
// cursor it is asked with, so the second page is the first again — what the page's own dedupe has to survive.
import discover1 from "../../apps/csssky/test/fixtures/home-discover-1.json" with { type: "json" };
import discover2 from "../../apps/csssky/test/fixtures/home-discover-2.json" with { type: "json" };
import science1 from "../../apps/csssky/test/fixtures/home-science-1.json" with { type: "json" };
import thread from "../../apps/csssky/test/fixtures/thread.json" with { type: "json" };

import type { AppBskyFeedDefs } from "@atcute/bluesky";

import { postVerdict } from "../../apps/csssky/src/api.ts";
import type { Page } from "../../apps/csssky/src/api.ts";
// the page's own screen: the recorded `getPostThread` answer shaped the way `Sky.tsx`'s loader takes it, as the thread's
// fixture is in `solid/thread.test.ts` (the app's `threadScreen` maps it too; this is the same mapping, the page's).
import { screenOf } from "../solid/app/Sky.tsx";
import type { ThreadScreen } from "../solid/app/Sky.tsx";

/** A recorded `app.bsky.feed.getFeed` answer: the page's cards' post views and the cursor the next page is asked with. */
interface FeedAnswer {
  readonly feed: readonly AppBskyFeedDefs.FeedViewPost[];
  readonly cursor?: string;
}

/** A recorded `app.bsky.feed.getPostThread` answer: the union the page's `screenOf` reads. */
interface ThreadAnswer {
  readonly thread: unknown;
}

/** The app's feed tabs' recordings, in the order their pages were recorded: Discover has two, Science one, News none. */
const RECORDINGS: Record<string, readonly FeedAnswer[]> = {
  Discover: [discover1 as FeedAnswer, discover2 as FeedAnswer],
  Science: [science1 as FeedAnswer],
  News: [],
};

/** The app's calls, as the host hands them to the page: a feed's page at a cursor, and a post's thread. `listNotifications`
 *  is not among them: nothing recorded it (see the top). */
export interface Source {
  /** `homeScreen`: one feed's page. The cursor is the previous page's, `undefined` for the first; an empty page with no
   *  cursor is the end, as the AppView answers one. */
  homeScreen(feed: string, cursor?: string): Promise<Page<AppBskyFeedDefs.FeedViewPost>>;
  /** `getPostThread`, shaped as the page's loader takes it: the recording's screen, or a throw (the page's error state). */
  threadScreen(uri: string): ThreadScreen;
}

export interface Options {
  /** Nothing is answered: the page's error states are what a run draws (terminal/test.sh's `--offline`). */
  readonly offline?: boolean;
  /** The broken run's: the cursor is ignored, so every page is the first (terminal/test.sh's `--mutate cursor`). */
  readonly cursor?: boolean;
}

/** The empty page the AppView answers past the last recording: no items and no cursor, which is the feed's end. */
const END: Page<AppBskyFeedDefs.FeedViewPost> = { items: [], cursor: undefined };

/** The fixtures' AppView. One source a host: the recordings are module data, and a page's answer is a promise the page
 *  settles in its own state (the host adds no timer of its own). */
export function source(opts: Options = {}): Source {
  const offline = (what: string) =>
    new Error(`offline: ${what} (terminal/data.ts's recordings answer it; there is no network here)`);
  return {
    homeScreen(feed, cursor) {
      if (opts.offline) return Promise.reject(offline(`getFeed (${feed})`));
      const pages = RECORDINGS[feed] ?? [];
      // the broken run's (`--mutate cursor`): the cursor is never read, so every page is the first
      const named = opts.cursor === true ? undefined : cursor;
      // the page a cursor names is the one **after** the answer that handed it out; a cursor no recording answers is the
      // end (Discover's third page asks with the second's)
      const previous = named === undefined ? -1 : pages.findIndex((a) => a.cursor === named);
      if (named !== undefined && previous < 0) return Promise.resolve(END);
      const answer = pages[previous + 1];
      if (!answer) return Promise.resolve(END);
      // the app's moderation rule, the one `homeScreen` applies before its page leaves the API: a hidden post is not a
      // card (the recordings hold 30 items a page, 28 and 23 of Discover's two visible, 25 of Science's)
      return Promise.resolve({
        items: answer.feed.filter((item) => postVerdict(item.post) !== "hide"),
        cursor: answer.cursor,
      });
    },
    threadScreen(uri) {
      if (opts.offline) throw offline(`getPostThread (${uri})`);
      return screenOf((thread as ThreadAnswer).thread);
    },
  };
}
