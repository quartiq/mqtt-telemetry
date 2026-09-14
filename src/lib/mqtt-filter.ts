export function topicMatchesFilter(topic: string, filter: string): boolean {
  if (mqttFilterError(filter)) return false;
  const topicLevels = topic.split("/");
  const filterLevels = filter.split("/");
  if (
    topic.startsWith("$") &&
    (filterLevels[0] === "+" || filterLevels[0] === "#")
  )
    return false;
  for (let index = 0; index < filterLevels.length; index += 1) {
    const level = filterLevels[index];
    if (level === "#") return true;
    if (index >= topicLevels.length) return false;
    if (level !== "+" && level !== topicLevels[index]) return false;
  }
  return topicLevels.length === filterLevels.length;
}

export function mqttFilterError(filter: string): string | undefined {
  if (!filter) return "A topic filter must not be empty.";
  if (/[\u0000\uD800-\uDFFF]/u.test(filter))
    return "A topic filter must be valid UTF-8 without null characters.";
  if (new TextEncoder().encode(filter).length > 65_535)
    return "A topic filter must fit in 65,535 UTF-8 bytes.";
  const levels = filter.split("/");
  for (const [index, level] of levels.entries()) {
    if (level.includes("+") && level !== "+")
      return "+ must occupy a complete topic level.";
    if (level.includes("#") && (level !== "#" || index !== levels.length - 1))
      return "# must occupy the final complete topic level.";
  }
  return undefined;
}
