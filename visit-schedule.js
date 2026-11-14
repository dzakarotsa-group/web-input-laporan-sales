const weekdayNames = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];

function visitWeekday(result) {
  const text = String(result || "").toLocaleLowerCase("id").replace(/[’']/g, "");
  if (!/\b(visit|kunjungan|berkunjung)\b/.test(text)) return null;
  const match = text.match(/\b(hari\s+)?(minggu|senin|selasa|rabu|kamis|jumat|sabtu)\b/);
  if (!match) return null;
  const afterWeekday = text.slice(match.index + match[0].length).trimStart();
  if (match[2] === "minggu" && !match[1] && /^(ini|depan|lalu|kemarin)\b/.test(afterWeekday)) {
    return null;
  }
  return weekdayNames.indexOf(match[2]);
}

export function sundayToSaturdayRange(dateValue) {
  const start = new Date(`${dateValue}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export function visitDateThisWeek(lead, weekStart) {
  if (!lead.visitBooked || lead.visitCompleted) return "";
  const followUps = [...(lead.followUps || [])]
    .filter((item) => item.result)
    .sort((a, b) => {
      const timeDifference = Date.parse(b.createdAt || lead.createdAt) - Date.parse(a.createdAt || lead.createdAt);
      return timeDifference || b.number - a.number;
    });
  let weekday = null;
  for (const followUp of followUps) {
    weekday = visitWeekday(followUp.result);
    if (weekday !== null) break;
  }
  if (weekday === null) return "";
  const visitDate = new Date(`${weekStart}T00:00:00.000Z`);
  visitDate.setUTCDate(visitDate.getUTCDate() + weekday);
  return visitDate.toISOString().slice(0, 10);
}
