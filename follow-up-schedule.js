const FU_INTERVALS = [
  { number: 2, days: 1, label: "H+1" },
  { number: 3, days: 3, label: "H+3" },
  { number: 4, days: 5, label: "H+5" },
  { number: 5, days: 7, label: "H+7" },
  { number: 6, days: 14, label: "H+14" },
  { number: 7, days: 21, label: "H+21" }
];
const TERMINAL_STAGES = new Set(["ITJ", "Akad", "Batal"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateInputValue(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function hasFollowUpToday(lead, today) {
  return (lead.followUps || []).some((followUp) =>
    dateInputValue(followUp.followUpDate || followUp.createdAt) === today
  );
}

export function computeDueFollowUp(lead, today) {
  if (TERMINAL_STAGES.has(lead.tahap) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const startDate = String(lead.createdAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) return null;

  for (const interval of FU_INTERVALS) {
    const completed = (lead.followUps || []).some((followUp) =>
      followUp.number === interval.number && String(followUp.result || "").trim()
    );
    if (completed) continue;

    const dueDate = addDays(startDate, interval.days);
    if (today < dueDate) return null;
    const daysOverdue = Math.floor(
      (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${dueDate}T00:00:00.000Z`)) / DAY_MS
    );
    return { number: interval.number, label: interval.label, daysOverdue };
  }
  return null;
}
