/**
 * 0.17.0: Cron Triggers for team Workers. Standard 5-field cron (UTC), validated here so a
 * bad schedule is a 400 before anything reaches Cloudflare. A minimum interval keeps one
 * team from using the account's small cron budget for per-minute jobs.
 */
export class CronError extends Error {}

export const MAX_CRONS_PER_WORKER = 3;
const FIELDS: [string, number, number][] = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["day of month", 1, 31],
  ["month", 1, 12],
  ["day of week", 0, 7],
];
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const DAYS = "sun mon tue wed thu fri sat".split(" ");

function expand(raw: string, i: number): Set<number> {
  const [name, lo, hi] = FIELDS[i] as [string, number, number];
  const out = new Set<number>();
  const word = (w: string) => {
    const l = w.toLowerCase();
    if (i === 3 && MONTHS.includes(l)) return MONTHS.indexOf(l) + 1;
    if (i === 4 && DAYS.includes(l)) return DAYS.indexOf(l);
    if (!/^\d{1,2}$/.test(w)) throw new CronError(`${name}: "${w}" is not a number`);
    return Number(w);
  };
  for (const part of raw.split(",")) {
    const m = part.match(/^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d{1,2}))?$/);
    if (!m) throw new CronError(`${name}: "${part}" is not valid`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new CronError(`${name}: step must be at least 1`);
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = (m[1] as string).split("-");
      a = word(x as string);
      b = y === undefined ? (m[2] ? hi : a) : word(y);
    }
    if (a < lo || b > hi || a > b) throw new CronError(`${name}: ${part} is out of range ${lo}-${hi}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

/**
 * Validate one expression; returns it normalised (single spaces) and the smallest gap in
 * minutes between two runs within an hour-pattern (a conservative estimate).
 */
export function parseCron(expr: unknown): { cron: string; minGapMin: number } {
  if (typeof expr !== "string") throw new CronError("a cron expression is a string");
  const cron = expr.trim().replace(/\s+/g, " ");
  if (cron.startsWith("@")) throw new CronError(`"${cron}": use the 5-field form (e.g. "*/15 * * * *")`);
  const parts = cron.split(" ");
  if (parts.length !== 5) throw new CronError(`"${cron}": 5 fields (minute hour day month weekday)`);
  const sets = parts.map((p, i) => expand(p, i));
  const minutes = [...(sets[0] as Set<number>)].sort((x, y) => x - y);
  const hours = sets[1] as Set<number>;
  let gap = 24 * 60;
  for (let k = 1; k < minutes.length; k++)
    gap = Math.min(gap, (minutes[k] as number) - (minutes[k - 1] as number));
  // Consecutive hours: the wrap from the last minute of one hour to the first of the next.
  const hs = [...hours].sort((x, y) => x - y);
  const consecutive = hs.length === 24 || hs.some((h, k) => k > 0 && h - (hs[k - 1] as number) === 1);
  if (consecutive) gap = Math.min(gap, 60 - (minutes.at(-1) as number) + (minutes[0] as number));
  return { cron, minGapMin: gap };
}

/** Read the `crons` field of a deploy: undefined = keep, [] = remove all. */
export function readCrons(raw: unknown, minIntervalMin: number): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new CronError('crons: a list such as ["*/15 * * * *"] (or [] to remove)');
  if (raw.length > MAX_CRONS_PER_WORKER)
    throw new CronError(`crons: at most ${MAX_CRONS_PER_WORKER} per Worker`);
  const out: string[] = [];
  for (const e of raw) {
    const { cron, minGapMin } = parseCron(e);
    if (minGapMin < minIntervalMin)
      throw new CronError(
        `"${cron}" runs every ${minGapMin} min; the minimum interval is ${minIntervalMin} min`,
      );
    if (!out.includes(cron)) out.push(cron);
  }
  return out;
}
