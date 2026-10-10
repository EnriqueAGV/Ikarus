// Placing a day's appointments and blocks on the week's time grid. Pure, in
// minutes since local midnight, so it is unit-tested directly.

export type Span = { id: string; start: number; end: number };
export type Placed<T extends Span> = T & { lane: number; lanes: number };

// Items that overlap share the column side by side: each gets a lane, and
// every item in an overlapping group knows how many lanes the group needs.
export function placeInLanes<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = lanes;
    out.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd && group.length) close();
    // The first lane whose last item has ended.
    let lane = 0;
    while (group.some((g) => g.lane === lane && g.end > item.start)) lane++;
    group.push({ ...item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd === -Infinity ? item.end : groupEnd, item.end);
  }
  if (group.length) close();
  return out;
}

export const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// The hours the grid shows: the week's opening hours and anything booked
// outside them, rounded out to whole hours. 08:00–18:00 when there is nothing.
export function gridRange(openings: Array<[string, string]>, items: Span[]): [number, number] {
  const starts = [...openings.map((w) => minutes(w[0])), ...items.map((i) => i.start)];
  const ends = [...openings.map((w) => minutes(w[1])), ...items.map((i) => i.end)];
  if (!starts.length) return [8 * 60, 18 * 60];
  const from = Math.floor(Math.min(...starts) / 60) * 60;
  const to = Math.ceil(Math.max(...ends) / 60) * 60;
  return [Math.max(0, from), Math.min(24 * 60, Math.max(to, from + 60))];
}
