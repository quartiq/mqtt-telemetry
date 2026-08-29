export const DURATION_OPTIONS = [
  { milliseconds: 60_000, label: "1 min" },
  { milliseconds: 600_000, label: "10 min" },
  { milliseconds: 3_600_000, label: "1 hour" },
  { milliseconds: 21_600_000, label: "6 hours" },
  { milliseconds: 86_400_000, label: "24 hours" },
  { milliseconds: 604_800_000, label: "7 days" },
] as const;

export function formatDuration(milliseconds: number): string {
  const preset = DURATION_OPTIONS.find(
    (option) => option.milliseconds === milliseconds,
  );
  if (preset) return preset.label;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  if (seconds < 86_400) return `${seconds / 3600} hours`;
  return `${seconds / 86_400} days`;
}
