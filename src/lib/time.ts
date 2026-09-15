import type { TelemetryMessage } from "./telemetry";

export type DisplayTimeZone = "local" | "utc";

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatTelemetryTime(
  value: number,
  options: {
    timeZone: DisplayTimeZone;
    date?: boolean;
    milliseconds?: boolean;
  },
): string {
  const key = `${options.timeZone}:${Boolean(options.milliseconds)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...(options.milliseconds ? { fractionalSecondDigits: 3 } : {}),
      ...(options.timeZone === "utc" ? { timeZone: "UTC" } : {}),
    });
    formatters.set(key, formatter);
  }
  const parts = formatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const date = options.date
    ? `${part("year")}-${part("month")}-${part("day")} `
    : "";
  const milliseconds = options.milliseconds
    ? `.${part("fractionalSecond")}`
    : "";
  return `${date}${part("hour")}:${part("minute")}:${part("second")}${milliseconds}`;
}

export function displayDatesDiffer(
  left: number,
  right: number,
  timeZone: DisplayTimeZone,
): boolean {
  return (
    formatTelemetryTime(left, { timeZone, date: true }).slice(0, 10) !==
    formatTelemetryTime(right, { timeZone, date: true }).slice(0, 10)
  );
}

export function historyNeedsDate(
  messages: readonly TelemetryMessage[],
  now: number,
  timeZone: DisplayTimeZone,
): boolean {
  if (!messages.length) return false;
  const first = messages[0].receivedAt;
  const last = messages.at(-1)!.receivedAt;
  return (
    displayDatesDiffer(first, last, timeZone) ||
    displayDatesDiffer(last, now, timeZone)
  );
}
