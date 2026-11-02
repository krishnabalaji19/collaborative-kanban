export const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// Turns an activity log row into a readable sentence
export function describeActivity(log) {
  const d = log.details || {};
  const type = log.entityType.toLowerCase();
  const what = d.title || d.name || type;

  if (log.entityType === "COLUMN" && log.action === "UPDATED") {
    return `renamed column "${d.from}" to "${d.to}"`;
  }
  switch (log.action) {
    case "CREATED":
      return `created ${type} "${what}"`;
    case "UPDATED":
      return `updated ${type} "${what}"${d.fields ? ` (${d.fields.join(", ")})` : ""}`;
    case "MOVED":
      return `moved "${what}" from ${d.from} to ${d.to}`;
    case "DELETED":
      return `deleted ${type} "${what}"`;
    default:
      return log.action.toLowerCase();
  }
}

export const formatTime = (iso) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
