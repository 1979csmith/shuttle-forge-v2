import { useState } from "react";

/**
 * Office — Admin Hub
 * 
 * Central place for:
 * - Managing drivers (add/remove, set capacity)
 * - Managing routes (add/edit routes)
 * - Managing locations (put-ins, take-outs, handoff points)
 * - System settings
 * - Reports & analytics
 */

export default function Office() {
  const [activeTab, setActiveTab] = useState<"routes" | "settings">("routes");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ShuttleForge — Office</h1>
            <p className="text-sm text-slate-600">Admin & Configuration</p>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b">
          <button
            onClick={() => setActiveTab("routes")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === "routes"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Routes & Drivers
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === "settings"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            Settings
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {activeTab === "routes" && <RoutesAndDriversPanel />}
          {activeTab === "settings" && <SettingsPanel />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Routes & Drivers Panel (Combined) ---------------- */

// Shared driver pool for all routes
const DRIVER_POOL = [
  { id: "d1", name: "Mike T.", type: "Shuttle", status: "Active", phone: "(208) 555-0101" },
  { id: "d2", name: "Sarah K.", type: "Van", status: "Active", phone: "(208) 555-0102" },
  { id: "d3", name: "Tom R.", type: "Shuttle", status: "Active", phone: "(208) 555-0103" },
  { id: "d4", name: "Lisa M.", type: "Van", status: "Active", phone: "(208) 555-0104" },
  { id: "d5", name: "James P.", type: "Shuttle", status: "Off Duty", phone: "(208) 555-0105" },
  { id: "d6", name: "Carlos R.", type: "Shuttle", status: "Active", phone: "(208) 555-0106" },
  { id: "d7", name: "Emma W.", type: "Van", status: "Active", phone: "(208) 555-0107" },
];

function RoutesAndDriversPanel() {
  return (
    <div className="space-y-6">
      <RoutesPanel driverPool={DRIVER_POOL} />
      <DriverPoolPanel />
    </div>
  );
}

/* ---------------- Driver Pool Panel ---------------- */

function DriverPoolPanel() {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="text-lg font-semibold mb-3">Available Driver Pool</h3>
      <p className="text-sm text-slate-600 mb-4">
        All drivers available for assignment. Assign them to specific routes above.
      </p>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {DRIVER_POOL.map(driver => (
          <div key={driver.id} className="border rounded-xl p-3 bg-slate-50">
            <div className="flex items-start justify-between mb-2">
              <div className="font-medium">{driver.name}</div>
              <span className={`px-2 py-0.5 rounded text-xs ${
                driver.status === "Active" 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                  : "bg-slate-100 text-slate-600 border border-slate-200"
              }`}>
                {driver.status}
              </span>
            </div>
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded ${
                  driver.type === "Van" 
                    ? "bg-purple-100 text-purple-700" 
                    : "bg-blue-100 text-blue-700"
                }`}>
                  {driver.type}
                </span>
              </div>
              <div className="text-slate-600">{driver.phone}</div>
            </div>
          </div>
        ))}
      </div>
      
      <button className="mt-4 w-full px-4 py-2 rounded-xl border border-blue-600 text-blue-600 text-sm font-medium hover:bg-blue-50">
        + Add New Driver to Pool
      </button>
    </div>
  );
}

/* ---------------- Routes Panel ---------------- */

type RouteConfig = {
  id: string;
  name: string;
  duration: string;
  type: "Two-Leg" | "Single-Leg";
  status: "Active" | "Disabled";
  pricing: number;
  driverCapacity: number;
  legA?: { assignedDrivers: string[] };  // For two-leg routes
  legB?: { assignedDrivers: string[] };  // For two-leg routes
  assignedDrivers?: string[];            // For single-leg routes
  locations: {
    putIns: string[];
    takeOuts: string[];
    handoffs?: string[];  // Only for two-leg routes
  };
};

function RoutesPanel({ driverPool }: { driverPool: typeof DRIVER_POOL }) {
  const [routes, setRoutes] = useState<RouteConfig[]>([
    { 
      id: "r1", 
      name: "Main Salmon", 
      duration: "6 days", 
      type: "Two-Leg", 
      status: "Active",
      pricing: 400,
      driverCapacity: 8,
      legA: { assignedDrivers: ["Mike T.", "Sarah K.", "Tom R."] },
      legB: { assignedDrivers: ["Lisa M.", "James P.", "Carlos R."] },
      locations: {
        putIns: ["Corn Creek", "Indian Creek"],
        takeOuts: ["Hammer Creek", "Carey Creek"],
        handoffs: ["Stanley Shuttle Yard", "Challis Hub"]
      }
    },
    { 
      id: "r2", 
      name: "Middle Fork", 
      duration: "5 days", 
      type: "Single-Leg", 
      status: "Active",
      pricing: 350,
      driverCapacity: 8,
      assignedDrivers: ["Mike T.", "Sarah K.", "Emma W."],
      locations: {
        putIns: ["Boundary Creek", "Indian Creek"],
        takeOuts: ["Vinegar Creek", "Cache Bar"]
      }
    },
  ]);

  const [editingRoute, setEditingRoute] = useState<RouteConfig | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  function openEdit(route: RouteConfig) {
    setEditingRoute({ ...route });
    setShowEditModal(true);
  }

  function saveRoute() {
    if (!editingRoute) return;
    setRoutes(routes.map(r => r.id === editingRoute.id ? editingRoute : r));
    setShowEditModal(false);
    setEditingRoute(null);
  }

  function toggleStatus(id: string) {
    setRoutes(routes.map(r => 
      r.id === id 
        ? { ...r, status: r.status === "Active" ? "Disabled" : "Active" }
        : r
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Route Management</h2>
        <button className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          + Add Route
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {routes.map(route => (
          <div key={route.id} className="rounded-2xl border bg-white p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-lg">{route.name}</h3>
                <p className="text-sm text-slate-600">{route.duration} • {route.type}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs ${
                route.status === "Active" 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-slate-50 text-slate-700 border border-slate-200"
              }`}>
                {route.status}
              </span>
            </div>
            
            {/* Route Details */}
            <div className="space-y-2 mb-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Base Price:</span>
                <span className="font-semibold">${route.pricing}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Locations:</span>
                <span className="font-semibold text-xs">
                  {route.locations.putIns.length} put-ins • {route.locations.takeOuts.length} take-outs
                  {route.type === "Two-Leg" && ` • ${route.locations.handoffs?.length || 0} handoffs`}
                </span>
              </div>
              
              {/* Driver assignments by leg */}
              {route.type === "Two-Leg" ? (
                <>
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-600 font-medium">Leg A Drivers:</span>
                      <span className="font-semibold text-blue-600">{route.legA?.assignedDrivers.length || 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {route.legA?.assignedDrivers.map((driver, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                          {driver}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-600 font-medium">Leg B Drivers:</span>
                      <span className="font-semibold text-purple-600">{route.legB?.assignedDrivers.length || 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {route.legB?.assignedDrivers.map((driver, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800">
                          {driver}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-600 font-medium">Assigned Drivers:</span>
                    <span className="font-semibold">{route.assignedDrivers?.length || 0}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {route.assignedDrivers?.map((driver, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-800">
                        {driver}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => openEdit(route)}
                className="flex-1 px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"
              >
                Edit
              </button>
              <button 
                onClick={() => toggleStatus(route.id)}
                className={`px-3 py-2 rounded-xl border text-sm ${
                  route.status === "Active"
                    ? "text-amber-600 hover:bg-amber-50"
                    : "text-emerald-600 hover:bg-emerald-50"
                }`}
              >
                {route.status === "Active" ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Route Modal */}
      {showEditModal && editingRoute && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-xl border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Route: {editingRoute.name}</h3>
              <button 
                onClick={() => setShowEditModal(false)} 
                className="text-slate-500 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Route Name</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={editingRoute.name}
                    onChange={(e) => setEditingRoute({ ...editingRoute, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Base Price (per vehicle)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600">$</span>
                    <input
                      type="number"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 pl-7"
                      value={editingRoute.pricing}
                      onChange={(e) => setEditingRoute({ ...editingRoute, pricing: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              {/* Route Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Route Type</label>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  value={editingRoute.type}
                  onChange={(e) => setEditingRoute({ ...editingRoute, type: e.target.value as "Single-Leg" | "Two-Leg" })}
                >
                  <option value="Single-Leg">Single-Leg (one delivery)</option>
                  <option value="Two-Leg">Two-Leg (Leg A → Leg B)</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Single-Leg: Direct put-in to take-out. Two-Leg: Put-in to handoff, then handoff to take-out.
                </p>
              </div>

              {/* Assigned Drivers - Leg-specific for Two-Leg routes */}
              {editingRoute.type === "Two-Leg" ? (
                <>
                  {/* Leg A Drivers */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Leg A Drivers ({editingRoute.legA?.assignedDrivers.length || 0})
                    </label>
                    <div className="border rounded-xl p-3 bg-blue-50/30 max-h-32 overflow-y-auto">
                      {!editingRoute.legA?.assignedDrivers.length ? (
                        <p className="text-sm text-slate-500">No drivers assigned to Leg A</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {editingRoute.legA.assignedDrivers.map((driver, idx) => (
                            <span 
                              key={idx}
                              className="px-2 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs flex items-center gap-1"
                            >
                              {driver}
                              <button
                                onClick={() => {
                                  const updated = editingRoute.legA!.assignedDrivers.filter((_, i) => i !== idx);
                                  setEditingRoute({ 
                                    ...editingRoute, 
                                    legA: { assignedDrivers: updated }
                                  });
                                }}
                                className="hover:text-blue-900"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <select 
                      className="mt-2 w-full text-sm rounded-lg border px-2 py-1"
                      onChange={(e) => {
                        if (e.target.value) {
                          const current = editingRoute.legA?.assignedDrivers || [];
                          if (!current.includes(e.target.value)) {
                            setEditingRoute({
                              ...editingRoute,
                              legA: { assignedDrivers: [...current, e.target.value] }
                            });
                          }
                          e.target.value = "";
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="">+ Add Driver to Leg A</option>
                      {driverPool.filter(d => d.status === "Active").map(driver => (
                        <option key={driver.id} value={driver.name}>
                          {driver.name} ({driver.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Leg B Drivers */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Leg B Drivers ({editingRoute.legB?.assignedDrivers.length || 0})
                    </label>
                    <div className="border rounded-xl p-3 bg-purple-50/30 max-h-32 overflow-y-auto">
                      {!editingRoute.legB?.assignedDrivers.length ? (
                        <p className="text-sm text-slate-500">No drivers assigned to Leg B</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {editingRoute.legB.assignedDrivers.map((driver, idx) => (
                            <span 
                              key={idx}
                              className="px-2 py-1 rounded-lg bg-purple-100 text-purple-800 text-xs flex items-center gap-1"
                            >
                              {driver}
                              <button
                                onClick={() => {
                                  const updated = editingRoute.legB!.assignedDrivers.filter((_, i) => i !== idx);
                                  setEditingRoute({ 
                                    ...editingRoute, 
                                    legB: { assignedDrivers: updated }
                                  });
                                }}
                                className="hover:text-purple-900"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <select 
                      className="mt-2 w-full text-sm rounded-lg border px-2 py-1"
                      onChange={(e) => {
                        if (e.target.value) {
                          const current = editingRoute.legB?.assignedDrivers || [];
                          if (!current.includes(e.target.value)) {
                            setEditingRoute({
                              ...editingRoute,
                              legB: { assignedDrivers: [...current, e.target.value] }
                            });
                          }
                          e.target.value = "";
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="">+ Add Driver to Leg B</option>
                      {driverPool.filter(d => d.status === "Active").map(driver => (
                        <option key={driver.id} value={driver.name}>
                          {driver.name} ({driver.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                /* Single-Leg Driver Assignment */
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Assigned Drivers ({editingRoute.assignedDrivers?.length || 0})
                  </label>
                  <div className="border rounded-xl p-3 bg-slate-50 max-h-32 overflow-y-auto">
                    {!editingRoute.assignedDrivers?.length ? (
                      <p className="text-sm text-slate-500">No drivers assigned yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {editingRoute.assignedDrivers.map((driver, idx) => (
                          <span 
                            key={idx}
                            className="px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs flex items-center gap-1"
                          >
                            {driver}
                            <button
                              onClick={() => {
                                const updated = editingRoute.assignedDrivers!.filter((_, i) => i !== idx);
                                setEditingRoute({ ...editingRoute, assignedDrivers: updated });
                              }}
                              className="hover:text-slate-900"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <select 
                    className="mt-2 w-full text-sm rounded-lg border px-2 py-1"
                    onChange={(e) => {
                      if (e.target.value) {
                        const current = editingRoute.assignedDrivers || [];
                        if (!current.includes(e.target.value)) {
                          setEditingRoute({
                            ...editingRoute,
                            assignedDrivers: [...current, e.target.value]
                          });
                        }
                        e.target.value = "";
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="">+ Add Driver to Route</option>
                    {driverPool.filter(d => d.status === "Active").map(driver => (
                      <option key={driver.id} value={driver.name}>
                        {driver.name} ({driver.type})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Location Management */}
              <div className="pt-4 border-t">
                <h4 className="font-semibold mb-3">Location Management</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Put-In Locations */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Put-In Locations ({editingRoute.locations.putIns.length})
                    </label>
                    <div className="border rounded-xl p-3 bg-slate-50 space-y-2 max-h-32 overflow-y-auto">
                      {editingRoute.locations.putIns.map((loc, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span>{loc}</span>
                          <button
                            onClick={() => {
                              const updated = editingRoute.locations.putIns.filter((_, i) => i !== idx);
                              setEditingRoute({
                                ...editingRoute,
                                locations: { ...editingRoute.locations, putIns: updated }
                              });
                            }}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add new put-in..."
                      className="mt-2 w-full text-sm rounded-lg border px-3 py-1.5"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newLoc = e.currentTarget.value.trim();
                          if (!editingRoute.locations.putIns.includes(newLoc)) {
                            setEditingRoute({
                              ...editingRoute,
                              locations: {
                                ...editingRoute.locations,
                                putIns: [...editingRoute.locations.putIns, newLoc]
                              }
                            });
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>

                  {/* Take-Out Locations */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Take-Out Locations ({editingRoute.locations.takeOuts.length})
                    </label>
                    <div className="border rounded-xl p-3 bg-slate-50 space-y-2 max-h-32 overflow-y-auto">
                      {editingRoute.locations.takeOuts.map((loc, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span>{loc}</span>
                          <button
                            onClick={() => {
                              const updated = editingRoute.locations.takeOuts.filter((_, i) => i !== idx);
                              setEditingRoute({
                                ...editingRoute,
                                locations: { ...editingRoute.locations, takeOuts: updated }
                              });
                            }}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add new take-out..."
                      className="mt-2 w-full text-sm rounded-lg border px-3 py-1.5"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newLoc = e.currentTarget.value.trim();
                          if (!editingRoute.locations.takeOuts.includes(newLoc)) {
                            setEditingRoute({
                              ...editingRoute,
                              locations: {
                                ...editingRoute.locations,
                                takeOuts: [...editingRoute.locations.takeOuts, newLoc]
                              }
                            });
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Handoff Points (Two-Leg Routes Only) */}
                {editingRoute.type === "Two-Leg" && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Handoff Points ({editingRoute.locations.handoffs?.length || 0})
                    </label>
                    <div className="border rounded-xl p-3 bg-slate-50 space-y-2 max-h-32 overflow-y-auto">
                      {editingRoute.locations.handoffs?.map((loc, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span>{loc}</span>
                          <button
                            onClick={() => {
                              const updated = editingRoute.locations.handoffs!.filter((_, i) => i !== idx);
                              setEditingRoute({
                                ...editingRoute,
                                locations: { ...editingRoute.locations, handoffs: updated }
                              });
                            }}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add new handoff point..."
                      className="mt-2 w-full text-sm rounded-lg border px-3 py-1.5"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newLoc = e.currentTarget.value.trim();
                          const current = editingRoute.locations.handoffs || [];
                          if (!current.includes(newLoc)) {
                            setEditingRoute({
                              ...editingRoute,
                              locations: {
                                ...editingRoute.locations,
                                handoffs: [...current, newLoc]
                              }
                            });
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Pricing Info */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
                <div className="font-semibold text-blue-900 mb-1">💰 Pricing Information</div>
                <p className="text-blue-800">
                  This is the base shuttle cost per vehicle. Total trip cost = (base price × # of vehicles) + any additional fees.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRoute}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Settings Panel ---------------- */

function SettingsPanel() {
  const [uploadedAgreements, setUploadedAgreements] = useState<{ name: string; date: string; size: string }[]>([
    { name: "Vehicle Shuttle Agreement 2024.pdf", date: "2024-01-15", size: "245 KB" },
    { name: "Liability Waiver Form.pdf", date: "2024-01-15", size: "180 KB" },
  ]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const newAgreement = {
        name: file.name,
        date: new Date().toISOString().slice(0, 10),
        size: `${Math.round(file.size / 1024)} KB`
      };
      setUploadedAgreements([...uploadedAgreements, newAgreement]);
      // Reset input
      e.target.value = '';
    }
  }

  function removeAgreement(index: number) {
    if (confirm("Remove this agreement document?")) {
      setUploadedAgreements(uploadedAgreements.filter((_, i) => i !== index));
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">System Settings</h2>

      {/* Legal Agreements Section */}
      <div className="rounded-2xl border bg-white p-4">
        <h3 className="font-semibold mb-3">Legal Agreements & Documents</h3>
        <p className="text-sm text-slate-600 mb-4">
          Upload your company's vehicle shuttle agreements, liability waivers, and other legal documents. 
          These will be available for customers to review and sign before service.
        </p>

        {/* Upload Button */}
        <div className="mb-4">
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer">
            📄 Upload Agreement
            <input 
              type="file" 
              accept=".pdf,.doc,.docx"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <p className="text-xs text-slate-500 mt-2">Accepted formats: PDF, DOC, DOCX</p>
        </div>

        {/* Uploaded Documents List */}
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Document Name</th>
                <th className="text-left font-semibold px-4 py-2">Upload Date</th>
                <th className="text-left font-semibold px-4 py-2">Size</th>
                <th className="text-left font-semibold px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {uploadedAgreements.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    No agreements uploaded yet. Upload your first agreement above.
                  </td>
                </tr>
              ) : (
                uploadedAgreements.map((doc, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-4 py-3 font-medium">{doc.name}</td>
                    <td className="px-4 py-3 text-slate-600">{doc.date}</td>
                    <td className="px-4 py-3 text-slate-600">{doc.size}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button className="text-blue-600 hover:text-blue-800 text-sm">View</button>
                        <button 
                          onClick={() => removeAgreement(idx)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Other Settings */}
      <div className="rounded-2xl border bg-white p-4 space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Scheduling Rules</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Enforce D-1 take-out rule (Leg B must be 1 day before trip ends)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Require van driver on all delivery days</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Warn when moving cars on launch day</span>
            </label>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Notifications</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Email alerts for overbooked days</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="rounded" />
              <span className="text-sm">SMS alerts for urgent deliveries</span>
            </label>
          </div>
        </div>

        <div className="pt-4 border-t">
          <button className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

