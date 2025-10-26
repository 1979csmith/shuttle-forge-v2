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
  year: number;
  color: string;
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
        car: { owner: "Wilson", makeModel: "Toyota 4Runner", plate: "ID-7S1234", year: 2019, color: "Silver" },
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-26", depart: "07:30", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "11:15", arrive: "16:30", driverId: "D3" },
        ],
      },
      // Single-leg OK (no leg designation needed)
      {
        id: "J-2001",
        car: { owner: "Solo", makeModel: "Chevy Tahoe", plate: "OR-9XY123", year: 2021, color: "Black" },
        legs: [
          { startLocation: "Corn Creek", endLocation: "Hammer Creek", date: "2025-10-28", depart: "08:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      // Two-leg: bad (same-day B + missing driver on B) -> error + warn
      {
        id: "J-1003",
        car: { owner: "Ramirez", makeModel: "Ford F-150", plate: "WA-C56789B", year: 2018, color: "Blue" },
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
      // Single-leg example (common on some routes) - no leg designation needed
      {
        id: "MF-42",
        car: { owner: "Johnson", makeModel: "Jeep Grand Cherokee", plate: "ID-3A009X", year: 2020, color: "White" },
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
    ],
  },
};

/* ---------------- Root Component ---------------- */

export default function RouteDispatchPage() {
  const [activeRoute, setActiveRoute] = useState("main_salmon");
  const route = DEMO_ROUTES.find(r => r.id === activeRoute);

  // Get data for active route (updates when route changes)
  const jobs = DEMO_DATA[activeRoute].jobs;
  const drivers = DEMO_DATA[activeRoute].drivers;
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

  const [mode, setMode] = useState<"list" | "timeline" | "calendar">("list");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

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
          <button onClick={() => setMode("calendar")} className={`px-3 py-2 rounded-xl border text-sm ${mode === 'calendar' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>Calendar</button>
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
          {mode === 'list' && <ListMode jobs={jobs} currentDate={currentDate} />}
          {mode === 'calendar' && <CalendarView jobs={jobs} currentDate={currentDate} onSelectJob={setSelectedJob} />}
          {mode === 'timeline' && <TimelineMode jobs={jobs} currentDate={currentDate} />}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {mode === 'calendar' && (
            <JobDetailsPanel job={selectedJob} currentDate={currentDate} onClose={() => setSelectedJob(null)} />
          )}
          <CapacityPanel capacityByDay={byDayCapacity} overbookedDays={overbookedDays} todayISO={currentDate} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- List View ---------------- */

function ListMode({ jobs, currentDate }: { jobs: Job[]; currentDate: string }) {
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  function pillFor(leg: Leg) {
    const days = daysBetween(currentDate, leg.date);
    const cls = urgencyClass(days);
    const label = days <= 0 ? "Due" : days + "d";
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cls}`}>{label}</span>;
  }

  function toggleExpand(jobId: string) {
    const newExpanded = new Set(expandedJobs);
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId);
    } else {
      newExpanded.add(jobId);
    }
    setExpandedJobs(newExpanded);
  }

  // Get most urgent leg for overall urgency
  function getMostUrgentLeg(job: Job) {
    return job.legs.reduce((mostUrgent, leg) => {
      const days = daysBetween(currentDate, leg.date);
      const mostUrgentDays = daysBetween(currentDate, mostUrgent.date);
      return days < mostUrgentDays ? leg : mostUrgent;
    }, job.legs[0]);
  }

  return (
    <div className="space-y-3">
      {jobs.map(job => {
        const isExpanded = expandedJobs.has(job.id);
        const mostUrgentLeg = getMostUrgentLeg(job);
        const urgentDays = daysBetween(currentDate, mostUrgentLeg.date);
        const cardBgClass = urgentDays <= 0 ? 'bg-red-50 border-red-200' : 
                           urgentDays <= 3 ? 'bg-amber-50 border-amber-200' : 
                           'bg-white border-slate-200';

        return (
          <div 
            key={job.id} 
            className={`rounded-xl border-2 ${cardBgClass} p-4 cursor-pointer hover:shadow-md transition-all`}
            onClick={() => toggleExpand(job.id)}
          >
            {/* Collapsed View */}
            <div className="flex items-center gap-4">
              {/* Vehicle Avatar */}
              <div className="shrink-0 h-14 w-14 rounded-lg bg-slate-700 text-white flex items-center justify-center text-lg font-bold">
                {job.car.owner.charAt(0)}
              </div>

              {/* Vehicle Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-bold text-lg">{job.car.owner}</div>
                  {pillFor(mostUrgentLeg)}
                </div>
                <div className="text-sm text-slate-700 space-y-0.5">
                  <div>
                    <span className="font-medium">{job.car.year} {job.car.makeModel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{job.car.color}</span>
                    <span className="text-slate-400">•</span>
                    <span className="font-mono font-medium">{job.car.plate}</span>
                  </div>
                </div>
                {!isExpanded && (
                  <div className="text-xs text-slate-500 mt-1">
                    {job.legs.length === 1 ? 'Single delivery' : `${job.legs.length} legs`} • Click to expand
                  </div>
                )}
              </div>

              {/* Expand Icon */}
              <div className="shrink-0 text-slate-400">
                {isExpanded ? '▼' : '▶'}
              </div>
            </div>

            {/* Expanded View */}
            {isExpanded && (
              <div className="mt-4 pt-4 border-t border-slate-300 space-y-3" onClick={(e) => e.stopPropagation()}>
                {/* Job Number */}
                <div className="text-sm text-slate-600">
                  Job #: <span className="font-mono font-medium">{jobNumber(job)}</span>
                </div>

                {/* Legs */}
                <div className="space-y-2">
                  {job.legs.map((leg, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-300 bg-white p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">
                          {job.legs.length > 1 ? `Leg ${leg.leg || '?'}` : 'Delivery'}
                        </span>
                        {pillFor(leg)}
                      </div>
                      <div className="space-y-1 text-xs text-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Route:</span>
                          <span className="font-medium">{leg.startLocation} → {leg.endLocation}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Date:</span>
                          <span className="font-medium">{leg.date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Time:</span>
                          <span>{leg.depart} - {leg.arrive}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Driver:</span>
                          <span className="font-medium text-blue-600">{leg.driverId || 'Unassigned'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Calendar View ---------------- */

function startOfWeek(isoStr: string): string {
  const d = new Date(isoStr + "T00:00:00");
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const s = new Date(d);
  s.setDate(d.getDate() - day); // move to Sunday
  return s.toISOString().slice(0, 10);
}

function daysArray(startISO: string, count: number): string[] {
  const arr: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startISO + "T00:00:00");
    d.setDate(d.getDate() + i);
    arr.push(d.toISOString().slice(0, 10));
  }
  return arr;
}

/** Calendar grid (7 columns x N weeks). Cards render on their leg date(s) */
function CalendarView({ jobs, currentDate, onSelectJob }: {
  jobs: Job[];
  currentDate: string;
  onSelectJob: (job: Job) => void;
}) {
  // Show a 3-week window centered around current week for dispatching
  const weekStart = startOfWeek(currentDate);            // Sunday
  const gridStart = addDaysISO(weekStart, -7);           // one week before
  const allDays = daysArray(gridStart, 21);              // 3 weeks

  // bucket jobs by day (we display a card on first leg date; small pill on second)
  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const day of allDays) map.set(day, []);
    for (const job of jobs) {
      const first = job.legs[0];
      if (map.has(first.date)) map.get(first.date)!.push(job);
    }
    return map;
  }, [jobs, allDays]);

  return (
    <div className="rounded-2xl border bg-white">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b bg-slate-50 text-xs text-slate-600">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-3 py-2 border-r last:border-r-0 font-semibold">{d}</div>
        ))}
      </div>

      {/* Rows (3 weeks) */}
      <div className="grid grid-cols-7 gap-px bg-slate-200">
        {allDays.map((dayISO) => {
          const isToday = dayISO === currentDate;
          const dayNum = new Date(dayISO + "T00:00:00").getDate();
          
          return (
            <div key={dayISO} className={`bg-white p-2 min-h-[140px] ${isToday ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-medium ${isToday ? 'text-blue-600 font-bold' : 'text-slate-600'}`}>
                  {dayNum}
                  {isToday && <span className="ml-1 text-[10px]">Today</span>}
                </div>
              </div>

              {/* Vehicle cards for this day */}
              <div className="space-y-2">
                {(byDay.get(dayISO) || []).map(job => (
                  <VehicleCard
                    key={job.id}
                    job={job}
                    currentDate={currentDate}
                    onClick={() => onSelectJob(job)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Vehicle Card (calendar cell) ---------------- */

function VehicleCard({ job, currentDate, onClick }: {
  job: Job;
  currentDate: string;
  onClick: () => void;
}) {
  const first = job.legs[0];
  const second = job.legs[1]; // may be undefined for single-leg
  const days = daysBetween(currentDate, first.date);
  const cls = urgencyClass(days);
  const label = days <= 0 ? "Due" : (days + "d");

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border ${cls} px-2 py-1.5 hover:shadow transition text-xs`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="font-semibold truncate text-xs">{jobNumber(job)}</div>
        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px]">{label}</span>
      </div>
      <div className="text-[10px] text-slate-700 truncate">
        {first.startLocation} → {first.endLocation}
      </div>
      <div className="text-[10px] text-slate-600 truncate">{job.car.makeModel} • {job.car.plate}</div>

      {/* If there is a Leg B, show a small chip so dispatch sees the second day */}
      {second && (
        <div className="mt-1 text-[9px] text-slate-600 truncate">
          Leg B: {formatMMDDYY(second.date)} {second.depart}
        </div>
      )}
    </button>
  );
}

/* ---------------- Job Details Panel ---------------- */

function JobDetailsPanel({ job, currentDate, onClose }: {
  job: Job | null;
  currentDate: string;
  onClose: () => void;
}) {
  if (!job) {
    return (
      <div className="rounded-2xl border bg-white p-4 mb-4">
        <div className="text-sm text-slate-600">Click a vehicle card to view details.</div>
      </div>
    );
  }

  const first = job.legs[0];
  const second = job.legs[1];
  
  const badge = (leg: Leg) => {
    const d = daysBetween(currentDate, leg.date);
    const cls = urgencyClass(d);
    const txt = d <= 0 ? "Due" : (d + "d");
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${cls}`}>{txt}</span>;
  };

  return (
    <div className="rounded-2xl border bg-white p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">{jobNumber(job)}</div>
          <div className="text-xs text-slate-600">{job.car.makeModel} • {job.car.plate}</div>
        </div>
        <button onClick={onClose} className="px-2 py-1 text-sm rounded border hover:bg-slate-50">Close</button>
      </div>

      <div className="mt-3 text-xs text-slate-600 space-y-1">
        <InfoRow label="Owner" value={job.car.owner} />
        <InfoRow label="Vehicle" value={`${job.car.year} ${job.car.makeModel}`} />
        <InfoRow label="Color" value={job.car.color} />
        <InfoRow label="Plate" value={job.car.plate} />
      </div>

      {/* Leg A */}
      <div className="mt-3 rounded-xl border p-3 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium text-sm">Leg {first.leg || "A"}</div>
          {badge(first)}
        </div>
        <div className="space-y-1">
          <InfoRow label="Route" value={`${first.startLocation} → ${first.endLocation}`} />
          <InfoRow label="Date" value={first.date} />
          <InfoRow label="Time" value={`${first.depart} - ${first.arrive}`} />
          <InfoRow label="Driver" value={first.driverId || "Unassigned"} />
        </div>
      </div>

      {/* Leg B (if present) */}
      {second && (
        <div className="mt-3 rounded-xl border p-3 bg-slate-50">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm">Leg {second.leg || "B"}</div>
            {badge(second)}
          </div>
          <div className="space-y-1">
            <InfoRow label="Route" value={`${second.startLocation} → ${second.endLocation}`} />
            <InfoRow label="Date" value={second.date} />
            <InfoRow label="Time" value={`${second.depart} - ${second.arrive}`} />
            <InfoRow label="Driver" value={second.driverId || "Unassigned"} />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center text-xs text-slate-800">
      <div className="w-16 text-slate-500">{label}:</div>
      <div className="flex-1 font-medium">{value}</div>
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
