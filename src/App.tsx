import { useMemo, useState } from "react";

/**
 * ShuttleForge — Route Dispatch (supports single- and two-leg jobs)
 *
 * Rules:
 *  - Single-leg jobs are allowed
 *  - Two-leg jobs must be A then B, with Leg B >= next day after Leg A
 *  - 3+ legs -> error
 *  - Driver required on each leg
 *  - At least one van driver present on any day with car moves
 * UI:
 *  - Tabs per route, List/Timeline toggle
 *  - Urgency chips: red (today/overdue), amber (<=3d), green (>3d)
 *  - Capacity & Overbooked panel
 *  - Checks panel summarizing errors/warnings
 *  - Export button disabled on errors
 */

/* ---------------- Helpers ---------------- */

function pad2(n: number) { return String(n).padStart(2, "0"); }
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function daysBetween(aISO: string, bISO: string) {
  const A = new Date(aISO + "T00:00:00").getTime();
  const B = new Date(bISO + "T00:00:00").getTime();
  return Math.round((B - A) / 86400000);
}
function addDaysISO(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return iso(d);
}
function formatMMDDYY(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + "/" + String(d.getFullYear()).slice(2);
}
function urgencyClass(daysUntil: number) {
  if (daysUntil <= 0) return "bg-red-100 text-red-800 border-red-300";
  if (daysUntil <= 3) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-green-100 text-green-800 border-green-300";
}

type Car = {
  owner: string;
  makeModel: string;
  plate: string;
};

type Leg = {
  leg?: string;
  startLocation: string;
  endLocation: string;
  date: string;
  depart: string;
  arrive: string;
  driverId?: string;
};

type Job = {
  id: string;
  car: Car;
  legs: Leg[];
};

type Driver = {
  id: string;
  name: string;
  role: "shuttle" | "van";
  onDuty: boolean;
};

type Route = {
  id: string;
  name: string;
};

type Issue = {
  level: "error" | "warn";
  message: string;
};

type DayCapacity = {
  cars: number;
  shuttleOnDuty: number;
};

/** Job number: OwnerName-MM/DD/YY (Leg B date, else single leg's date) */
function jobNumber(job: Job) {
  const legB = job.legs.find(l => l.leg === "B");
  const useDate = legB ? legB.date : (job.legs[0] ? job.legs[0].date : "");
  return job.car.owner + "-" + formatMMDDYY(useDate);
}

/* ---------------- Rule Engine ---------------- */

/**
 * evaluate(routeTodayISO, jobs, drivers)
 * returns { issues, byDayCapacity }
 * - issues: [{level: 'error'|'warn', message}]
 * - byDayCapacity: Map<dateISO, {cars, shuttleOnDuty}>
 */
function evaluate(_routeTodayISO: string, jobs: Job[], drivers: Driver[]) {
  const issues: Issue[] = [];

  for (const job of jobs) {
    if (!job.legs || job.legs.length === 0) {
      issues.push({ level: "error", message: `Job ${job.id}: must have at least one leg` });
      continue;
    }

    if (job.legs.length === 1) {
      // ✅ single-leg OK (no A/B enforcement)
    } else if (job.legs.length === 2) {
      const [a, b] = job.legs;
      if (a.leg !== "A" || b.leg !== "B") {
        issues.push({ level: "error", message: `Job ${job.id}: legs must be in order A then B` });
      }
      if (daysBetween(a.date, b.date) < 1) {
        issues.push({ level: "error", message: `Job ${job.id}: Leg B must be at least the next day after Leg A` });
      }
    } else {
      issues.push({ level: "error", message: `Job ${job.id}: too many legs (${job.legs.length})` });
    }
  }

  // Driver required on each leg
  for (const job of jobs) {
    for (const leg of job.legs || []) {
      if (!leg.driverId) {
        issues.push({ level: "warn", message: `Job ${job.id}: missing driver assignment on Leg ${leg.leg || "?"}` });
      }
    }
  }

  // Capacity & van presence
  const byDayCapacity = new Map<string, DayCapacity>();
  const days = new Set<string>();
  for (const j of jobs) for (const l of j.legs) days.add(l.date);
  for (const d of days) byDayCapacity.set(d, { cars: 0, shuttleOnDuty: 0 });

  for (const j of jobs) for (const l of j.legs) {
    const cap = byDayCapacity.get(l.date);
    if (cap) cap.cars += 1;
  }

  const shuttleOnDutyCount = drivers.filter(d => d.role === "shuttle" && d.onDuty).length;
  for (const d of days) {
    const cap = byDayCapacity.get(d);
    if (cap) cap.shuttleOnDuty = shuttleOnDutyCount;
  }

  // Van presence (demo simplification: if any van driver is onDuty, assume coverage)
  const hasAnyVan = drivers.some(d => d.role === "van" && d.onDuty);
  for (const [dISO, v] of byDayCapacity.entries()) {
    if (v.cars > 0 && !hasAnyVan) {
      issues.push({ level: "error", message: `No van driver scheduled on ${dISO} but ${v.cars} cars are moving` });
    }
  }

  return { issues, byDayCapacity };
}

/* ---------------- Demo Data ---------------- */

const TODAY = "2025-10-26";

const DEMO_ROUTES: Route[] = [
  { id: "main_salmon", name: "Main Salmon" },
  { id: "middle_fork", name: "Middle Fork" },
];

const DEMO_DRIVERS: Driver[] = [
  { id: "D1", name: "Mike W", role: "shuttle", onDuty: true },
  { id: "D2", name: "Sasha R", role: "shuttle", onDuty: true },
  { id: "D3", name: "Troy H", role: "shuttle", onDuty: true },
  { id: "V1", name: "Van Crew", role: "van", onDuty: true },
];

const DEMO_DATA: Record<string, { currentDate: string; drivers: Driver[]; jobs: Job[] }> = {
  main_salmon: {
    currentDate: TODAY,
    drivers: DEMO_DRIVERS,
    jobs: [
      // Two-leg OK
      {
        id: "J-1002",
        car: { owner: "Wilson", makeModel: "Toyota 4Runner", plate: "ID-7S1234" },
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-26", depart: "07:30", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "11:15", arrive: "16:30", driverId: "D3" },
        ],
      },
      // Single-leg OK
      {
        id: "J-2001",
        car: { owner: "Solo", makeModel: "Chevy Tahoe", plate: "OR-9XY123" },
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Hammer Creek", date: "2025-10-28", depart: "08:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      // Two-leg: bad (same-day B + missing driver on B) -> error + warn
      {
        id: "J-1003",
        car: { owner: "Ramirez", makeModel: "Ford F-150", plate: "WA-C56789B" },
        legs: [
          { leg: "A", startLocation: "Indian Creek", endLocation: "Stanley Yard", date: "2025-10-26", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "12:15", arrive: "17:00" },
        ],
      },
    ],
  },
  middle_fork: {
    currentDate: TODAY,
    drivers: DEMO_DRIVERS,
    jobs: [
      // Single-leg example (common on some routes)
      {
        id: "MF-42",
        car: { owner: "Johnson", makeModel: "Jeep Grand Cherokee", plate: "ID-3A009X" },
        legs: [
          { leg: "A", startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
    ],
  },
};

/* ---------------- Root Component ---------------- */

export default function RouteDispatchPage() {
  const [activeRoute, setActiveRoute] = useState("main_salmon");
  const route = DEMO_ROUTES.find(r => r.id === activeRoute);

  // Local state so UI updates in place
  const [jobs] = useState(DEMO_DATA[activeRoute].jobs);
  const [drivers] = useState(DEMO_DATA[activeRoute].drivers);
  const currentDate = DEMO_DATA[activeRoute].currentDate;

  const { issues, byDayCapacity } = useMemo(
    () => evaluate(currentDate, jobs, drivers),
    [currentDate, jobs, drivers]
  );

  const overbookedDays = useMemo(
    () => Array.from(byDayCapacity.entries())
      .filter(([, v]) => v.cars > v.shuttleOnDuty)
      .map(([d]) => d),
    [byDayCapacity]
  );

  const carsToMove = jobs.length;
  const hasErrors = issues.some(i => i.level === "error");
  const exportBlocked = hasErrors;

  const [mode, setMode] = useState<"list" | "timeline">("list");

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        {DEMO_ROUTES.map(r => (
          <button
            key={r.id}
            onClick={() => setActiveRoute(r.id)}
            className={`px-3 py-2 rounded-xl border text-sm ${activeRoute === r.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="rounded-2xl border p-4 bg-white flex items-center justify-between">
        <div>
          <div className="text-xl font-bold">{route?.name} — Dispatch</div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 rounded border bg-slate-50">Cars to move: {carsToMove}</span>
            <span className="px-2 py-1 rounded border bg-slate-50">Overbooked days: {overbookedDays.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMode("list")} className={`px-3 py-2 rounded-xl border text-sm ${mode === 'list' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>List</button>
          <button onClick={() => setMode("timeline")} className={`px-3 py-2 rounded-xl border text-sm ${mode === 'timeline' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>Timeline</button>
          <button disabled={exportBlocked} className={`px-3 py-2 rounded-xl border text-sm ${exportBlocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}>Export</button>
        </div>
      </div>

      {/* Checks Panel */}
      {issues.length > 0 && (
        <div className="rounded-2xl border p-4 bg-amber-50 text-amber-900">
          <div className="font-semibold mb-1">Checks</div>
          <ul className="list-disc list-inside text-sm space-y-1">
            {issues.map((i, idx) => (
              <li key={idx} className={i.level === 'error' ? 'text-red-800' : ''}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          {mode === 'list' ? (
            <ListMode jobs={jobs} currentDate={currentDate} />
          ) : (
            <TimelineMode jobs={jobs} currentDate={currentDate} />
          )}
        </div>

        {/* Sidebar */}
        <div>
          <CapacityPanel capacityByDay={byDayCapacity} overbookedDays={overbookedDays} todayISO={currentDate} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- List View ---------------- */

function ListMode({ jobs, currentDate }: { jobs: Job[]; currentDate: string }) {
  // group by earliest leg date
  const groups = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      const d = j.legs[0].date;
      const arr = map.get(d) || [];
      arr.push(j);
      map.set(d, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1);
  }, [jobs]);

  function pillFor(leg: Leg) {
    const days = daysBetween(currentDate, leg.date);
    const cls = urgencyClass(days);
    const label = days <= 0 ? "Due" : days + "d";
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
  }

  return (
    <div className="space-y-6">
      {groups.map(([dateISO, arr]) => (
        <div key={dateISO} className="rounded-2xl border bg-white">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="font-semibold">{dateISO} — Deliveries</div>
            <div className="text-xs text-slate-600">{arr.length} jobs</div>
          </div>
          <div className="divide-y">
            {arr.map(job => (
              <div key={job.id} className="p-3 flex items-center gap-3">
                <div className="shrink-0 h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-sm font-medium">{job.car.owner.charAt(0)}</div>
                <div className="flex-1">
                  <div className="font-semibold">{jobNumber(job)}</div>
                  <div className="text-xs text-slate-600">{job.car.makeModel} • Plate: {job.car.plate}</div>
                  <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    {job.legs.map((L, idx) => (
                      <div key={idx} className="rounded border px-2 py-1">
                        <div className="flex items-center justify-between">
                          {job.legs.length > 1 ? (
                            <span className="font-medium">Leg {L.leg || "?"}</span>
                          ) : (
                            <span className="font-medium">Route</span>
                          )}
                          {pillFor(L)}
                        </div>
                        <div className="text-xs text-slate-700">{L.startLocation} <span className="mx-1">&rarr;</span> {L.endLocation}</div>
                        <div className="text-xs text-slate-700">{L.date} {L.depart} - {L.arrive}</div>
                        <div className="text-xs text-slate-700">Driver: {L.driverId || "Unassigned"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Timeline View ---------------- */

function TimelineMode({ jobs, currentDate }: { jobs: Job[]; currentDate: string }) {
  const startISO = useMemo(() => {
    const min = jobs.reduce((acc, j) => Math.min(acc, new Date(j.legs[0].date + "T00:00:00").getTime()), Number.POSITIVE_INFINITY);
    return iso(new Date(min - 86400000));
  }, [jobs]);
  
  const endISO = useMemo(() => {
    const max = jobs.reduce((acc, j) => {
      const lastLegDate = j.legs[j.legs.length - 1].date;
      return Math.max(acc, new Date(lastLegDate + "T00:00:00").getTime());
    }, 0);
    return iso(new Date(max + 86400000));
  }, [jobs]);

  const totalDays = Math.max(1, daysBetween(startISO, endISO));
  function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
  function xFor(dateISO: string) { return clamp(daysBetween(startISO, dateISO), 0, totalDays); }
  function barStyle(x: number) { return { left: `calc(${x} * 100% / ${totalDays + 1})`, width: `calc(100% / ${totalDays + 1})` }; }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="font-semibold mb-2">Schedule (Timeline)</div>
      <div className="relative border-t">
        <div className="sticky top-0 bg-white/80 backdrop-blur z-10">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${totalDays + 1}, minmax(64px,1fr))` }}>
            {Array.from({ length: totalDays + 1 }).map((_, i) => (
              <div key={i} className="text-xs text-slate-600 px-2 py-1 border-r">{addDaysISO(startISO, i)}</div>
            ))}
          </div>
        </div>
        <div className="space-y-2 mt-2">
          {jobs.map(job => {
            const first = job.legs[0];
            const second = job.legs[1];
            const aX = xFor(first.date);
            const clsA = urgencyClass(daysBetween(currentDate, first.date));
            const bX = second ? xFor(second.date) : null;
            const clsB = second ? urgencyClass(daysBetween(currentDate, second.date)) : null;

            return (
              <div key={job.id} className="border rounded p-2">
                <div className="text-sm font-semibold mb-1">
                  {jobNumber(job)} <span className="text-slate-600 font-normal">— {job.car.makeModel} ({job.car.plate})</span>
                </div>
                <div className="relative grid" style={{ gridTemplateColumns: `repeat(${totalDays + 1}, minmax(64px,1fr))` }}>
                  <div
                    className={`absolute top-1 h-6 rounded border ${clsA}`}
                    style={barStyle(aX)}
                    title={(job.legs.length > 1 ? "Leg " + (first.leg || "?") + ": " : "") + first.startLocation + " to " + first.endLocation + " on " + first.date}
                  ></div>
                  {second && bX !== null && (
                    <div
                      className={`absolute top-9 h-6 rounded border ${clsB}`}
                      style={barStyle(bX)}
                      title={"Leg " + (second.leg || "?") + ": " + second.startLocation + " to " + second.endLocation + " on " + second.date}
                    ></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

function CapacityPanel({ capacityByDay, overbookedDays, todayISO }: { 
  capacityByDay: Map<string, DayCapacity>; 
  overbookedDays: string[]; 
  todayISO: string 
}) {
  const rows = Array.from(capacityByDay.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return (
    <div className="rounded-2xl border bg-white p-4 space-y-4">
      <div className="font-semibold">Capacity & Warnings</div>
      <div className="space-y-2 text-sm">
        {rows.map(([d, v]) => {
          const over = v.cars > v.shuttleOnDuty;
          const cls = over ? "text-red-700" : "text-slate-700";
          return (
            <div key={d} className="flex items-center justify-between">
              <span className={cls}>{d}</span>
              <span className={cls}>{v.cars} cars / {v.shuttleOnDuty} drivers</span>
            </div>
          );
        })}
      </div>
      {overbookedDays.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          <div className="font-medium mb-1">Overbooked</div>
          <ul className="list-disc list-inside">
            {overbookedDays.map(d => (<li key={d}>{d}</li>))}
          </ul>
        </div>
      )}
      <div className="rounded border bg-slate-50 p-2 text-xs text-slate-700">Today: {todayISO}</div>
    </div>
  );
}
