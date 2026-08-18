/**
 * Smoke test — run against a running service to prove the whole flow works.
 *
 *   cd server && npm run verify
 *   BASE=https://ops.g2m.co.ke npm run verify     # or point it anywhere
 *
 * It creates one employee, one store, one duty, plans a day, publishes it,
 * checks in, ticks the duty, closes the call, reads the ops view back, and
 * then deletes everything it made. Nothing it touches is left behind.
 */

const BASE = (process.env.BASE || "http://localhost:4000").replace(/\/$/, "");
const API = BASE + "/api";
const TAG = "VERIFY-" + Date.now().toString(36).toUpperCase();

let passed = 0;
let madeVisit = null;
const made = { staff: [], stores: [], duties: [] };

const ok = (label) => { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); };
const fail = (label, detail) => {
  console.error("  \x1b[31m✗\x1b[0m " + label);
  if (detail) console.error("    " + detail);
  throw new Error(label);
};

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message || text.slice(0, 120)}`);
  return json;
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

async function run() {
  console.log(`\nChecking ${BASE}\n`);

  /* -------------------------------------------------- service is up */
  const health = await call("GET", "/health");
  if (health.db !== "connected") fail("MongoDB is connected", `health says db is "${health.db}"`);
  ok("service is up and MongoDB is connected");

  /* -------------------------------------------------- reference data */
  const settings = await call("GET", "/settings");
  if (!settings.shiftStart) fail("settings exist");
  ok(`settings load (day runs ${settings.shiftStart}–${settings.shiftEnd})`);

  const person = (await call("POST", "/staff", {
    name: TAG + " Merchandiser", role: "merchandising",
    phone: "+254700" + String(Date.now()).slice(-6), territory: "Test route",
  }));
  made.staff.push(person.id);
  ok("employee created");

  const store = await call("POST", "/stores", {
    name: TAG + " Store", area: "Test area", channel: "Mini-marts",
    lat: -1.2921, lng: 36.8219,
  });
  made.stores.push(store.id);
  ok("store created, with coordinates");

  const duty = await call("POST", "/duties", {
    label: TAG + " shelf check", role: "merchandising",
    requiresPhoto: true, photoLabel: "Shelf as found",
  });
  made.duties.push(duty.id);
  ok("duty created");

  /* -------------------------------------------------- plan and publish */
  await call("POST", "/plans", {
    date: today, team: "merchandising", status: "draft",
    assignments: [{
      personId: person.id, personName: person.name, role: "merchandising",
      routeName: "Verification route",
      stops: [{ storeId: store.id, store: store.name, time: "09:00", duties: [duty.id] }],
    }],
  });
  const draft = await call("GET", `/plans?date=${today}&team=merchandising`);
  if (draft.status !== "draft") fail("plan saves as a draft");
  ok("plan saved as a draft");

  let mine = await call("GET", `/field/me/day?staffId=${person.id}&date=${today}`);
  if ((mine.stops || []).length !== 0) fail("a draft stays invisible to the field", "stops appeared before publishing");
  ok("a draft is invisible to the field");

  await call("POST", "/plans", {
    date: today, team: "merchandising", status: "published",
    assignments: [{
      personId: person.id, personName: person.name, role: "merchandising",
      routeName: "Verification route",
      stops: [{ storeId: store.id, store: store.name, time: "09:00", duties: [duty.id] }],
    }],
  });
  ok("plan published");

  mine = await call("GET", `/field/me/day?staffId=${person.id}&date=${today}`);
  if ((mine.stops || []).length !== 1) fail("publishing creates the visit", `saw ${mine.stops?.length} stops`);
  const visit = mine.stops[0];
  madeVisit = visit.id;
  if (!visit.duties?.length) fail("the duty came through to the field app");
  ok("publishing created the visit, duty attached");

  /* -------------------------------------------------- the field day */
  const ci = await call("POST", `/field/visits/${visit.id}/check-in`,
    { lat: -1.2921, lng: 36.8219, accuracyM: 12 });
  if (ci.gpsDeltaKm == null) fail("distance from the shop is measured", "no gpsDeltaKm returned");
  if (ci.gpsDeltaKm > 0.05) fail("distance is measured correctly", `got ${ci.gpsDeltaKm} km standing at the door`);
  ok(`checked in, ${Math.round(ci.gpsDeltaKm * 1000)} m from the recorded shop position`);

  await call("PATCH", `/field/visits/${visit.id}`, {
    duties: [{ dutyId: duty.id, done: true }],
    notes: "Left by the verification script.",
    outOfStockSkus: ["Test SKU 100g"],
    ourFacings: 8, competitorFacings: 12,
  });
  const after = await call("GET", `/field/me/day?staffId=${person.id}&date=${today}`);
  const ticked = after.stops[0].duties.find((d) => d.dutyId === duty.id);
  if (!ticked?.done) fail("ticking a duty saves", "the duty came back unticked");
  ok("duty tick saved");

  const done = await call("POST", `/field/visits/${visit.id}/complete`, {});
  if (done.status !== "done") fail("the call closes");
  if (!done.verdict) fail("a verdict is worked out on closing");
  ok(`call closed, verdict "${done.verdict}", ${done.durationMin} min`);

  /* -------------------------------------------------- the ops view */
  const day = await call("GET", `/field/day?date=${today}&team=merchandising`);
  const row = (day.people || []).find((p) => p.id === person.id);
  if (!row) fail("the person appears on the ops screen");
  if (!row.plannedCalls?.length) fail("the assigned route shows as planned calls");
  if (!row.visits?.length) fail("the completed call shows on the ops screen");
  if (!day.outOfStock?.length) fail("the out-of-stock report reaches the ops screen");
  ok("ops view shows the route, the call and the shelf gap");

  console.log(`\n\x1b[32m${passed} checks passed.\x1b[0m The install works end to end.\n`);
}

async function cleanUp() {
  try {
    if (madeVisit) await call("DELETE", `/field/visits/${madeVisit}`).catch(() => {});
    await call("POST", "/plans", { date: today, team: "merchandising", status: "draft", assignments: [] });
    for (const id of made.staff) await call("DELETE", `/staff/${id}`);
    for (const id of made.stores) await call("DELETE", `/stores/${id}`);
    for (const id of made.duties) await call("DELETE", `/duties/${id}`);
    console.log("Test records removed.\n");
  } catch (e) {
    console.warn(`\nCould not remove every test record (${e.message}).`);
    console.warn(`Anything left over is named ${TAG}.\n`);
  }
}

run()
  .then(cleanUp)
  .catch(async (err) => {
    console.error(`\n\x1b[31mStopped:\x1b[0m ${err.message}\n`);
    await cleanUp();
    process.exit(1);
  });
