// The AppView's numbers and times, as the three sky screens print them: apps/csssky's post/model.ts ago(), count() and
// fullTime(). No clock: the fixtures were recorded at SKY_NOW and every frame prints that moment.
#ifndef FORMAT_H
#define FORMAT_H

#include <stddef.h>

#define SKY_NOW 1790955571LL // 2026-10-02T15:39:31Z: the moment the fixtures were recorded

/** "now", "5m", "3h", "2d"; the >7d date of the app is not here (no fixture post is that old). */
void sky_ago(char *out, size_t n, long long created);
/** count(): 310, "1.2K", "32K"; 0 is "0". */
void sky_num(char *out, size_t n, int v);
/** fullTime(): "September 10, 2026 at 4:59 PM", in UTC: the machine's zone would make a frame depend on the clock. */
void sky_full_time(char *out, size_t n, long long at);

#endif
