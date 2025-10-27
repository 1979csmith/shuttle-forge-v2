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
  tripPutIn: string;   // Launch date (ISO)
  tripTakeOut: string; // Take-out date (ISO)
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
      // Oct 26 take-out - Leg B deliveries on Oct 25 (D-1)
      {
        id: "J-1001",
        car: { owner: "Anderson", makeModel: "Toyota 4Runner", plate: "ID-7S1234", year: 2019, color: "Silver" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-21", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1002",
        car: { owner: "Bennett", makeModel: "Subaru Outback", plate: "WA-K9X22A", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-21", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1003",
        car: { owner: "Chen", makeModel: "Ford F-150", plate: "OR-8TRP921", year: 2018, color: "Red" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-21", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1004",
        car: { owner: "Davis", makeModel: "Jeep Wrangler", plate: "ID-3A009X", year: 2021, color: "Green" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1005",
        car: { owner: "Evans", makeModel: "Ram 1500", plate: "MT-C56789B", year: 2019, color: "Black" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1006",
        car: { owner: "Foster", makeModel: "Chevy Silverado", plate: "WY-D12345C", year: 2022, color: "White" },
        tripPutIn: "2025-10-20",
        tripTakeOut: "2025-10-26",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-25", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },

      // Oct 28 - Leg A moves (7 cars)
      {
        id: "J-1007",
        car: { owner: "Garcia", makeModel: "Toyota Tacoma", plate: "ID-E67890D", year: 2020, color: "Gray" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1008",
        car: { owner: "Harris", makeModel: "Honda Pilot", plate: "OR-F78901E", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1009",
        car: { owner: "Ingram", makeModel: "GMC Sierra", plate: "WA-G89012F", year: 2019, color: "Blue" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1010",
        car: { owner: "Jackson", makeModel: "Nissan Frontier", plate: "MT-H90123G", year: 2020, color: "Red" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1011",
        car: { owner: "Kim", makeModel: "Ford Ranger", plate: "ID-I01234H", year: 2022, color: "Orange" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1012",
        car: { owner: "Lopez", makeModel: "Jeep Gladiator", plate: "OR-J12345I", year: 2021, color: "Yellow" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1013",
        car: { owner: "Martinez", makeModel: "Toyota Tundra", plate: "WA-K23456J", year: 2020, color: "Black" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-28",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-23", depart: "08:45", arrive: "12:15", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-27", depart: "12:45", arrive: "18:15", driverId: "D2" },
        ],
      },

      // Oct 30 - Leg A moves (8 cars)
      {
        id: "J-1014",
        car: { owner: "Nelson", makeModel: "Chevy Colorado", plate: "MT-L34567K", year: 2019, color: "White" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1015",
        car: { owner: "O'Brien", makeModel: "Ford Explorer", plate: "ID-M45678L", year: 2021, color: "Gray" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1016",
        car: { owner: "Parker", makeModel: "Ram 2500", plate: "OR-N56789M", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1017",
        car: { owner: "Quinn", makeModel: "Subaru Forester", plate: "WA-O67890N", year: 2022, color: "Green" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1018",
        car: { owner: "Roberts", makeModel: "Jeep Cherokee", plate: "MT-P78901O", year: 2019, color: "Red" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1019",
        car: { owner: "Smith", makeModel: "Toyota Highlander", plate: "ID-Q89012P", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1020",
        car: { owner: "Taylor", makeModel: "GMC Yukon", plate: "OR-R90123Q", year: 2020, color: "Black" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "08:45", arrive: "12:15", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "12:45", arrive: "18:15", driverId: "D2" },
        ],
      },
      {
        id: "J-1021",
        car: { owner: "Underwood", makeModel: "Ford Expedition", plate: "WA-S01234R", year: 2022, color: "White" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-30",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-25", depart: "09:00", arrive: "12:30", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-29", depart: "13:00", arrive: "18:30", driverId: "D3" },
        ],
      },

      // Oct 27 - Leg A moves (5 cars) - FILL GAP
      {
        id: "J-1028",
        car: { owner: "Blake", makeModel: "Toyota Sequoia", plate: "ID-A12345A", year: 2020, color: "White" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-27",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1029",
        car: { owner: "Cole", makeModel: "Chevy Suburban", plate: "MT-B23456B", year: 2021, color: "Black" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-27",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1030",
        car: { owner: "Drake", makeModel: "Ford Bronco Sport", plate: "OR-C34567C", year: 2022, color: "Orange" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-27",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1031",
        car: { owner: "Ellis", makeModel: "Nissan Armada", plate: "WA-D45678D", year: 2019, color: "Blue" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-27",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1032",
        car: { owner: "Flynn", makeModel: "GMC Yukon XL", plate: "ID-E56789E", year: 2020, color: "Silver" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-27",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-22", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-26", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },

      // Oct 29 - Leg A moves (6 cars) - FILL GAP
      {
        id: "J-1033",
        car: { owner: "Grant", makeModel: "Jeep Grand Wagoneer", plate: "MT-F67890F", year: 2023, color: "Gray" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1034",
        car: { owner: "Hayes", makeModel: "Toyota Land Cruiser", plate: "OR-G78901G", year: 2021, color: "White" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1035",
        car: { owner: "Irwin", makeModel: "Lexus LX", plate: "WA-H89012H", year: 2022, color: "Black" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1036",
        car: { owner: "James", makeModel: "Ford Expedition Max", plate: "ID-I90123I", year: 2020, color: "Red" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1037",
        car: { owner: "Kelly", makeModel: "Cadillac Escalade", plate: "MT-J01234J", year: 2021, color: "Pearl" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1038",
        car: { owner: "Lewis", makeModel: "Lincoln Aviator", plate: "OR-K12345K", year: 2022, color: "Blue" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-29",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-24", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-28", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },

      // Nov 1 - Leg A moves (6 cars)
      {
        id: "J-1022",
        car: { owner: "Valdez", makeModel: "Chevy Tahoe", plate: "MT-T12345S", year: 2019, color: "Gray" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1023",
        car: { owner: "Watson", makeModel: "Nissan Pathfinder", plate: "ID-U23456T", year: 2021, color: "Blue" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1024",
        car: { owner: "Xavier", makeModel: "Honda CR-V", plate: "OR-V34567U", year: 2020, color: "Red" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1025",
        car: { owner: "Young", makeModel: "Mazda CX-5", plate: "WA-W45678V", year: 2022, color: "Silver" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1026",
        car: { owner: "Zhang", makeModel: "Hyundai Santa Fe", plate: "MT-X56789W", year: 2019, color: "Green" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1027",
        car: { owner: "Adams", makeModel: "Kia Sorento", plate: "ID-Y67890X", year: 2021, color: "Black" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },
    ],
  },
  middle_fork: {
    currentDate: TODAY,
    drivers: DEMO_DRIVERS,
    jobs: [
      // Oct 26 - 5 single-leg moves
      {
        id: "MF-101",
        car: { owner: "Baker", makeModel: "Jeep Grand Cherokee", plate: "ID-3A009X", year: 2020, color: "White" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-26",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-25", depart: "07:15", arrive: "12:30", driverId: "D1" },
        ],
      },
      {
        id: "MF-102",
        car: { owner: "Carter", makeModel: "Toyota 4Runner", plate: "MT-4B110Y", year: 2019, color: "Silver" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-26",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-25", depart: "07:30", arrive: "12:45", driverId: "D2" },
        ],
      },
      {
        id: "MF-103",
        car: { owner: "Diaz", makeModel: "Ford Bronco", plate: "OR-5C221Z", year: 2021, color: "Blue" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-26",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-25", depart: "08:00", arrive: "13:15", driverId: "D3" },
        ],
      },
      {
        id: "MF-104",
        car: { owner: "Ellis", makeModel: "Chevy Blazer", plate: "WA-6D332A", year: 2020, color: "Red" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-26",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-25", depart: "08:15", arrive: "13:30", driverId: "D1" },
        ],
      },
      {
        id: "MF-105",
        car: { owner: "Fisher", makeModel: "GMC Acadia", plate: "ID-7E443B", year: 2022, color: "Gray" },
        tripPutIn: "2025-10-21",
        tripTakeOut: "2025-10-26",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-25", depart: "08:30", arrive: "13:45", driverId: "D2" },
        ],
      },

      // Oct 27 - 6 single-leg moves
      {
        id: "MF-106",
        car: { owner: "Grant", makeModel: "Subaru Ascent", plate: "MT-8F554C", year: 2021, color: "Green" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-107",
        car: { owner: "Hayes", makeModel: "Honda Passport", plate: "OR-9G665D", year: 2020, color: "Black" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-108",
        car: { owner: "Irwin", makeModel: "Nissan Armada", plate: "WA-0H776E", year: 2019, color: "White" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-109",
        car: { owner: "James", makeModel: "Toyota Sequoia", plate: "ID-1I887F", year: 2022, color: "Silver" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-110",
        car: { owner: "Kelly", makeModel: "Ford Edge", plate: "MT-2J998G", year: 2021, color: "Blue" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-111",
        car: { owner: "Lewis", makeModel: "Chevy Traverse", plate: "OR-3K009H", year: 2020, color: "Red" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-26", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },

      // Oct 28 - 7 single-leg moves
      {
        id: "MF-112",
        car: { owner: "Morgan", makeModel: "Jeep Compass", plate: "WA-4L110I", year: 2019, color: "Gray" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-113",
        car: { owner: "Nash", makeModel: "Ram ProMaster", plate: "ID-5M221J", year: 2021, color: "White" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-114",
        car: { owner: "Owen", makeModel: "Toyota Land Cruiser", plate: "MT-6N332K", year: 2020, color: "Black" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-115",
        car: { owner: "Price", makeModel: "Subaru Crosstrek", plate: "OR-7O443L", year: 2022, color: "Orange" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-116",
        car: { owner: "Reed", makeModel: "Honda Ridgeline", plate: "WA-8P554M", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-117",
        car: { owner: "Scott", makeModel: "GMC Terrain", plate: "ID-9Q665N", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-118",
        car: { owner: "Turner", makeModel: "Mazda CX-9", plate: "MT-0R776O", year: 2019, color: "Green" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },

      // Oct 29 - 8 single-leg moves
      {
        id: "MF-119",
        car: { owner: "Upton", makeModel: "Volkswagen Atlas", plate: "OR-1S887P", year: 2021, color: "Red" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-120",
        car: { owner: "Vega", makeModel: "Buick Enclave", plate: "WA-2T998Q", year: 2020, color: "Gray" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-121",
        car: { owner: "Ward", makeModel: "Cadillac XT5", plate: "ID-3U009R", year: 2022, color: "Black" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-122",
        car: { owner: "York", makeModel: "Lincoln Navigator", plate: "MT-4V110S", year: 2021, color: "White" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-123",
        car: { owner: "Zimmerman", makeModel: "Acura MDX", plate: "OR-5W221T", year: 2020, color: "Silver" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-124",
        car: { owner: "Allen", makeModel: "Infiniti QX80", plate: "WA-6X332U", year: 2019, color: "Blue" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-125",
        car: { owner: "Brooks", makeModel: "Lexus GX", plate: "ID-7Y443V", year: 2021, color: "Green" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },
      {
        id: "MF-126",
        car: { owner: "Cooper", makeModel: "Land Rover Discovery", plate: "MT-8Z554W", year: 2022, color: "Red" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "09:00", arrive: "14:15", driverId: "D2" },
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
  const [draggedItem, setDraggedItem] = useState<{ job: Job; legIndex: number } | null>(null);
  const [dropWarning, setDropWarning] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans space-y-6">
      {/* Drop Warning */}
      {dropWarning && (
        <div className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-amber-900 mb-1">⚠️ Confirm Move</div>
              <div className="text-sm text-amber-800">{dropWarning}</div>
            </div>
            <button
              onClick={() => setDropWarning(null)}
              className="text-amber-600 hover:text-amber-800 font-bold"
            >✕</button>
          </div>
        </div>
      )}

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
          {mode === 'calendar' && (
            <CalendarView
              jobs={jobs}
              currentDate={currentDate}
              onSelectJob={setSelectedJob}
              draggedItem={draggedItem}
              onDragStart={setDraggedItem}
              onDragEnd={() => setDraggedItem(null)}
              onDropWarning={setDropWarning}
            />
          )}
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
  const [daysAhead, setDaysAhead] = useState<number>(7);

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

  // Filter jobs based on days ahead
  const filteredJobs = useMemo(() => {
    const cutoffDate = addDaysISO(currentDate, daysAhead);
    return jobs.filter(job => {
      // Check if any leg is within the date range
      return job.legs.some(leg => leg.date >= currentDate && leg.date <= cutoffDate);
    });
  }, [jobs, currentDate, daysAhead]);

  // Group jobs by their earliest leg date
  const jobsByDate = useMemo(() => {
    const grouped = new Map<string, Job[]>();
    
    for (const job of filteredJobs) {
      // Find earliest leg date for this job
      const earliestDate = job.legs.reduce((earliest, leg) => {
        return leg.date < earliest ? leg.date : earliest;
      }, job.legs[0].date);
      
      if (!grouped.has(earliestDate)) {
        grouped.set(earliestDate, []);
      }
      grouped.get(earliestDate)!.push(job);
    }
    
    // Sort dates
    const sortedDates = Array.from(grouped.keys()).sort();
    return sortedDates.map(date => ({
      date,
      jobs: grouped.get(date)!
    }));
  }, [filteredJobs]);

  return (
    <div className="space-y-3">
      {/* Filter Controls */}
      <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200">
        <div className="text-sm font-medium text-slate-700">
          Showing {filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="days-filter" className="text-sm text-slate-600">Show next:</label>
          <select
            id="days-filter"
            value={daysAhead}
            onChange={(e) => setDaysAhead(Number(e.target.value))}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>
      
      {/* Jobs grouped by date */}
      {jobsByDate.map(({ date, jobs: dateJobs }) => {
        const isToday = date === currentDate;
        const dateObj = new Date(date + 'T00:00:00');
        const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'long' });
        const dateStr = dateObj.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        
        return (
          <div key={date} className="space-y-3">
            {/* Date Header */}
            <div className={`sticky top-0 z-10 px-4 py-3 rounded-xl border-2 ${
              isToday 
                ? 'bg-blue-100 border-blue-400 text-blue-900' 
                : 'bg-slate-100 border-slate-300 text-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-lg">{dayName}</div>
                  <div className="text-sm">{dateStr}</div>
                </div>
                <div className="text-sm font-semibold">
                  {dateJobs.length} {dateJobs.length === 1 ? 'job' : 'jobs'}
                  {isToday && <span className="ml-2 px-2 py-1 rounded-full bg-blue-600 text-white text-xs">TODAY</span>}
                </div>
              </div>
            </div>
            
            {/* Jobs for this date */}
            {dateJobs.map(job => {
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
                {/* Job Number & Trip Dates */}
                <div className="text-sm text-slate-600 space-y-1">
                  <div>Job #: <span className="font-mono font-medium">{jobNumber(job)}</span></div>
                  <div className="text-xs">
                    <span className="font-medium">Launch:</span> {formatMMDDYY(job.tripPutIn)} 
                    <span className="mx-2">•</span>
                    <span className="font-medium">Take-out:</span> {formatMMDDYY(job.tripTakeOut)}
                  </div>
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

/** Handle drop validation and warnings */
function handleDrop(
  targetDate: string,
  draggedItem: { job: Job; legIndex: number },
  onDropWarning: (warning: string | null) => void,
  onDragEnd: () => void
) {
  const { job, legIndex } = draggedItem;
  const leg = job.legs[legIndex];
  const isLegB = leg.leg === "B";
  const isLegA = leg.leg === "A";
  
  // Rule 1: Leg B must be at take-out by D-1
  if (isLegB) {
    const takeOutDate = job.tripTakeOut;
    const daysBefore = daysBetween(targetDate, takeOutDate);
    if (daysBefore < 1) {
      onDropWarning(`❌ Cannot move Leg B to ${formatMMDDYY(targetDate)}. Car must arrive at take-out by ${formatMMDDYY(addDaysISO(takeOutDate, -1))} (day before trip ends on ${formatMMDDYY(takeOutDate)}).`);
      onDragEnd();
      return;
    }
  }
  
  // Rule 2: If moving from put-in day, warn to contact trip owner
  if (isLegA) {
    const putInDate = job.tripPutIn;
    if (leg.date === putInDate && targetDate !== putInDate) {
      onDropWarning(`⚠️ Moving ${job.car.owner}'s car from launch day (${formatMMDDYY(putInDate)}). Please contact trip owner to confirm car can be picked up on ${formatMMDDYY(targetDate)} instead.`);
      // Allow the move but show warning
    }
  }
  
  // TODO: Actually update the job date here
  console.log(`Move ${job.id} Leg ${leg.leg || "single"} to ${targetDate}`);
  onDragEnd();
}

/** Calendar grid (7 columns x N weeks). Cards render on their leg date(s) */
function CalendarView({ jobs, currentDate, onSelectJob, draggedItem, onDragStart, onDragEnd, onDropWarning }: {
  jobs: Job[];
  currentDate: string;
  onSelectJob: (job: Job) => void;
  draggedItem: { job: Job; legIndex: number } | null;
  onDragStart: (item: { job: Job; legIndex: number }) => void;
  onDragEnd: () => void;
  onDropWarning: (warning: string | null) => void;
}) {
  // Show a 3-week window centered around current week for dispatching
  const weekStart = startOfWeek(currentDate);            // Sunday
  const gridStart = addDaysISO(weekStart, -7);           // one week before
  const allDays = daysArray(gridStart, 21);              // 3 weeks

  // bucket jobs by day - show a card for EACH leg on its scheduled day
  const byDay = useMemo(() => {
    const map = new Map<string, Array<{ job: Job; legIndex: number }>>();
    for (const day of allDays) map.set(day, []);
    for (const job of jobs) {
      job.legs.forEach((leg, idx) => {
        if (map.has(leg.date)) {
          map.get(leg.date)!.push({ job, legIndex: idx });
        }
      });
    }
    return map;
  }, [jobs, allDays]);

  // Calculate capacity per day
  const capacityByDay = useMemo(() => {
    const map = new Map<string, { used: number; total: number }>();
    const TOTAL_DRIVERS = 8; // Max shuttle driver capacity
    
    for (const day of allDays) {
      // Count legs scheduled for this day
      let used = 0;
      for (const job of jobs) {
        for (const leg of job.legs) {
          if (leg.date === day) used++;
        }
      }
      map.set(day, { used, total: TOTAL_DRIVERS });
    }
    return map;
  }, [allDays, jobs]);

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
          const capacity = capacityByDay.get(dayISO) || { used: 0, total: 8 };
          const available = capacity.total - capacity.used;
          const isOverbooked = capacity.used > capacity.total;
          
          return (
            <div key={dayISO} className={`bg-white p-2 min-h-[140px] ${isToday ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-medium ${isToday ? 'text-blue-600 font-bold' : 'text-slate-600'}`}>
                  {dayNum}
                  {isToday && <span className="ml-1 text-[10px]">Today</span>}
                </div>
                <div className={`text-[10px] font-semibold ${
                  isOverbooked ? 'text-red-600' : 
                  available === 0 ? 'text-amber-600' : 
                  'text-slate-500'
                }`}>
                  {capacity.used}/{capacity.total}
                </div>
              </div>

              {/* Vehicle cards for this day */}
              <div className="space-y-1">
                {(byDay.get(dayISO) || []).map(({ job, legIndex }) => (
                  <VehicleCard
                    key={`${job.id}-leg${legIndex}`}
                    job={job}
                    legIndex={legIndex}
                    currentDate={currentDate}
                    onClick={() => onSelectJob(job)}
                    onDragStart={() => onDragStart({ job, legIndex })}
                    onDragEnd={onDragEnd}
                    isDragging={draggedItem?.job.id === job.id && draggedItem?.legIndex === legIndex}
                  />
                ))}
                
                {/* Empty slots for available drivers - color-coded by leg type */}
                {available > 0 && (() => {
                  // Show empty slots (up to 3 visible)
                  const slots = [];
                  const maxVisible = Math.min(available, 3);
                  
                  for (let i = 0; i < maxVisible; i++) {
                    // Alternate between Leg A (blue) and Leg B (purple) slots, with gray for single-leg
                    const slotType = i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "single";
                    const bgColor = slotType === "A" ? "bg-blue-50/50 border-blue-300" :
                                    slotType === "B" ? "bg-purple-50/50 border-purple-300" :
                                    "bg-slate-50/50 border-slate-300";
                    
                    slots.push(
                      <div
                        key={`empty-${i}`}
                        className={`w-full h-6 rounded border border-dashed ${bgColor} flex items-center justify-center text-[9px] text-slate-400`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('ring-2', 'ring-blue-400');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('ring-2', 'ring-blue-400');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('ring-2', 'ring-blue-400');
                          if (draggedItem) {
                            handleDrop(dayISO, draggedItem, onDropWarning, onDragEnd);
                          }
                        }}
                      >
                        {slotType === "A" && "A"}
                        {slotType === "B" && "B"}
                      </div>
                    );
                  }
                  return slots;
                })()}
                {available > 3 && (
                  <div className="text-[9px] text-center text-slate-400">
                    +{available - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Vehicle Card (calendar cell) ---------------- */

function VehicleCard({ job, legIndex, currentDate, onClick, onDragStart, onDragEnd, isDragging }: {
  job: Job;
  legIndex: number;
  currentDate: string;
  onClick: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const leg = job.legs[legIndex];
  const days = daysBetween(currentDate, leg.date);
  const label = days <= 0 ? "Due" : (days + "d");

  // Color-code by leg for Main Salmon two-leg jobs
  const isLegA = leg.leg === "A";
  const isLegB = leg.leg === "B";
  
  // Always use leg colors for two-leg jobs, use slate for single-leg
  let legColorCls = "";
  if (isLegA) {
    legColorCls = "bg-blue-100 text-blue-900 border-blue-400";
  } else if (isLegB) {
    legColorCls = "bg-purple-100 text-purple-900 border-purple-400";
  } else {
    legColorCls = "bg-slate-100 text-slate-900 border-slate-400";
  }
  
  // Add urgency border styling
  const isUrgent = days <= 0;
  const isWarning = days > 0 && days <= 3;
  if (isUrgent) {
    legColorCls = legColorCls.replace(/border-\w+-\d+/, "border-red-600 border-2");
  } else if (isWarning) {
    legColorCls = legColorCls.replace(/border-\w+-\d+/, "border-amber-500 border-2");
  }

  return (
    <button
      onClick={onClick}
      draggable={!!onDragStart}
      onDragStart={(e) => {
        if (onDragStart) {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }
      }}
      onDragEnd={onDragEnd}
      className={`w-full text-left rounded-lg border ${legColorCls} px-2 py-1.5 hover:shadow transition text-xs cursor-move ${
        isDragging ? 'opacity-50 scale-95' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="font-semibold truncate text-xs">
          {jobNumber(job)}
          {isLegA && <span className="ml-1 text-[9px] font-bold text-blue-700">A</span>}
          {isLegB && <span className="ml-1 text-[9px] font-bold text-purple-700">B</span>}
        </div>
        <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] ${
          isUrgent ? 'bg-red-100 text-red-800 border-red-400' :
          isWarning ? 'bg-amber-100 text-amber-800 border-amber-400' :
          'bg-slate-100 text-slate-600 border-slate-300'
        }`}>{label}</span>
      </div>
      
      {/* Trip dates */}
      <div className="text-[9px] text-slate-600 mb-0.5">
        Launch: {formatMMDDYY(job.tripPutIn)} • Out: {formatMMDDYY(job.tripTakeOut)}
      </div>
      
      <div className="text-[10px] text-slate-700 truncate">
        {leg.startLocation} → {leg.endLocation}
      </div>
      <div className="text-[10px] text-slate-600 truncate">{job.car.makeModel} • {job.car.plate}</div>
      <div className="text-[9px] text-slate-500 mt-0.5">
        {formatMMDDYY(leg.date)} {leg.depart}
      </div>
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
