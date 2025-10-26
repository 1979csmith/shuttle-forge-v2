import { useState } from "react";

type Car = {
  id: string;
  owner: string;
  makeModel: string;
  plate: string;
  notes?: string;
};

type Leg = {
  title: string;
  code: "A" | "B";
  startLocation: string;
  endLocation: string;
  date: string;
  targetDepart: string;
  targetArrive: string;
  cars: Car[];
};

type RouteMeta = {
  routeName: string;
  tripDate: string;
  launchSite: string;
  handoffHub: string;
  takeOut: string;
  dispatcher: string;
};

function addDaysISO(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenISO(a: string, b: string) {
  const A = new Date(a + "T00:00:00");
  const B = new Date(b + "T00:00:00");
  return Math.round((+B - +A) / (1000 * 60 * 60 * 24));
}

function ScheduleTable({ leg }: { leg: Leg }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold">Cars to Move ({leg.cars.length})</h4>
        <div className="text-xs text-slate-600">{leg.startLocation} → {leg.endLocation}</div>
      </div>
      <div className="overflow-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-3 py-2">Car</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plate</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {leg.cars.map((car) => (
              <tr key={car.id} className="border-t">
                <td className="px-3 py-2">{car.makeModel}</td>
                <td className="px-3 py-2">{car.owner}</td>
                <td className="px-3 py-2">{car.plate}</td>
                <td className="px-3 py-2">{leg.date} • {leg.targetDepart}</td>
                <td className="px-3 py-2">{leg.date} • {leg.targetArrive}</td>
                <td className="px-3 py-2 text-slate-600">{car.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LegCard({ leg, onDateChange, minTwoDayOK }: { 
  leg: Leg; 
  onDateChange: (newDate: string) => void;
  minTwoDayOK: boolean;
}) {
  const bgColor = leg.code === "A" ? "bg-blue-50" : "bg-green-50";
  const borderColor = leg.code === "A" ? "border-blue-200" : "border-green-200";
  
  return (
    <div className={`rounded-2xl border-2 ${borderColor} shadow-sm bg-white p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
          leg.code === 'A' ? 'bg-blue-100 text-blue-700 border-2 border-blue-300' : 'bg-green-100 text-green-700 border-2 border-green-300'
        }`}>
          LEG {leg.code}
        </span>
        <h2 className="text-lg font-semibold">{leg.title}</h2>
      </div>
      
      <div className={`${bgColor} rounded-xl p-3 mb-3`}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">Route</div>
            <div className="font-medium">{leg.startLocation}</div>
            <div className="text-slate-600">↓</div>
            <div className="font-medium">{leg.endLocation}</div>
          </div>
          <div className="text-sm text-slate-700">
            <div className="mb-2">
              <span className="text-xs text-slate-600">Date:</span>
              <input
                type="date"
                value={leg.date}
                className="ml-2 border rounded px-2 py-1 text-sm"
                onChange={(e) => onDateChange(e.target.value)}
              />
            </div>
            <div><span className="text-xs text-slate-600">Depart:</span> <strong>{leg.targetDepart}</strong></div>
            <div><span className="text-xs text-slate-600">Arrive:</span> <strong>{leg.targetArrive}</strong></div>
          </div>
        </div>
      </div>

      {/* Violation notice on Leg B */}
      {leg.code === "B" && !minTwoDayOK && (
        <div className="mb-3 p-2 bg-red-50 text-red-800 border border-red-200 rounded-lg text-sm">
          ⚠️ Leg B must be at least the next day after Leg A (minimum 2-day process).
        </div>
      )}

      {/* Cars + per-leg schedule */}
      <ScheduleTable leg={leg} />
    </div>
  );
}

function CombinedSchedule({ legA, legB }: { legA: Leg; legB: Leg }) {
  const rows = [
    ...legA.cars.map((car) => ({
      id: car.id + "-A",
      date: legA.date,
      start: `${legA.date} • ${legA.targetDepart}`,
      end: `${legA.date} • ${legA.targetArrive}`,
      segment: "Leg A",
      from: legA.startLocation,
      to: legA.endLocation,
      owner: car.owner,
      plate: car.plate,
      vehicle: car.makeModel,
    })),
    ...legB.cars.map((car) => ({
      id: car.id + "-B",
      date: legB.date,
      start: `${legB.date} • ${legB.targetDepart}`,
      end: `${legB.date} • ${legB.targetArrive}`,
      segment: "Leg B",
      from: legB.startLocation,
      to: legB.endLocation,
      owner: car.owner,
      plate: car.plate,
      vehicle: car.makeModel,
    })),
  ];

  // sort by date then start time
  rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  return (
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="text-lg font-semibold mb-2">Shuttle Schedule (All Legs)</h3>
      <div className="overflow-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-3 py-2">Segment</th>
              <th className="px-3 py-2">From → To</th>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plate</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    r.segment === 'Leg A' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {r.segment}
                  </span>
                </td>
                <td className="px-3 py-2">{r.from} → {r.to}</td>
                <td className="px-3 py-2">{r.vehicle}</td>
                <td className="px-3 py-2">{r.owner}</td>
                <td className="px-3 py-2">{r.plate}</td>
                <td className="px-3 py-2">{r.start}</td>
                <td className="px-3 py-2">{r.end}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TwoLegView({ onBack }: { onBack: () => void }) {
  const [routeMeta] = useState<RouteMeta>({
    routeName: "Main Salmon",
    tripDate: "2025-07-14",
    launchSite: "Corn Creek (Launch)",
    handoffHub: "Stanley Shuttle Yard",
    takeOut: "Hammer Creek (Take-out)",
    dispatcher: "Chris S.",
  });

  // Cars scheduled for this trip
  const cars: Car[] = [
    { id: "c1", owner: "Johnson", makeModel: "Toyota 4Runner", plate: "ID 7S-1234", notes: "Key in lockbox #41" },
    { id: "c2", owner: "Miller", makeModel: "Subaru Outback", plate: "UT K9X-22A" },
    { id: "c3", owner: "Nguyen", makeModel: "Ford F-150", plate: "CA 8TRP921", notes: "Bed rack" },
    { id: "c4", owner: "Lopez", makeModel: "Jeep Grand Cherokee", plate: "ID 3A-009X" },
    { id: "c5", owner: "Patel", makeModel: "Ram 1500", plate: "WA C56789B", notes: "Covered parking at take-out" },
  ];

  const [legA, setLegA] = useState<Leg>({
    title: "Launch ➝ Stanley",
    code: "A",
    startLocation: routeMeta.launchSite,
    endLocation: routeMeta.handoffHub,
    date: routeMeta.tripDate,
    targetDepart: "07:30",
    targetArrive: "10:45",
    cars,
  });

  const [legB, setLegB] = useState<Leg>({
    title: "Stanley ➝ Take-out",
    code: "B",
    startLocation: routeMeta.handoffHub,
    endLocation: routeMeta.takeOut,
    date: addDaysISO(routeMeta.tripDate, 1),
    targetDepart: "11:15",
    targetArrive: "16:40",
    cars,
  });

  const minTwoDayOK = daysBetweenISO(legA.date, legB.date) >= 1;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button 
              onClick={onBack}
              className="px-3 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm"
            >
              ← Back to Dispatch
            </button>
            <h1 className="text-2xl font-bold">Main Salmon Two‑Leg Shuttle</h1>
          </div>
          <div className="text-slate-700 mt-1">
            <span className="font-medium">Route:</span> {routeMeta.routeName} • <span className="font-medium">Trip Date:</span> {routeMeta.tripDate}
          </div>
          <div className="text-slate-600 text-sm">Dispatcher: {routeMeta.dispatcher}</div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            disabled={!minTwoDayOK} 
            className={`px-3 py-2 rounded-xl border shadow-sm text-sm ${!minTwoDayOK ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
          >
            Export Day Plan
          </button>
          <button className="px-3 py-2 rounded-xl border shadow-sm text-sm hover:bg-slate-50">
            Sync to TripForge
          </button>
        </div>
      </div>

      {/* Leg cards side-by-side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <LegCard 
          leg={legA} 
          onDateChange={(newDate) => setLegA({ ...legA, date: newDate })}
          minTwoDayOK={minTwoDayOK}
        />
        <LegCard 
          leg={legB} 
          onDateChange={(newDate) => setLegB({ ...legB, date: newDate })}
          minTwoDayOK={minTwoDayOK}
        />
      </div>

      {/* Combined schedule */}
      <CombinedSchedule legA={legA} legB={legB} />

      {/* Policy banner */}
      {!minTwoDayOK && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold mb-1">⚠️ Minimum 2‑day process required</div>
          Set Leg B to at least the next calendar day after Leg A. Export is disabled until fixed.
        </div>
      )}
    </div>
  );
}

