const pad = (value: number) => String(value).padStart(2, "0");

export function localDateTime(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseLocalDateTime(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) ||
    !validDate(value.slice(0, 10))
  )
    return null;
  const date = new Date(value.replace(" ", "T") + ":00");
  // Reject overflowing times and nonexistent local times during DST transitions.
  return !Number.isNaN(date.getTime()) &&
    localDateTime(date.toISOString()) === value
    ? date.toISOString()
    : null;
}

export function scheduledLabel(value: string | null) {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function completedLabel(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
