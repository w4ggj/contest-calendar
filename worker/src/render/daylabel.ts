/**
 * One day-label implementation, used by the server and shipped verbatim to the
 * client.
 *
 * The rail's cells are whole UTC days and the server labels them in UTC. When
 * the reader switches to local time the cells do not move -- they are instants,
 * and so are the bars drawn against them -- but the label has to name the date
 * the cell *begins* on where the reader is standing. At 0304Z on Friday 14
 * August a reader in New York is still on Thursday the 13th, and a rail headed
 * "Today 14" is telling them about a day they have not reached yet.
 *
 * The client gets this exact function, interpolated as source into `CLIENT_JS`,
 * rather than a second copy of the same eight lines. This repo already keeps
 * two engines identical by test because two implementations of a date drift
 * silently; it should not acquire a third pair that agree only by inspection.
 * That means the function must stay self-contained -- no imports, no module
 * scope, ES5 shapes only -- because the client receives its body and nothing
 * around it.
 */
export function dayCellLabel(
  instantMs: number,
  index: number,
  timeZone: string,
): string {
  var parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    weekday: "short",
    day: "numeric",
  }).formatToParts(new Date(instantMs));
  var weekday = "";
  var day = "";
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === "weekday") weekday = parts[i].value;
    else if (parts[i].type === "day") day = parts[i].value;
  }
  // Cell 0 is whichever cell holds `now`, in either zone: the day in progress.
  // Joined with a non-breaking space so "Fri 15" cannot wrap inside a cell an
  // eighth of the rail wide.
  return (index === 0 ? "Today" : weekday) + "\u00A0" + day;
}
