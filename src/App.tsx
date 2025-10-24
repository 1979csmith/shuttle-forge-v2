import React, { useMemo, useState } from "react";

// ---- ShuttleForge MVP v0.1 (pure React + Tailwind) ----
// Single-file, deploy-ready mock with local state only.
// Goals: show the core flow (route -> overview -> jobs list -> capacity math)
// You can drop this into any Next.js/React project or run in CodeSandbox.

// ---------- Types ----------
type Job = {
  id: string;
  route: string; // e.g., "Main Salmon", "Middle Fork"
  putIn: string; // ISO date
  takeOut: string; // ISO date
  cars: number;
  customer: string;
  status: "Pending" | "Accepted" | "In Progress" | "Completed";
};

// ---------- Seed Data ----------
const seedJobs: Job[] = [
  {
    id: "J-1001",
    route: "Main Salmon",
    putIn: "2025-11-01",
    takeOut: "2025-11-04",
    cars: 3,
    customer: "Johnson Party",
    status: "Accepted",
  },
  {
    id: "J-1002",
    route: "Main Salmon",
    putIn: "2025-11-02",
    takeOut: "2025-11-05",
    cars: 2,
    customer: "Wilson Crew",
    status: "Pending",
  },
  {
    id: "J-1003",
    route: "Middle Fork",
    putIn: "2025-11-03",
    takeOut: "2025-11-06",
    cars: 5,
    customer: "Hernandez Group",
    status: "Accepted",
  },
  {
    id: "J-1004",
    route: "Middle Fork",
    putIn: "2025-11-10",
    takeOut: "2025-11-13",
    cars: 1,
    customer: "Green Family",
    status: "Pending",
  },
];

// ---------- Helpers ----------
function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function withinRange(job: Job, startISO: string, endISO: string) {
  return job.putIn >= startISO && job.putIn < endISO;
}

function vanDriversNeeded(totalCars: number) {
  // Per your rule: always 1 van driver if there are cars to move
  return totalCars > 0 ? 1 : 0;
}

// ---------- UI ----------
export default function ShuttleForgeMVP() {
  const [jobs, setJobs] = useState<Job[]>(seedJobs);
  const [selectedRoute, setSelectedRoute] = useState<string | null>("Main Salmon");
  const [range, setRange] = useState<"3d" | "7d" | "30d">("7d");

  const startISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const endISO = useMemo(() => {
    const map: Record<typeof range, number> = { "3d": 3, "7d": 7, "30d": 30 } as const;
    return daysFromNow(map[range]);
  }, [range]);

  const routes = useMemo(() => {
    const set = new Set(jobs.map((j) => j.route));
    return Array.from(set);
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const filtered = jobs.filter((j) => withinRange(j, startISO, endISO));
    return selectedRoute ? filtered.filter((j) => j.route === selectedRoute) : filtered;
  }, [jobs, startISO, endISO, selectedRoute]);

  const metrics = useMemo(() => {
    const totalCars = visibleJobs.reduce((sum, j) => sum + j.cars, 0);
    const driverCapacity = { available: 6, max: 8 }; // demo values
    const neededVanDrivers = vanDriversNeeded(totalCars);
    const overbooked = totalCars > driverCapacity.available; // simple demo rule
    return { totalCars, driverCapacity, neededVanDrivers, overbooked };
  }, [visibleJobs]);

  // ---- Add Job (simple inline form) ----
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Job>({
    id: "",
    route: selectedRoute || "Main Salmon",
    putIn: startISO,
    takeOut: daysFromNow(3),
    cars: 1,
    customer: "",
    status: "Pending",
  });

  function addJob() {
    if (!draft.customer) return;
    const id = `J-${Math.floor(1000 + Math.random() * 9000)}`;
    setJobs((prev) => [...prev, { ...draft, id }]);
    setOpen(false);
    // reset
    setDraft({
      id: "",
      route: selectedRoute || "Main Salmon",
      putIn: startISO,
      takeOut: daysFromNow(3),
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
            <p className="text-sm text-slate-600">Ultra-lean MVP • Local data only • Ready to demo</p>
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

            {/* Jobs list */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <Th>Job</Th>
                    <Th>Customer</Th>
                    <Th>Put-in</Th>
                    <Th>Take-out</Th>
                    <Th>Cars</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-slate-500">No jobs in range.</td>
                    </tr>
                  )}
                  {visibleJobs.map((j) => (
                    <tr key={j.id} className="border-t">
                      <Td>{j.id}</Td>
                      <Td>{j.customer}</Td>
                      <Td>{fmt(j.putIn)}</Td>
                      <Td>{fmt(j.takeOut)}</Td>
                      <Td>{j.cars}</Td>
                      <Td>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          j.status === "Pending"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : j.status === "Accepted"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : j.status === "In Progress"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-slate-50 text-slate-700 border border-slate-200"
                        }`}>{j.status}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <p className="text-sm text-slate-600">Showing jobs with put-in between <b>{fmt(startISO)}</b> and <b>{fmt(endISO)}</b>.</p>
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
    <button
      onClick={onClick}
      className={`text-sm rounded-xl px-3 py-2 border transition ${
        active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-semibold px-3 py-2 border-t border-b border-slate-200">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>;
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
