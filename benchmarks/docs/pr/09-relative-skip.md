# I — two calls `toRelative` makes that cannot affect its answer

`src/datetime.js`

**`padding`.** It defaults to 0 and the method calls `this.plus(0)` regardless,
which clones the receiver and re-derives its offset to arrive back at the
receiver.

**The unit loop in `diffRelative`.** It asks `diff()` for years, then months,
then days, and so on until one comes back at 1 or more, so a "3 months ago"
answer pays for a full calendar-year diff first. A unit cannot reach 1 unless the
two instants are at least one of it apart, so the diffs that can only return 0
are skippable without being run.

**Where the floors come from.** A step of one unit keeps the wall time and
advances the local calendar by at least N days — 365 for a year (Feb 29 to Feb
28), 89 for a quarter (Jan 31 clamping to Apr 30), 28 for a month, 7 for a week —
and lands on an offset at most 26 hours from the one it left, because IANA
offsets run from `-12:00` to `+14:00`. So one step covers at least N days less 26
hours of real time, and that is the floor.

Deriving it rather than measuring tzdata is the whole of it, and an earlier draft
of this patch is the argument for why. Floors fitted to the ordinary one-hour
spring forward were wrong for three of five units, because the real extremes are
not DST at all:

| | shortest in tzdata | why |
| --- | --- | --- |
| week | 6 days | `Pacific/Apia` deleted 2011-12-30 outright |
| quarter | 88d 17h | `Antarctica/Davis` was abolished in 1969 and jumped 7 hours |
| day | 14 hours | `Antarctica/Macquarie` moved 10 hours in 1948 |

The fitted week floor of 6.9 days skipped the Apia week and answered "in 7 days"
where the answer was "in 1 week". A day has no floor at all under the derivation,
since a day less 26 hours is negative — and the Macquarie figure says that is not
an idle margin. Dropping it costs less than it looks: with the rest of the series
applied, `toRelative` over a three-minute span is still about 6× stock.

Two things bound this, and both are what the tests turn on:

- The skip is off for `toRelativeCalendar`, whose units count boundary crossings
  rather than elapsed time — 23:00 and 01:00 are two hours apart and one day
  apart, so no spread implies anything about its answer.
- A unit the table does not name has no floor and is always asked, which is what
  keeps an unknown one throwing `InvalidUnitError` where it threw before. The
  table is null-prototype for that reason.

The fixtures check each unit against `toRelative({ unit })`, which takes the
single-unit branch above the loop and is untouched here, so the expectation
follows tzdata rather than being recorded against it.
