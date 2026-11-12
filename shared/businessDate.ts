// "Today" for the business, not for the server's clock. The server may run in UTC, where the date is still yesterday
// from midnight until 05:45 in Nepal, so a default document date must be read in the business time zone.
export const BUSINESS_TIME_ZONE = "Asia/Kathmandu";

/** The calendar date at `now` in `timeZone`, as a UTC-midnight Date (the form dates are stored and handled in). */
export function dateInZone(now: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
}
