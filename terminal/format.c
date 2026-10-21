// The numbers and times the sky screens print, copied from apps/csssky's post/model.ts (see format.h).
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "format.h"

// "Oct 17, 2024", and "Jul 2" in the year SKY_NOW is in: toLocaleDateString("en") without the year it shares.
static void short_date(char *out, size_t n, time_t t, int now_year)
{
    static const char *const MONTH[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    struct tm tm;
    if (!gmtime_r(&t, &tm)) {
        snprintf(out, n, "%s", "");
        return;
    }
    if (tm.tm_year + 1900 == now_year) snprintf(out, n, "%s %d", MONTH[tm.tm_mon], tm.tm_mday);
    else snprintf(out, n, "%s %d, %d", MONTH[tm.tm_mon], tm.tm_mday, tm.tm_year + 1900);
}

void sky_ago(char *out, size_t n, long long created)
{
    long long s = SKY_NOW - created;
    if (s < 0) s = 0;
    if (s < 60) snprintf(out, n, "now");
    else if (s < 3600) snprintf(out, n, "%lldm", s / 60);
    else if (s < 86400) snprintf(out, n, "%lldh", s / 3600);
    else if (s < 7 * 86400) snprintf(out, n, "%lldd", s / 86400);
    else {
        time_t now = (time_t)SKY_NOW, t = (time_t)created;
        struct tm tm;
        short_date(out, n, t, gmtime_r(&now, &tm) ? tm.tm_year + 1900 : 0);
    }
}

// Intl's compact notation is two significant digits: 8,648 is "8.6K", 21,327 is "21K", 63,747 is "64K",
// 35,119,957 is "35M", and 999,999 rounds up into "1M".
static void compact(char *out, size_t n, int v, double unit, const char *suffix)
{
    double x = v / unit;
    if (x < 10) {
        snprintf(out, n, "%.1f%s", x, suffix);
        if (strstr(out, ".0")) snprintf(out, n, "%d%s", (int)x, suffix); // 1.0K is "1K"
        return;
    }
    const int r = (int)(x + 0.5);
    if (r >= 1000 && unit == 1000) {
        compact(out, n, v, 1e6, "M");
        return;
    }
    snprintf(out, n, "%d%s", r, suffix);
}

void sky_num(char *out, size_t n, int v)
{
    if (v < 1000) snprintf(out, n, "%d", v);
    else if (v < 1000000) compact(out, n, v, 1000, "K");
    else compact(out, n, v, 1e6, "M");
}

void sky_full_time(char *out, size_t n, long long at)
{
    static const char *const MONTH[] = {"January", "February", "March",     "April",   "May",      "June",
                                       "July",    "August",   "September", "October", "November", "December"};
    time_t t = (time_t)at;
    struct tm tm;
    // gmtime_r, not localtime: toLocaleString would use the machine's zone and a frame would depend on the clock
    if (!gmtime_r(&t, &tm)) {
        snprintf(out, n, "%s", "");
        return;
    }
    const int h24 = tm.tm_hour;
    const int h = h24 % 12 == 0 ? 12 : h24 % 12;
    snprintf(out, n, "%s %d, %d at %d:%02d %s", MONTH[tm.tm_mon], tm.tm_mday, tm.tm_year + 1900, h, tm.tm_min,
             h24 < 12 ? "AM" : "PM");
}
