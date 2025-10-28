import { useMemo, useState, useEffect } from "react";
import Office from "./Office";

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

const TODAY = "2025-10-27"; // Monday, October 27, 2025

const DEMO_ROUTES: Route[] = [
  { id: "main_salmon", name: "Main Salmon" },
  { id: "middle_fork", name: "Middle Fork" },
];

const DEMO_DRIVERS: Driver[] = [
  { id: "D1", name: "Mike W", role: "shuttle", onDuty: true },
  { id: "D2", name: "Sasha R", role: "shuttle", onDuty: true },
  { id: "D3", name: "Troy H", role: "shuttle", onDuty: true },
  { id: "D4", name: "Jake P", role: "shuttle", onDuty: true },
  { id: "D5", name: "Emma L", role: "shuttle", onDuty: true },
  { id: "D6", name: "Chris M", role: "shuttle", onDuty: true },
  { id: "D7", name: "Alex K", role: "shuttle", onDuty: true },
  { id: "D8", name: "Jordan T", role: "shuttle", onDuty: true },
  { id: "V1", name: "Van Crew", role: "van", onDuty: true },
];

const DEMO_DATA: Record<string, { currentDate: string; drivers: Driver[]; jobs: Job[] }> = {
  main_salmon: {
    currentDate: TODAY,
    drivers: DEMO_DRIVERS,
    jobs: [
      // Oct 27 (TODAY) - Leg A moves (3 cars)
      {
        id: "J-1007",
        car: { owner: "Garcia", makeModel: "Toyota Tacoma", plate: "ID-E67890D", year: 2020, color: "Gray" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1008",
        car: { owner: "Harris", makeModel: "Honda Pilot", plate: "OR-F78901E", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1009",
        car: { owner: "Ingram", makeModel: "GMC Sierra", plate: "WA-G89012F", year: 2019, color: "Blue" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-11-01",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-27", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-10-31", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1010",
        car: { owner: "Jackson", makeModel: "Nissan Frontier", plate: "MT-H90123G", year: 2020, color: "Red" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1011",
        car: { owner: "Kim", makeModel: "Ford Ranger", plate: "ID-I01234H", year: 2022, color: "Orange" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1012",
        car: { owner: "Lopez", makeModel: "Jeep Gladiator", plate: "OR-J12345I", year: 2021, color: "Yellow" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "08:30", arrive: "12:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "12:30", arrive: "18:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1013",
        car: { owner: "Martinez", makeModel: "Toyota Tundra", plate: "WA-K23456J", year: 2020, color: "Black" },
        tripPutIn: "2025-10-30",
        tripTakeOut: "2025-11-05",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-31", depart: "08:45", arrive: "12:15", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-04", depart: "12:45", arrive: "18:15", driverId: "D2" },
        ],
      },

      // Oct 28 (Tue) - Leg A moves (5 cars)
      {
        id: "J-1014",
        car: { owner: "Nelson", makeModel: "Chevy Colorado", plate: "MT-L34567K", year: 2019, color: "White" },
        tripPutIn: "2025-10-27",
        tripTakeOut: "2025-11-02",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-28", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-01", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1015",
        car: { owner: "O'Brien", makeModel: "Ford Explorer", plate: "ID-M45678L", year: 2021, color: "Gray" },
        tripPutIn: "2025-10-27",
        tripTakeOut: "2025-11-02",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-28", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-01", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1016",
        car: { owner: "Parker", makeModel: "Ram 2500", plate: "OR-N56789M", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-27",
        tripTakeOut: "2025-11-02",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-28", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-01", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1017",
        car: { owner: "Quinn", makeModel: "Subaru Forester", plate: "WA-O67890N", year: 2022, color: "Green" },
        tripPutIn: "2025-10-27",
        tripTakeOut: "2025-11-02",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-28", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-01", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1018",
        car: { owner: "Roberts", makeModel: "Jeep Cherokee", plate: "MT-P78901O", year: 2019, color: "Red" },
        tripPutIn: "2025-10-27",
        tripTakeOut: "2025-11-02",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-28", depart: "08:15", arrive: "11:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-01", depart: "12:15", arrive: "17:45", driverId: "D3" },
        ],
      },

      // Oct 29 (Wed) - Leg A moves (4 cars)
      {
        id: "J-1022",
        car: { owner: "Valdez", makeModel: "Chevy Tahoe", plate: "MT-T12345S", year: 2019, color: "Gray" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "07:00", arrive: "10:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "11:00", arrive: "16:30", driverId: "D2" },
        ],
      },
      {
        id: "J-1023",
        car: { owner: "Watson", makeModel: "Nissan Pathfinder", plate: "ID-U23456T", year: 2021, color: "Blue" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "07:15", arrive: "10:45", driverId: "D2" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "11:15", arrive: "16:45", driverId: "D3" },
        ],
      },
      {
        id: "J-1024",
        car: { owner: "Xavier", makeModel: "Honda CR-V", plate: "OR-V34567U", year: 2020, color: "Red" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "07:30", arrive: "11:00", driverId: "D3" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "11:30", arrive: "17:00", driverId: "D1" },
        ],
      },
      {
        id: "J-1025",
        car: { owner: "Young", makeModel: "Mazda CX-5", plate: "WA-W45678V", year: 2022, color: "Silver" },
        tripPutIn: "2025-10-28",
        tripTakeOut: "2025-11-03",
        legs: [
          { leg: "A", startLocation: "Corn Creek", endLocation: "Stanley Yard", date: "2025-10-29", depart: "08:00", arrive: "11:30", driverId: "D1" },
          { leg: "B", startLocation: "Stanley Yard", endLocation: "Hammer Creek", date: "2025-11-02", depart: "12:00", arrive: "17:30", driverId: "D2" },
        ],
      },
    ],
  },
  middle_fork: {
    currentDate: TODAY,
    drivers: DEMO_DRIVERS,
    jobs: [
      // Oct 27 (Mon, TODAY) - 5 single-leg moves
      {
        id: "MF-101",
        car: { owner: "Morgan", makeModel: "Jeep Compass", plate: "WA-4L110I", year: 2019, color: "Gray" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-102",
        car: { owner: "Nash", makeModel: "Ram ProMaster", plate: "ID-5M221J", year: 2021, color: "White" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-103",
        car: { owner: "Owen", makeModel: "Toyota Land Cruiser", plate: "MT-6N332K", year: 2020, color: "Black" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-104",
        car: { owner: "Price", makeModel: "Subaru Crosstrek", plate: "OR-7O443L", year: 2022, color: "Orange" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-105",
        car: { owner: "Reed", makeModel: "Honda Ridgeline", plate: "WA-8P554M", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-22",
        tripTakeOut: "2025-10-27",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-27", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },

      // Oct 28 (Tue) - 6 single-leg moves
      {
        id: "MF-106",
        car: { owner: "Scott", makeModel: "GMC Terrain", plate: "ID-9Q665N", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-107",
        car: { owner: "Turner", makeModel: "Mazda CX-9", plate: "MT-0R776O", year: 2019, color: "Green" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-108",
        car: { owner: "Upton", makeModel: "Volkswagen Atlas", plate: "OR-1S887P", year: 2021, color: "Red" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-109",
        car: { owner: "Vega", makeModel: "Buick Enclave", plate: "WA-2T998Q", year: 2020, color: "Gray" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-110",
        car: { owner: "Ward", makeModel: "Cadillac XT5", plate: "ID-3U009R", year: 2022, color: "Black" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-111",
        car: { owner: "Xavier", makeModel: "Audi Q7", plate: "MT-1X887Y", year: 2021, color: "White" },
        tripPutIn: "2025-10-23",
        tripTakeOut: "2025-10-28",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-28", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },

      // Oct 29 (Wed) - 7 single-leg moves
      {
        id: "MF-112",
        car: { owner: "York", makeModel: "Lincoln Navigator", plate: "MT-4V110S", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-113",
        car: { owner: "Zimmerman", makeModel: "Acura MDX", plate: "OR-5W221T", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-114",
        car: { owner: "Allen", makeModel: "Infiniti QX80", plate: "WA-6X332U", year: 2019, color: "Black" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-115",
        car: { owner: "Brooks", makeModel: "Lexus GX", plate: "ID-7Y443V", year: 2021, color: "Green" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-116",
        car: { owner: "Cooper", makeModel: "Land Rover Discovery", plate: "MT-8Z554W", year: 2022, color: "Red" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-117",
        car: { owner: "Dixon", makeModel: "BMW X5", plate: "OR-9A112Z", year: 2020, color: "White" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-118",
        car: { owner: "Ellis", makeModel: "Mercedes GLE", plate: "WA-0B223A", year: 2021, color: "Gray" },
        tripPutIn: "2025-10-24",
        tripTakeOut: "2025-10-29",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-29", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },

      // Oct 30 (Thu) - 8 single-leg moves
      {
        id: "MF-119",
        car: { owner: "Foster", makeModel: "Porsche Cayenne", plate: "ID-1C334B", year: 2022, color: "Black" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-120",
        car: { owner: "Garcia", makeModel: "Volvo XC90", plate: "MT-2D445C", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-121",
        car: { owner: "Hayes", makeModel: "Tesla Model X", plate: "OR-3E556D", year: 2021, color: "White" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-122",
        car: { owner: "Ingram", makeModel: "Rivian R1S", plate: "WA-4F667E", year: 2023, color: "Green" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-123",
        car: { owner: "James", makeModel: "Jaguar F-PACE", plate: "ID-5G778F", year: 2020, color: "Silver" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-124",
        car: { owner: "Kelly", makeModel: "Range Rover Sport", plate: "MT-6H889G", year: 2021, color: "Black" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-125",
        car: { owner: "Lewis", makeModel: "Alfa Romeo Stelvio", plate: "OR-7I990H", year: 2022, color: "Red" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },
      {
        id: "MF-126",
        car: { owner: "Martinez", makeModel: "Genesis GV80", plate: "WA-8J001I", year: 2021, color: "Gray" },
        tripPutIn: "2025-10-25",
        tripTakeOut: "2025-10-30",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-30", depart: "09:00", arrive: "14:15", driverId: "D2" },
        ],
      },

      // Oct 31 (Fri) - 6 single-leg moves
      {
        id: "MF-127",
        car: { owner: "Nelson", makeModel: "Maserati Levante", plate: "ID-9K112J", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-128",
        car: { owner: "Parker", makeModel: "Bentley Bentayga", plate: "MT-0L223K", year: 2021, color: "White" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-129",
        car: { owner: "Quinn", makeModel: "Aston Martin DBX", plate: "OR-1M334L", year: 2022, color: "Green" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-130",
        car: { owner: "Roberts", makeModel: "Toyota 4Runner", plate: "WA-2N445M", year: 2020, color: "Black" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-131",
        car: { owner: "Smith", makeModel: "Jeep Grand Cherokee", plate: "ID-3O556N", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-132",
        car: { owner: "Taylor", makeModel: "Ford Expedition", plate: "MT-4P667O", year: 2020, color: "White" },
        tripPutIn: "2025-10-26",
        tripTakeOut: "2025-10-31",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-10-31", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },

      // Nov 3 (Mon, Week 2) - 5 single-leg moves
      {
        id: "MF-133",
        car: { owner: "Underwood", makeModel: "Chevrolet Tahoe", plate: "OR-5Q778P", year: 2021, color: "Gray" },
        tripPutIn: "2025-10-29",
        tripTakeOut: "2025-11-03",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-03", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-134",
        car: { owner: "Valdez", makeModel: "GMC Yukon", plate: "WA-6R889Q", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-29",
        tripTakeOut: "2025-11-03",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-03", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-135",
        car: { owner: "Watson", makeModel: "Nissan Armada", plate: "ID-7S990R", year: 2021, color: "Black" },
        tripPutIn: "2025-10-29",
        tripTakeOut: "2025-11-03",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-03", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-136",
        car: { owner: "Young", makeModel: "Toyota Sequoia", plate: "MT-8T001S", year: 2020, color: "White" },
        tripPutIn: "2025-10-29",
        tripTakeOut: "2025-11-03",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-03", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-137",
        car: { owner: "Zhang", makeModel: "Honda Pilot", plate: "OR-9U112T", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-29",
        tripTakeOut: "2025-11-03",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-03", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },

      // Nov 5 (Wed) - 8 single-leg moves
      {
        id: "MF-138",
        car: { owner: "Adams", makeModel: "Mazda CX-90", plate: "WA-0V223U", year: 2023, color: "Red" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-139",
        car: { owner: "Blake", makeModel: "Hyundai Palisade", plate: "ID-1W334V", year: 2021, color: "Blue" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-140",
        car: { owner: "Cole", makeModel: "Kia Telluride", plate: "MT-2X445W", year: 2022, color: "Green" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-141",
        car: { owner: "Drake", makeModel: "Volkswagen ID.4", plate: "OR-3Y556X", year: 2021, color: "White" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-142",
        car: { owner: "Evans", makeModel: "Ford Mustang Mach-E", plate: "WA-4Z667Y", year: 2023, color: "Gray" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-143",
        car: { owner: "Flynn", makeModel: "Subaru Outback", plate: "ID-5A778Z", year: 2020, color: "Black" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-144",
        car: { owner: "Grant", makeModel: "Subaru Ascent", plate: "MT-6B889A", year: 2021, color: "Silver" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },
      {
        id: "MF-145",
        car: { owner: "Hayes", makeModel: "Toyota Highlander", plate: "OR-7C990B", year: 2020, color: "Blue" },
        tripPutIn: "2025-10-31",
        tripTakeOut: "2025-11-05",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-05", depart: "09:00", arrive: "14:15", driverId: "D2" },
        ],
      },

      // Nov 7 (Fri) - 9 single-leg moves (OVERBOOKED!)
      {
        id: "MF-146",
        car: { owner: "Irwin", makeModel: "Honda CR-V", plate: "WA-8D001C", year: 2021, color: "White" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-147",
        car: { owner: "James", makeModel: "Toyota RAV4", plate: "ID-9E112D", year: 2020, color: "Gray" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-148",
        car: { owner: "Kelly", makeModel: "Mazda CX-5", plate: "MT-0F223E", year: 2021, color: "Red" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-149",
        car: { owner: "Lewis", makeModel: "Nissan Rogue", plate: "OR-1G334F", year: 2020, color: "Black" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-150",
        car: { owner: "Morgan", makeModel: "Chevrolet Equinox", plate: "WA-2H445G", year: 2021, color: "Silver" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-151",
        car: { owner: "Nash", makeModel: "GMC Terrain", plate: "ID-3I556H", year: 2020, color: "Blue" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-152",
        car: { owner: "Owen", makeModel: "Ford Edge", plate: "MT-4J667I", year: 2021, color: "White" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },
      {
        id: "MF-153",
        car: { owner: "Price", makeModel: "Jeep Wrangler", plate: "OR-5K778J", year: 2020, color: "Green" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "09:00", arrive: "14:15", driverId: "D2" },
        ],
      },
      {
        id: "MF-154",
        car: { owner: "Quinn", makeModel: "Jeep Gladiator", plate: "WA-6L889K", year: 2021, color: "Gray" },
        tripPutIn: "2025-11-02",
        tripTakeOut: "2025-11-07",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-07", depart: "09:15", arrive: "14:30", driverId: "D3" },
        ],
      },

      // Nov 10 (Mon, Week 3) - 10 single-leg moves (OVERBOOKED!)
      {
        id: "MF-155",
        car: { owner: "Roberts", makeModel: "Ram 1500", plate: "ID-7M990L", year: 2020, color: "Black" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "07:00", arrive: "12:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-156",
        car: { owner: "Smith", makeModel: "Chevy Silverado", plate: "MT-8N001M", year: 2021, color: "Silver" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "07:15", arrive: "12:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-157",
        car: { owner: "Taylor", makeModel: "Ford F-150", plate: "OR-9O112N", year: 2020, color: "White" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "07:30", arrive: "12:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-158",
        car: { owner: "Underwood", makeModel: "Toyota Tundra", plate: "WA-0P223O", year: 2021, color: "Red" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "08:00", arrive: "13:15", driverId: "D1" },
        ],
      },
      {
        id: "MF-159",
        car: { owner: "Valdez", makeModel: "Nissan Titan", plate: "ID-1Q334P", year: 2020, color: "Blue" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "08:15", arrive: "13:30", driverId: "D2" },
        ],
      },
      {
        id: "MF-160",
        car: { owner: "Watson", makeModel: "GMC Sierra", plate: "MT-2R445Q", year: 2021, color: "Green" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "08:30", arrive: "13:45", driverId: "D3" },
        ],
      },
      {
        id: "MF-161",
        car: { owner: "Xavier", makeModel: "Honda Ridgeline", plate: "OR-3S556R", year: 2020, color: "Gray" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "08:45", arrive: "14:00", driverId: "D1" },
        ],
      },
      {
        id: "MF-162",
        car: { owner: "Young", makeModel: "Jeep Gladiator", plate: "WA-4T667S", year: 2021, color: "Black" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "09:00", arrive: "14:15", driverId: "D2" },
        ],
      },
      {
        id: "MF-163",
        car: { owner: "Zhang", makeModel: "Ford Ranger", plate: "ID-5U778T", year: 2020, color: "Silver" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "09:15", arrive: "14:30", driverId: "D3" },
        ],
      },
      {
        id: "MF-164",
        car: { owner: "Adams", makeModel: "Toyota Tacoma", plate: "MT-6V889U", year: 2021, color: "White" },
        tripPutIn: "2025-11-05",
        tripTakeOut: "2025-11-10",
        legs: [
          { startLocation: "Boundary Creek", endLocation: "Cache Bar", date: "2025-11-10", depart: "09:30", arrive: "14:45", driverId: "D1" },
        ],
      },
    ],
  },
};

/* ---------------- Root Component ---------------- */

export default function App() {
  const [currentPage, setCurrentPage] = useState<"dispatch" | "office">("dispatch");

  return (
    <div>
      {/* Top Navigation */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-slate-900">ShuttleForge</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage("dispatch")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                  currentPage === "dispatch"
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                📋 Dispatch
              </button>
              <button
                onClick={() => setCurrentPage("office")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                  currentPage === "office"
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                🏢 Office
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      {currentPage === "dispatch" && <RouteDispatchPage />}
      {currentPage === "office" && <Office />}
    </div>
  );
}

function RouteDispatchPage() {
  const [activeRoute, setActiveRoute] = useState("main_salmon");
  const route = DEMO_ROUTES.find(r => r.id === activeRoute);

  // Get data for active route - jobs are mutable state
  const [jobs, setJobs] = useState<Job[]>(DEMO_DATA[activeRoute].jobs);
  const drivers = DEMO_DATA[activeRoute].drivers;
  const currentDate = DEMO_DATA[activeRoute].currentDate;
  
  // Update jobs when route changes
  useEffect(() => {
    setJobs(DEMO_DATA[activeRoute].jobs);
  }, [activeRoute]);

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

  const hasErrors = issues.some(i => i.level === "error");
  const exportBlocked = hasErrors;

  const [mode, setMode] = useState<"list" | "calendar">("list");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ job: Job; legIndex: number } | null>(null);
  const [dropWarning, setDropWarning] = useState<string | null>(null);
  
  // Calendar month navigation - start with current month
  const [calendarViewDate, setCalendarViewDate] = useState<string>(currentDate);
  
  // Function to update a job's leg date
  const updateJobLegDate = (jobId: string, legIndex: number, newDate: string) => {
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id === jobId) {
        const updatedLegs = [...job.legs];
        updatedLegs[legIndex] = { ...updatedLegs[legIndex], date: newDate };
        return { ...job, legs: updatedLegs };
      }
      return job;
    }));
  };
  
  // Function to update a job's leg location
  const updateJobLegLocation = (jobId: string, legIndex: number, field: 'startLocation' | 'endLocation', value: string) => {
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id === jobId) {
        const updatedLegs = [...job.legs];
        updatedLegs[legIndex] = { ...updatedLegs[legIndex], [field]: value };
        return { ...job, legs: updatedLegs };
      }
      return job;
    }));
  };

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
            <span className="px-2 py-1 rounded border bg-slate-50">Overbooked days: {overbookedDays.length}</span>
          </div>
          
          {/* Color Guide */}
          {activeRoute === 'main_salmon' && (
            <div className="mt-3 flex items-center gap-4 text-xs border-t pt-3">
              <div className="font-semibold text-slate-700">Legend:</div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-blue-100 border-2 border-blue-400"></div>
                <span className="text-slate-600">Leg A (Launch → Stanley)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-purple-100 border-2 border-purple-400"></div>
                <span className="text-slate-600">Leg B (Stanley → Take-out)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-red-600 border-2 border-red-800"></div>
                <span className="text-slate-600 font-semibold">⚠️ Overbooked Day</span>
              </div>
            </div>
          )}
          
          {activeRoute === 'middle_fork' && (
            <div className="mt-3 flex items-center gap-4 text-xs border-t pt-3">
              <div className="font-semibold text-slate-700">Legend:</div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-slate-100 border-2 border-slate-400"></div>
                <span className="text-slate-600">Single Delivery</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-red-600 border-2 border-red-800"></div>
                <span className="text-slate-600 font-semibold">⚠️ Overbooked Day</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMode("list")} className={`px-3 py-2 rounded-xl border text-sm ${mode === 'list' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>List</button>
          <button onClick={() => setMode("calendar")} className={`px-3 py-2 rounded-xl border text-sm ${mode === 'calendar' ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>Calendar</button>
          <button disabled={exportBlocked} className={`px-3 py-2 rounded-xl border text-sm ${exportBlocked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}>Export</button>
        </div>
      </div>

      {/* Warnings & Scheduling Conflicts Panel */}
      <WarningsPanel issues={issues} overbookedDays={overbookedDays} onDateClick={(date) => {
        // Scroll to the date in current view mode
        if (mode === 'list') {
          // In List view: scroll to the date header
          setTimeout(() => {
            const dateElement = document.querySelector(`[data-date="${date}"]`);
            if (dateElement) {
              dateElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        } else {
          // In Calendar view: scroll to the calendar day cell
          setTimeout(() => {
            const dayCell = document.querySelector(`[data-calendar-date="${date}"]`);
            if (dayCell) {
              dayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Flash the cell to draw attention
              dayCell.classList.add('ring-4', 'ring-red-500', 'ring-offset-2');
              setTimeout(() => {
                dayCell.classList.remove('ring-4', 'ring-red-500', 'ring-offset-2');
              }, 2000);
            }
          }, 100);
        }
      }} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          {mode === 'list' && <ListMode jobs={jobs} currentDate={currentDate} overbookedDays={overbookedDays} onUpdateLocation={updateJobLegLocation} />}
          {mode === 'calendar' && (
            <>
              {/* Month Navigation */}
              <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200">
                <button
                  onClick={() => {
                    const date = new Date(calendarViewDate + 'T00:00:00');
                    date.setMonth(date.getMonth() - 1);
                    setCalendarViewDate(date.toISOString().slice(0, 10));
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition flex items-center gap-2"
                >
                  <span>←</span> Previous Month
                </button>
                <div className="flex items-center gap-4">
                  <div className="text-lg font-bold text-slate-800">
                    {new Date(calendarViewDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </div>
                  <button
                    onClick={() => setCalendarViewDate(currentDate)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition border border-blue-200"
                  >
                    Today
                  </button>
                </div>
                <button
                  onClick={() => {
                    const date = new Date(calendarViewDate + 'T00:00:00');
                    date.setMonth(date.getMonth() + 1);
                    setCalendarViewDate(date.toISOString().slice(0, 10));
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition flex items-center gap-2"
                >
                  Next Month <span>→</span>
                </button>
              </div>
              <CalendarView
                jobs={jobs}
                currentDate={currentDate}
                viewDate={calendarViewDate}
                onSelectJob={setSelectedJob}
                draggedItem={draggedItem}
                onDragStart={setDraggedItem}
                onDragEnd={() => setDraggedItem(null)}
                onDropWarning={setDropWarning}
                onUpdateJobLegDate={updateJobLegDate}
              />
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sticky top-6 self-start">
          <CarsMovedTodayPanel jobs={jobs} currentDate={currentDate} />
          {mode === 'calendar' && selectedJob && (
            <JobDetailsPanel job={selectedJob} currentDate={currentDate} onClose={() => setSelectedJob(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Warnings Panel ---------------- */

function WarningsPanel({ issues, overbookedDays, onDateClick }: { 
  issues: Issue[]; 
  overbookedDays: string[];
  onDateClick?: (date: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Only show if there are issues or overbooked days
  const hasWarnings = issues.length > 0 || overbookedDays.length > 0;
  
  if (!hasWarnings) {
    return null;
  }

  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warn').length;
  const overbookedCount = overbookedDays.length;

  return (
    <div className="rounded-2xl border bg-white overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-900">⚠️ Warnings & Scheduling Conflicts</span>
          <div className="flex items-center gap-2 text-xs">
            {errorCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">
                {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
              </span>
            )}
            {warningCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
              </span>
            )}
            {overbookedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">
                {overbookedCount} Overbooked {overbookedCount === 1 ? 'Day' : 'Days'}
              </span>
            )}
          </div>
        </div>
        <span className="text-slate-400 text-lg">
          {isExpanded ? '−' : '+'}
        </span>
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-4 border-t space-y-3">
          {/* Scheduling Conflicts */}
          {issues.length > 0 && (
            <div>
              <div className="font-medium text-sm mb-2 text-slate-700">Scheduling Conflicts:</div>
              <ul className="space-y-1.5">
                {issues.map((issue, idx) => (
                  <li 
                    key={idx} 
                    className={`text-sm flex items-start gap-2 ${
                      issue.level === 'error' ? 'text-red-800' : 'text-amber-800'
                    }`}
                  >
                    <span className="mt-0.5">
                      {issue.level === 'error' ? '🔴' : '🟡'}
                    </span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Overbooked Days */}
          {overbookedDays.length > 0 && (
            <div>
              <div className="font-medium text-sm mb-2 text-slate-700">Overbooked Days:</div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <ul className="space-y-1">
                  {overbookedDays.map(day => (
                    <li key={day}>
                      <button
                        onClick={() => {
                          if (onDateClick) {
                            onDateClick(day);
                          }
                        }}
                        className="w-full text-left text-sm text-red-800 flex items-center gap-2 hover:bg-red-100 px-2 py-1 rounded transition"
                      >
                        <span className="w-2 h-2 rounded-full bg-red-600"></span>
                        <span className="flex-1">{day}</span>
                        <span className="text-xs text-red-600">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- List View ---------------- */

function ListMode({ jobs, currentDate, overbookedDays, onUpdateLocation }: { 
  jobs: Job[]; 
  currentDate: string;
  overbookedDays: string[];
  onUpdateLocation: (jobId: string, legIndex: number, field: 'startLocation' | 'endLocation', value: string) => void;
}) {
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [daysAhead, setDaysAhead] = useState<number>(7);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [editingLeg, setEditingLeg] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<'start' | 'end' | null>(null);
  const [editValue, setEditValue] = useState('');

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
      // Check if any leg is within the date range (inclusive of today through cutoffDate)
      return job.legs.some(leg => {
        return leg.date >= currentDate && leg.date <= cutoffDate;
      });
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
        const isOverbooked = overbookedDays.includes(date);
        const dateObj = new Date(date + 'T00:00:00');
        const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'long' });
        const dateStr = dateObj.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        
        return (
          <div key={date} className="space-y-3">
            {/* Date Header */}
            <div 
              data-date={date}
              className={`sticky top-0 z-10 px-4 py-3 rounded-xl border-2 ${
                isOverbooked
                  ? 'bg-red-600 border-red-800 text-white shadow-lg'
                  : isToday 
                  ? 'bg-blue-100 border-blue-400 text-blue-900' 
                  : 'bg-slate-100 border-slate-300 text-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-lg flex items-center gap-2">
                    {isOverbooked && <span className="text-xl">⚠️</span>}
                    {dayName}
                  </div>
                  <div className="text-sm">{dateStr}</div>
                </div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  {dateJobs.length} {dateJobs.length === 1 ? 'job' : 'jobs'}
                  {isToday && <span className="ml-2 px-2 py-1 rounded-full bg-blue-600 text-white text-xs">TODAY</span>}
                  {isOverbooked && <span className="ml-2 px-2 py-1 rounded-full bg-white text-red-600 text-xs font-bold">OVERBOOKED</span>}
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

              {/* Edit & Expand Icons */}
              <div className="shrink-0 flex items-center gap-2">
                {!isExpanded && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(job.id);
                      setEditingJob(job.id);
                      setEditingLeg(0);
                    }}
                    className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                  >
                    ✏️ Edit
                  </button>
                )}
                <div className="text-slate-400">
                  {isExpanded ? '▼' : '▶'}
                </div>
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
                  {job.legs.map((leg, idx) => {
                    const isEditingThis = editingJob === job.id && editingLeg === idx;
                    
                    return (
                    <div key={idx} className="rounded-lg border border-slate-300 bg-white p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">
                          {job.legs.length > 1 ? `Leg ${leg.leg || '?'}` : 'Delivery'}
                        </span>
                        <div className="flex items-center gap-2">
                          {pillFor(leg)}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isEditingThis) {
                                setEditingJob(null);
                                setEditingLeg(null);
                                setEditingField(null);
                              } else {
                                setEditingJob(job.id);
                                setEditingLeg(idx);
                              }
                            }}
                            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50"
                          >
                            {isEditingThis ? '✓ Done' : '✏️ Edit'}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-slate-700">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 w-12">Route:</span>
                          {isEditingThis && editingField === 'start' ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => {
                                if (editValue.trim()) {
                                  onUpdateLocation(job.id, idx, 'startLocation', editValue.trim());
                                }
                                setEditingField(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (editValue.trim()) {
                                    onUpdateLocation(job.id, idx, 'startLocation', editValue.trim());
                                  }
                                  setEditingField(null);
                                } else if (e.key === 'Escape') {
                                  setEditingField(null);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="px-2 py-1 border border-blue-400 rounded text-xs flex-1"
                            />
                          ) : (
                            <span
                              onClick={(e) => {
                                if (isEditingThis) {
                                  e.stopPropagation();
                                  setEditValue(leg.startLocation);
                                  setEditingField('start');
                                }
                              }}
                              className={`font-medium ${isEditingThis ? 'cursor-pointer hover:bg-blue-50 px-1 rounded' : ''}`}
                            >
                              {leg.startLocation}
                            </span>
                          )}
                          <span>→</span>
                          {isEditingThis && editingField === 'end' ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => {
                                if (editValue.trim()) {
                                  onUpdateLocation(job.id, idx, 'endLocation', editValue.trim());
                                }
                                setEditingField(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (editValue.trim()) {
                                    onUpdateLocation(job.id, idx, 'endLocation', editValue.trim());
                                  }
                                  setEditingField(null);
                                } else if (e.key === 'Escape') {
                                  setEditingField(null);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="px-2 py-1 border border-blue-400 rounded text-xs flex-1"
                            />
                          ) : (
                            <span
                              onClick={(e) => {
                                if (isEditingThis) {
                                  e.stopPropagation();
                                  setEditValue(leg.endLocation);
                                  setEditingField('end');
                                }
                              }}
                              className={`font-medium ${isEditingThis ? 'cursor-pointer hover:bg-blue-50 px-1 rounded' : ''}`}
                            >
                              {leg.endLocation}
                            </span>
                          )}
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
                    );
                  })}
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
  targetSlotType: string,
  onDropWarning: (warning: string | null) => void,
  onDragEnd: () => void,
  onUpdateJobLegDate: (jobId: string, legIndex: number, newDate: string) => void
) {
  const { job, legIndex } = draggedItem;
  const leg = job.legs[legIndex];
  const isLegB = leg.leg === "B";
  const isLegA = leg.leg === "A";
  
  // Rule 0: Leg-specific drop zones (Main Salmon only)
  if (isLegA && targetSlotType === "B") {
    onDropWarning(`❌ Cannot drop Leg A (blue) into a Leg B (purple) slot. Drag to a blue slot instead.`);
    onDragEnd();
    return;
  }
  if (isLegB && targetSlotType === "A") {
    onDropWarning(`❌ Cannot drop Leg B (purple) into a Leg A (blue) slot. Drag to a purple slot instead.`);
    onDragEnd();
    return;
  }
  
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
  
  // Update the job's leg date
  onUpdateJobLegDate(job.id, legIndex, targetDate);
  onDragEnd();
}

/** Calendar grid (7 columns x N weeks). Cards render on their leg date(s) */
function CalendarView({ jobs, currentDate, viewDate, onSelectJob, draggedItem, onDragStart, onDragEnd, onDropWarning, onUpdateJobLegDate }: {
  jobs: Job[];
  currentDate: string;
  viewDate: string;
  onSelectJob: (job: Job) => void;
  draggedItem: { job: Job; legIndex: number } | null;
  onDragStart: (item: { job: Job; legIndex: number }) => void;
  onDragEnd: () => void;
  onDropWarning: (warning: string | null) => void;
  onUpdateJobLegDate: (jobId: string, legIndex: number, newDate: string) => void;
}) {
  // Display full month calendar based on viewDate
  const viewDateObj = new Date(viewDate + 'T00:00:00');
  const year = viewDateObj.getFullYear();
  const month = viewDateObj.getMonth();
  
  // Get first day of the month
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  
  // Get the Sunday before (or on) the first day of month
  const firstDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(firstDayOfMonth);
  gridStart.setDate(gridStart.getDate() - firstDayOfWeek);
  const gridStartISO = gridStart.toISOString().slice(0, 10);
  
  // Calculate number of days to show (always show complete weeks)
  const lastDayOfWeek = lastDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();
  const totalDays = firstDayOfWeek + daysInMonth + (6 - lastDayOfWeek);
  
  const allDays = daysArray(gridStartISO, totalDays);

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

      {/* Rows (full month) */}
      <div className="grid grid-cols-7 gap-px bg-slate-200">
        {allDays.map((dayISO) => {
          const isToday = dayISO === currentDate;
          const isPast = dayISO < currentDate;
          const dayDateObj = new Date(dayISO + "T00:00:00");
          const dayNum = dayDateObj.getDate();
          const isCurrentMonth = dayDateObj.getMonth() === month;
          const capacity = capacityByDay.get(dayISO) || { used: 0, total: 8 };
          const available = capacity.total - capacity.used;
          const isOverbooked = capacity.used > capacity.total;
          
          // Hide past days for cleaner view
          if (isPast) {
            return (
              <div 
                key={dayISO} 
                className="bg-slate-50 min-h-[140px]"
              />
            );
          }
          
          return (
            <div 
              key={dayISO} 
              data-calendar-date={dayISO}
              className={`p-2 min-h-[140px] transition-all ${
                !isCurrentMonth 
                  ? 'bg-slate-50 opacity-50' 
                  : isOverbooked 
                  ? 'bg-red-600 border-2 border-red-800 shadow-lg' 
                  : isToday 
                  ? 'bg-blue-50 border-2 border-blue-300' 
                  : 'bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className={`text-xs font-medium flex items-center gap-1 ${
                  !isCurrentMonth
                    ? 'text-slate-400'
                    : isOverbooked 
                    ? 'text-white font-bold' 
                    : isToday 
                    ? 'text-blue-600 font-bold' 
                    : 'text-slate-600'
                }`}>
                  {isOverbooked && <span className="text-sm">⚠️</span>}
                  {dayNum}
                  {isToday && <span className="ml-1 text-[10px]">Today</span>}
                  {isOverbooked && <span className="ml-1 text-[9px] px-1 py-0.5 bg-white text-red-600 rounded font-bold">OVER</span>}
                </div>
                <div className={`text-[10px] font-semibold ${
                  isOverbooked ? 'text-white' :
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
                            handleDrop(dayISO, draggedItem, slotType, onDropWarning, onDragEnd, onUpdateJobLegDate);
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

function VehicleCard({ job, legIndex, currentDate, onClick, onDragStart, onDragEnd, isDragging, onUpdateLocation }: {
  job: Job;
  legIndex: number;
  currentDate: string;
  onClick: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  onUpdateLocation?: (jobId: string, legIndex: number, field: 'startLocation' | 'endLocation', value: string) => void;
}) {
  const [editingField, setEditingField] = useState<'start' | 'end' | null>(null);
  const [editValue, setEditValue] = useState('');
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

  // Left border stripe color
  const leftBorderColor = isLegA ? 'border-l-blue-500' : 
                          isLegB ? 'border-l-purple-500' : 
                          'border-l-slate-500';

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
      className={`w-full text-left rounded-lg border ${legColorCls} border-l-4 ${leftBorderColor} px-2 py-1.5 hover:shadow transition text-xs cursor-move ${
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
      
      <div className="text-[10px] text-slate-700 flex items-center gap-1">
        {editingField === 'start' && onUpdateLocation ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              if (editValue.trim()) {
                onUpdateLocation(job.id, legIndex, 'startLocation', editValue.trim());
              }
              setEditingField(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (editValue.trim()) {
                  onUpdateLocation(job.id, legIndex, 'startLocation', editValue.trim());
                }
                setEditingField(null);
              } else if (e.key === 'Escape') {
                setEditingField(null);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            autoFocus
            className="px-1 py-0.5 border border-blue-400 rounded bg-white text-[10px] w-24"
          />
        ) : (
          <span
            onClick={(e) => {
              if (onUpdateLocation) {
                e.stopPropagation();
                setEditValue(leg.startLocation);
                setEditingField('start');
              }
            }}
            className={onUpdateLocation ? 'cursor-pointer hover:bg-blue-50 px-1 rounded' : ''}
          >
            {leg.startLocation}
          </span>
        )}
        <span>→</span>
        {editingField === 'end' && onUpdateLocation ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              if (editValue.trim()) {
                onUpdateLocation(job.id, legIndex, 'endLocation', editValue.trim());
              }
              setEditingField(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (editValue.trim()) {
                  onUpdateLocation(job.id, legIndex, 'endLocation', editValue.trim());
                }
                setEditingField(null);
              } else if (e.key === 'Escape') {
                setEditingField(null);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            autoFocus
            className="px-1 py-0.5 border border-blue-400 rounded bg-white text-[10px] w-24"
          />
        ) : (
          <span
            onClick={(e) => {
              if (onUpdateLocation) {
                e.stopPropagation();
                setEditValue(leg.endLocation);
                setEditingField('end');
              }
            }}
            className={onUpdateLocation ? 'cursor-pointer hover:bg-blue-50 px-1 rounded' : ''}
          >
            {leg.endLocation}
          </span>
        )}
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

/* ---------------- Sidebar ---------------- */

function CarsMovedTodayPanel({ jobs, currentDate }: { jobs: Job[]; currentDate: string }) {
  // Track confirmed deliveries in local state (in production, this would be saved to backend)
  const [confirmedDeliveries, setConfirmedDeliveries] = useState<Set<string>>(new Set());

  // Get all legs scheduled for today
  const todayLegs = useMemo(() => {
    const legs: { job: Job; legIndex: number; leg: Leg }[] = [];
    jobs.forEach(job => {
      job.legs.forEach((leg, legIndex) => {
        if (leg.date === currentDate) {
          legs.push({ job, legIndex, leg });
        }
      });
    });
    return legs;
  }, [jobs, currentDate]);

  function handleConfirm(jobId: string, legIndex: number) {
    const key = `${jobId}-${legIndex}`;
    setConfirmedDeliveries(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const confirmedCount = confirmedDeliveries.size;
  const totalCount = todayLegs.length;

  const formattedDate = useMemo(() => {
    const d = new Date(currentDate + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }, [currentDate]);

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="font-semibold mb-3">Cars on the Move — {formattedDate}</div>
      {todayLegs.length === 0 ? (
        <div className="text-sm text-slate-500 py-2">No cars on the move today</div>
      ) : (
        <div className="space-y-2">
          {todayLegs.map(({ job, legIndex, leg }) => {
            const legLabel = job.legs.length > 1 ? (leg.leg || `Leg ${legIndex + 1}`) : "Delivery";
            const days = daysBetween(currentDate, job.tripTakeOut);
            const urgency = urgencyClass(days);
            const key = `${job.id}-${legIndex}`;
            const isConfirmed = confirmedDeliveries.has(key);
            
            return (
              <div 
                key={key} 
                className={`border rounded-xl p-3 text-sm transition-colors ${
                  isConfirmed 
                    ? 'bg-emerald-50 border-emerald-200' 
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{job.car.owner}</div>
                    {isConfirmed && (
                      <span className="text-emerald-600 text-xs">✓</span>
                    )}
                  </div>
                  {job.legs.length > 1 && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      leg.leg === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {legLabel}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 space-y-0.5 mb-2">
                  <div>{job.car.year} {job.car.makeModel} • {job.car.plate}</div>
                  <div className="flex items-center gap-2">
                    <span>{leg.startLocation} → {leg.endLocation}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${urgency}`}>
                      {days === 0 ? 'Today' : days === 1 ? 'D-1' : `${days}d`}
                    </span>
                  </div>
                  {leg.driverId && <div>Driver: {leg.driverId}</div>}
                </div>
                <button
                  onClick={() => handleConfirm(job.id, legIndex)}
                  className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isConfirmed
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isConfirmed ? '✓ Confirmed at Take-Out' : 'Confirm Delivery'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 pt-3 border-t text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-600">
            Total: <span className="font-semibold">{totalCount} {totalCount === 1 ? 'car' : 'cars'}</span>
          </span>
          <span className={`font-semibold ${confirmedCount === totalCount && totalCount > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
            {confirmedCount}/{totalCount} Confirmed
          </span>
        </div>
      </div>
    </div>
  );
}

