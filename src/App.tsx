import React, { useMemo, useState } from "react";

// ---- ShuttleForge MVP v0.1 (pure React + Tailwind) ----
// Single-file, deploy-ready mock with local state only.
// Goals: show the core flow (route -> overview -> jobs list -> capacity math)
// You can drop this into any Next.js/React project or run in CodeSandbox.

// ---- Types ----
type Job = {
  id: string;
  route: string;
  putIn: string; // ISO date
  takeOut: string; // ISO date
  cars: number; // number of vehicles
  customer: string;
  status: "Pending" | "Accepted" | "In Progress" | "Completed";
};

type CarRow = {
  job: Job;
  carIndex: number;
  deliveryISO: string;
  pulledForward: boolean;
  overflow: boolean;
};

const ROUTES = ["Main Salmon", "Middle Fork"] as const;
const CUSTOMERS = [
  "Johnson Party",
  "Wilson Crew",
  "Hernandez Group",
  "Green Family",
  "Nguyen Team",
  "Bennett Boats",
  "Ramirez Outfit",
  "Clark & Co.",
];

function isoDaysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmt(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function enumerateDays(startISO: string, endISO: string): string[] {
  const days: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  const current = new Date(start);
  
  while (current <= end) {
    days.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

// --- Simple Risk (traffic‑light) ---
// Red = urgent (trip ends today or already ended, not yet delivered)
// Orange = deliver today (D‑1)
// Green = good (scheduled early or already delivered)

function isoToday() { return new Date().toISOString().slice(0, 10); }

function simpleRisk(r: CarRow): { level: 'red'|'orange'|'green'; label: string } {
  const today = isoToday();
  const d1 = addDaysISO(r.job.takeOut, -1);

  // already delivered in the past
  if (r.deliveryISO < today) return { level: 'green', label: 'Delivered' };

  // trip ends today or earlier and delivery is not in the past
  if (r.job.takeOut <= today) return { level: 'red', label: 'Urgent' };

  // must deliver today (D‑1)
  if (today === d1 && r.deliveryISO === d1) return { level: 'orange', label: 'Deliver Today' };

  // scheduled earlier than D‑1 (good planning)
  if (r.deliveryISO < d1) return { level: 'green', label: 'Scheduled Early' };

  // scheduled on a future D‑1 (still fine / on time)
  if (r.deliveryISO === d1) return { level: 'green', label: 'On Time (D‑1)' };

  // fallback (shouldn't happen with our scheduler)
  return { level: 'green', label: 'Ready' };
}

function pickStatus(i: number): Job["status"] {
  const arr: Job["status"][] = ["Pending", "Accepted", "In Progress", "Accepted"]; // skew green
  return arr[i % arr.length];
}

function buildDemoJobs(days = 10): Job[] {
  const jobs: Job[] = [];
  let idCounter = 1000;
  for (let d = 0; d < days; d++) {
    const putIn = isoDaysFromNow(d);
    for (const route of ROUTES) {
      const perDay = 3 + ((d + route.length) % 3); // 3–5 jobs
      for (let k = 0; k < perDay; k++) {
        const id = `J-${++idCounter}`;
        const cars = 1 + ((idCounter + k) % 5); // 1–5 cars
        const customer = CUSTOMERS[(idCounter + k) % CUSTOMERS.length];
        const status = pickStatus(idCounter + k);
        const duration = 5 + ((idCounter + k) % 3); // 5–7 days
        jobs.push({ id, route, putIn, takeOut: addDaysISO(putIn, duration), cars, customer, status });
      }
    }
  }
  return jobs;
}

// ---------- Seed Data ----------

// ---------- Helpers ----------

function withinRange(job: Job, startISO: string, endISO: string) {
  return job.putIn >= startISO && job.putIn < endISO;
}

function vanDriversNeeded(totalCars: number) {
  // Per your rule: always 1 van driver if there are cars to move
  return totalCars > 0 ? 1 : 0;
}

// ---------- UI ----------
export default function ShuttleForge() {
  const demoSeed = useMemo(() => buildDemoJobs(14), []);
  const [jobs, setJobs] = useState<Job[]>(demoSeed);
  const [selectedRoute, setSelectedRoute] = useState<string | null>("Main Salmon");
  const [range, setRange] = useState<"3d" | "7d" | "30d">("7d");

  const startISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const endISO = useMemo(() => {
    const map: Record<typeof range, number> = { "3d": 3, "7d": 7, "30d": 30 } as const;
    const d = new Date();
    d.setDate(d.getDate() + map[range]);
    return d.toISOString().slice(0, 10);
  }, [range]);

  const routes = useMemo(() => {
    const set = new Set(jobs.map((j) => j.route));
    return Array.from(set);
  }, [jobs]);

  // Route filter only; date filtering happens on DELIVERY dates after scheduling
  const visibleJobs = useMemo(() => (selectedRoute ? jobs.filter(j => j.route === selectedRoute) : jobs), [jobs, selectedRoute]);

  // Each car becomes a scheduled delivery row
  // Prefer earliest available day within [putIn+1 .. takeOut-1]; cap 7/day, overflow to D-1 if needed
  const scheduledRows: CarRow[] = useMemo(() => {
    const rows: CarRow[] = [];
    const usage: Record<string, number> = {}; // shuttle drivers used per day
    const jobsSorted = [...visibleJobs].sort((a,b) => a.takeOut === b.takeOut ? a.putIn.localeCompare(b.putIn) : a.takeOut.localeCompare(b.takeOut));

    for (const job of jobsSorted) {
      const start = addDaysISO(job.putIn, 1);
      const end = addDaysISO(job.takeOut, -1);
      const eligible = enumerateDays(start, end);
      for (let ci = 0; ci < job.cars; ci++) {
        let assigned: string | null = null;
        for (const day of eligible) {
          const used = usage[day] || 0;
          if (used < 7) { usage[day] = used + 1; assigned = day; break; }
        }
        if (!assigned) {
          const d1 = addDaysISO(job.takeOut, -1);
          usage[d1] = (usage[d1] || 0) + 1;
          rows.push({ job, carIndex: ci, deliveryISO: d1, pulledForward: false, overflow: true });
        } else {
          rows.push({ job, carIndex: ci, deliveryISO: assigned, pulledForward: assigned !== addDaysISO(job.takeOut, -1), overflow: false });
        }
      }
    }
    return rows;
  }, [visibleJobs]);

  // Filter rows by DELIVERY window
  const rowsInRange = useMemo(() => scheduledRows.filter(r => r.deliveryISO >= startISO && r.deliveryISO < endISO), [scheduledRows, startISO, endISO]);

  const enriched = useMemo(() => rowsInRange.map(r => ({ ...r, risk: simpleRisk(r) })), [rowsInRange]);

  // Group by delivery day (ISO)
  const groups = useMemo(() => {
    const map: Record<string, (typeof enriched)[number][]> = {};
    for (const r of enriched) (map[r.deliveryISO] ||= []).push(r);
    const keys = Object.keys(map).sort();
    return keys.map(k => ({ iso: k, rows: map[k] }));
  }, [enriched]);

  // Metrics
  const metrics = useMemo(() => {
    const totalCars = rowsInRange.length;
    const driverCapacity = { available: 7, max: 7 };
    const neededVanDrivers = vanDriversNeeded(totalCars);
    const overbooked = totalCars > driverCapacity.available;
    return { 
      totalDeliveries: rowsInRange.length,
      totalCars,
      driverCapacity, 
      neededVanDrivers, 
      overbooked 
    };
  }, [rowsInRange]);

  // Integrity checks
  const jobToScheduledCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of scheduledRows) map[r.job.id] = (map[r.job.id] || 0) + 1;
    return map;
  }, [scheduledRows]);

  const reconciliationIssues = useMemo(() => {
    const issues: { job: Job; expected: number; scheduled: number }[] = [];
    for (const j of visibleJobs) { const s = jobToScheduledCount[j.id] || 0; if (s !== j.cars) issues.push({ job: j, expected: j.cars, scheduled: s }); }
    return issues;
  }, [visibleJobs, jobToScheduledCount]);

  const util30 = useMemo(() => {
    const days: { iso: string; used: number }[] = [];
    const start = new Date(startISO); const end = new Date(startISO); end.setDate(end.getDate() + 29);
    const usage: Record<string, number> = {};
    for (const r of scheduledRows) usage[r.deliveryISO] = (usage[r.deliveryISO] || 0) + 1;
    const d = new Date(start); while (d <= end) { const iso = d.toISOString().slice(0,10); days.push({ iso, used: usage[iso] || 0 }); d.setDate(d.getDate()+1); }
    return days;
  }, [scheduledRows, startISO]);

  // ---- Add Job (simple inline form) ----
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Job>({
    id: "",
    route: selectedRoute || "Main Salmon",
    putIn: startISO,
    takeOut: isoDaysFromNow(3),
    cars: 1,
    customer: "",
    status: "Pending",
  });

  function addJob() {
    if (!draft.customer) return;
    const id = `J-${Math.floor(1000 + Math.random() * 9000)}`;
    setJobs((prev: Job[]) => [...prev, { ...draft, id }]);
    setOpen(false);
    // reset
    setDraft({
      id: "",
      route: selectedRoute || "Main Salmon",
      putIn: startISO,
      takeOut: isoDaysFromNow(3),
      cars: 1,
      customer: "",
      status: "Pending",
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ShuttleForge — Dispatch</h1>
            <p className="text-sm text-slate-600">Ultra-lean MVP • Local data only • Ready to demo • v2.0</p>
          </div>
          <div className="flex items-center gap-2">
            <RangeButton label="Next 3 days" active={range === "3d"} onClick={() => setRange("3d")} />
            <RangeButton label="Next 7 days" active={range === "7d"} onClick={() => setRange("7d")} />
            <RangeButton label="Next 30 days" active={range === "30d"} onClick={() => setRange("30d")} />
          </div>
        </header>

        {/* Route selector */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {routes.map((r) => {
            const routeJobs = jobs.filter((j) => j.route === r && withinRange(j, startISO, endISO));
            const cars = routeJobs.reduce((s, j) => s + j.cars, 0);
            const requests = routeJobs.filter((j) => j.status === "Pending").length;
            const selected = selectedRoute === r;
            return (
              <button
                key={r}
                onClick={() => setSelectedRoute(r)}
                className={`text-left rounded-2xl p-4 shadow-sm border transition-all ${
                  selected ? "border-blue-500 shadow-md bg-white" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-lg">{r}</h2>
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-100">{routeJobs.length} jobs</span>
                </div>
                <div className="mt-2 text-sm text-slate-600">Cars to move: <b>{cars}</b></div>
                <div className="text-sm text-slate-600">Pending requests: <b>{requests}</b></div>
              </button>
            );
          })}
        </div>

        {/* Overview + Actions */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">{selectedRoute || "All Routes"} — Overview</h3>
              <button
                onClick={() => setOpen(true)}
                className="rounded-xl px-4 py-2 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                + New Job
              </button>
            </div>

            {/* Deliveries by day */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {(() => {
                if (groups.length === 0) return <div className="p-6 text-center text-slate-500">No deliveries scheduled.</div>;
                return (
                  <>
                    {groups.map(({ iso, rows }, idx) => {
                      // decide header state
                      const today = isoToday();
                      const anyUrgent = rows.some(r => r.risk.level === 'red');
                      const isTodayD1 = today === addDaysISO(rows[0].job.takeOut, -1) && rows.some(r => r.deliveryISO === today);
                      const state: 'good'|'today'|'urgent' = anyUrgent ? 'urgent' : isTodayD1 ? 'today' : 'good';

                      return (
                        <div key={iso} className={`border-t ${idx === 0 ? 'first:border-t-0' : ''}`}>
                          <DayHeader iso={iso} count={rows.length} state={state} />
                          <table className="w-full text-sm">
                            <thead className="text-slate-700">
                              <tr>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Customer</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Put‑in</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Take‑out</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Delivery (this day)</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Car</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Status</th>
                                <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">Risk</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={`${r.job.id}-${r.carIndex}`} className={`border-t ${
                                  r.risk.level === 'red' ? 'bg-red-50/40' : r.risk.level === 'orange' ? 'bg-orange-50/40' : ''
                                }`}>
                                  <td className="px-3 py-1">{r.job.customer}</td>
                                  <td className="px-3 py-1">{fmt(r.job.putIn)}</td>
                                  <td className="px-3 py-1">{fmt(r.job.takeOut)}</td>
                                  <td className="px-3 py-1">{fmt(r.deliveryISO)} {r.overflow && <span className="ml-2 text-amber-700 text-xs">⚠️ overflow</span>}</td>
                                  <td className="px-3 py-1">Car {r.carIndex + 1}</td>
                                  <td className="px-3 py-1">
                                    <span className={`px-2 py-1 rounded-full text-xs border ${
                                      r.job.status === 'Pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                      r.job.status === 'Accepted' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                      r.job.status === 'In Progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                      'bg-slate-50 text-slate-700 border-slate-200'}`}>{r.job.status}</span>
                                  </td>
                                  <td className="px-3 py-1"><RiskPill level={r.risk.level} label={r.risk.label} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Metrics card */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-semibold mb-3">Capacity & Warnings</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Cars to Move" value={String(metrics.totalCars)} />
                <Metric label="Van Drivers Needed" value={String(metrics.neededVanDrivers)} />
                <Metric label="Drivers Available" value={`${metrics.driverCapacity.available}/${metrics.driverCapacity.max}`} />
                <Metric
                  label="Status"
                  value={metrics.overbooked ? "⚠️ OVERBOOKED" : "OK"}
                  highlight={metrics.overbooked}
                />
              </div>
              <p className="text-xs text-slate-500 mt-3">Rule: 1 van driver whenever cars &gt; 0.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-semibold mb-2">Date Range</h4>
              <p className="text-sm text-slate-600">Showing deliveries between <b>{fmt(startISO)}</b> and <b>{fmt(endISO)}</b>.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-semibold mb-2">Escalating Alerts</h4>
              {(() => {
                const d1List = enriched.filter(r => r.risk.label.startsWith('Deliver Today'));
                const urgent = enriched.filter(r => r.risk.label === 'Urgent');

                return (
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="font-semibold">🔴 Critical</div>
                      {urgent.length === 0 ? (
                        <div className="text-slate-500 text-xs">No critical items.</div>
                      ) : (
                        <ul className="list-disc pl-4">
                          {urgent.map(r => (<li key={`u-${r.job.id}-${r.carIndex}`}>{r.job.customer} • Car {r.carIndex + 1} • Take‑out {fmt(r.job.takeOut)}</li>))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="font-semibold">🟠 Today (D‑1)</div>
                      {d1List.length === 0 ? (
                        <div className="text-slate-500 text-xs">No D‑1 deliveries pending.</div>
                      ) : (
                        <ul className="list-disc pl-4">
                          {d1List.map(r => (<li key={`d1-${r.job.id}-${r.carIndex}`}>{r.job.customer} • Car {r.carIndex + 1} • Delivery {fmt(r.deliveryISO)}</li>))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <h4 className="font-semibold mb-1">Reconciliation</h4>
              <p className="text-xs text-rose-800 mb-2">Every car must have a scheduled delivery. Any mismatch shows here.</p>
              {reconciliationIssues.length === 0 ? (
                <div className="text-xs text-rose-700">All jobs reconcile ✅</div>
              ) : (
                <ul className="text-sm list-disc pl-4 space-y-1">
                  {reconciliationIssues.map((x) => (
                    <li key={x.job.id}>{x.job.customer}: scheduled {x.scheduled}/{x.expected} cars</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="font-semibold mb-2">30‑Day Delivery Utilization</h4>
              <div className="grid grid-cols-10 gap-2 text-center">
                {util30.map((d) => (
                  <div key={d.iso} className={`rounded-lg p-2 border ${d.used > 7 ? "border-amber-400 bg-amber-50" : d.used === 7 ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="text-xs">{fmt(d.iso)}</div>
                    <div className="text-sm font-semibold">{d.used}/7</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Modal */}
        {open && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-xl p-6 shadow-xl border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">New Job</h3>
                <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-700">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Label>Route</Label>
                <select
                  className="col-span-1 rounded-xl border border-slate-300 p-2"
                  value={draft.route}
                  onChange={(e) => setDraft((d) => ({ ...d, route: e.target.value }))}
                >
                  {routes.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>

                <Label>Customer</Label>
                <input
                  className="rounded-xl border border-slate-300 p-2"
                  placeholder="e.g., Smith Party"
                  value={draft.customer}
                  onChange={(e) => setDraft((d) => ({ ...d, customer: e.target.value }))}
                />

                <Label>Put-in</Label>
                <input
                  type="date"
                  className="rounded-xl border border-slate-300 p-2"
                  value={draft.putIn}
                  onChange={(e) => setDraft((d) => ({ ...d, putIn: e.target.value }))}
                />

                <Label>Take-out</Label>
                <input
                  type="date"
                  className="rounded-xl border border-slate-300 p-2"
                  value={draft.takeOut}
                  onChange={(e) => setDraft((d) => ({ ...d, takeOut: e.target.value }))}
                />

                <Label>Cars</Label>
                <input
                  type="number"
                  min={0}
                  className="rounded-xl border border-slate-300 p-2"
                  value={draft.cars}
                  onChange={(e) => setDraft((d) => ({ ...d, cars: Number(e.target.value) }))}
                />

                <Label>Status</Label>
                <select
                  className="rounded-xl border border-slate-300 p-2"
                  value={draft.status}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Job["status"] }))}
                >
                  <option>Pending</option>
                  <option>Accepted</option>
                  <option>In Progress</option>
                  <option>Completed</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={addJob}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Save Job
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="pt-4 text-center text-xs text-slate-500">
          Built for speed: refactor to Supabase later; ship value now.
        </footer>
      </div>
    </div>
  );
}

// ---------- Small UI bits ----------
function RangeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`text-sm rounded-xl px-3 py-2 border ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 hover:border-slate-400"}`}>{label}</button>
  );
}

function DayHeader({ iso, count, state }: { iso: string; count: number; state: 'good'|'today'|'urgent' }) {
  const color = state === 'urgent' ? 'bg-red-50 border-red-200 text-red-800'
    : state === 'today' ? 'bg-orange-50 border-orange-200 text-orange-800'
    : 'bg-emerald-50 border-emerald-200 text-emerald-800';
  const label = state === 'urgent' ? 'URGENT' : state === 'today' ? 'DELIVER TODAY' : 'ALL GOOD';
  return (
    <div className={`px-4 py-2 flex items-center justify-between border ${color}`}>
      <div className="font-semibold text-sm">{fmt(iso)} — Deliveries</div>
      <div className="text-xs font-semibold">{count} cars • {label}</div>
    </div>
  );
}

function RiskPill({ level, label }: { level: 'red'|'orange'|'green'; label: string }) {
  const cls = level === 'red' ? 'bg-red-50 text-red-700 border-red-200'
    : level === 'orange' ? 'bg-orange-50 text-orange-700 border-orange-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return <span className={`px-2 py-1 rounded-full text-xs border ${cls}`}>{label}</span>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-slate-700 self-center">{children}</label>;
}
function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
