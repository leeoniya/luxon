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

The bound is deliberately derived rather than fitted to ordinary DST. Offset
changes include `Pacific/Apia` deleting a whole day and
`Antarctica/Macquarie` moving ten hours. A day therefore has no positive floor:
one day less the 26-hour offset bound is negative, so day diffs are never
skipped.

Two compatibility constraints bound the skip:

- The skip is off for `toRelativeCalendar`, whose units count boundary crossings
  rather than elapsed time — 23:00 and 01:00 are two hours apart and one day
  apart, so no spread implies anything about its answer.
- A unit without a numeric floor is always asked, which keeps ordinary unknown
  units throwing `InvalidUnitError` where they threw before.

The single-unit `toRelative({ unit })` branch is unchanged and remains the
equivalent operation without the skip.
