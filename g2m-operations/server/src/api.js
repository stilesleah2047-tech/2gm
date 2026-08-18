import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Staff, Store, Duty, Settings, Plan, Visit, Product } from "./models.js";

const router = express.Router();

/* ============================================================
   Helpers
   ============================================================ */

const TZ = process.env.TZ_NAME || "Africa/Nairobi";

/** Today in Nairobi, as YYYY-MM-DD, regardless of where the server sits. */
export function localDate(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}
function localTime(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.hour}:${p.minute}`;
}

function haversineKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((n) => typeof n === "number")) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 1000) / 1000;
}

const ok = (res, body) => res.json(body ?? { ok: true });
const bad = (res, code, message) => res.status(code).json({ message });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  bad(res, 500, err.message || "Something went wrong on the server");
});

/** The settings document, created with sensible Kenyan defaults the first time it is asked for. */
async function settings() {
  let s = await Settings.findOne({ key: "global" });
  if (!s) {
    s = await Settings.create({
      key: "global",
      lists: {
        categories: ["Dried fruits", "Air fresheners", "Roll-ons", "Other consumer goods"],
        channels: ["Independent dukas", "Mini-marts", "Wholesalers", "Supermarket chains", "Petrol forecourts"],
        chains: ["Naivas", "Quickmart", "Carrefour", "Chandarana", "Cleanshelf", "Foodplus"],
        territories: ["Westlands", "CBD", "Parklands", "Karen / Langata", "Eastlands", "Thika Road", "Embakasi", "Ngong Road"],
        suppliers: [],
        paymentTerms: ["On delivery", "14 days", "30 days", "45 days", "60 days"],
        vatTreatments: ["16% standard", "Zero rated", "Exempt"],
        storage: ["Ambient", "Cool and dry", "Chilled"],
        owners: ["Operations manager", "Sales manager", "Managing director"],
      },
    });
  }
  return s;
}

/* ============================================================
   Settings
   ============================================================ */

router.get("/settings", wrap(async (_req, res) => ok(res, await settings())));

router.put("/settings", wrap(async (req, res) => {
  const s = await settings();
  const { shiftStart, shiftEnd, currency, thresholds, lists } = req.body || {};
  if (shiftStart) s.shiftStart = shiftStart;
  if (shiftEnd) s.shiftEnd = shiftEnd;
  if (currency) s.currency = currency;
  if (thresholds) s.thresholds = { ...s.thresholds.toObject(), ...thresholds };
  if (lists) s.lists = { ...s.lists.toObject(), ...lists };
  await s.save();
  ok(res, s);
}));

/* Option lists for the product form, read straight from settings. */
router.get("/reference/onboarding", wrap(async (_req, res) => {
  const s = await settings();
  ok(res, s.lists);
}));

/* ============================================================
   Staff
   ============================================================ */

router.get("/staff", wrap(async (req, res) => {
  const q = {};
  if (req.query.role) q.role = req.query.role;
  if (req.query.status) q.status = req.query.status;
  ok(res, { staff: await Staff.find(q).sort({ name: 1 }) });
}));

router.post("/staff", wrap(async (req, res) => {
  const { name, phone, role } = req.body || {};
  if (!name?.trim()) return bad(res, 400, "A name is required");
  if (!phone?.trim()) return bad(res, 400, "A phone number is required — it is how they sign in");
  if (!["sales", "merchandising", "supervisor"].includes(role))
    return bad(res, 400, "Pick a role");
  const clash = await Staff.findOne({ phone: phone.trim() });
  if (clash) return bad(res, 409, `${clash.name} already uses that phone number`);
  ok(res, await Staff.create({ ...req.body, name: name.trim(), phone: phone.trim() }));
}));

router.patch("/staff/:id", wrap(async (req, res) => {
  const s = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!s) return bad(res, 404, "No such employee");
  ok(res, s);
}));

router.delete("/staff/:id", wrap(async (req, res) => {
  const used = await Visit.countDocuments({ personId: req.params.id });
  if (used) return bad(res, 409, "This person has visits on record — deactivate them instead");
  await Staff.findByIdAndDelete(req.params.id);
  ok(res);
}));

/* ============================================================
   Stores
   ============================================================ */

router.get("/stores", wrap(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.q) q.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  ok(res, { stores: await Store.find(q).sort({ name: 1 }).limit(500) });
}));
router.get("/reference/stores", wrap(async (_req, res) =>
  ok(res, { stores: await Store.find({ status: "active" }).sort({ name: 1 }).limit(500) })));

router.post("/stores", wrap(async (req, res) => {
  if (!req.body?.name?.trim()) return bad(res, 400, "A store name is required");
  const clash = await Store.findOne({ name: req.body.name.trim() });
  if (clash) return bad(res, 409, "A store with that name already exists");
  ok(res, await Store.create({ ...req.body, name: req.body.name.trim() }));
}));

router.patch("/stores/:id", wrap(async (req, res) => {
  const s = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!s) return bad(res, 404, "No such store");
  ok(res, s);
}));

router.delete("/stores/:id", wrap(async (req, res) => {
  const used = await Visit.countDocuments({ storeId: req.params.id });
  if (used) return bad(res, 409, "This store has visits on record — deactivate it instead");
  await Store.findByIdAndDelete(req.params.id);
  ok(res);
}));

/* ============================================================
   Duties
   ============================================================ */

const STANDARD_DUTIES = [
  { label: "Shelf check", role: "merchandising", requiresPhoto: true, photoLabel: "Shelf as found", order: 1 },
  { label: "Restock from back store", role: "merchandising", requiresPhoto: true, photoLabel: "Shelf after restock", order: 2 },
  { label: "Planogram reset", role: "merchandising", requiresPhoto: true, photoLabel: "Planogram after reset", order: 3 },
  { label: "Price tag audit", role: "merchandising", requiresPhoto: true, photoLabel: "Price tags", order: 4 },
  { label: "Competitor check", role: "merchandising", requiresPhoto: true, photoLabel: "Competitor shelf", order: 5 },
  { label: "Expiry and damages check", role: "merchandising", requiresPhoto: false, order: 6 },
  { label: "Put up point of sale material", role: "merchandising", requiresPhoto: true, photoLabel: "POS in place", order: 7 },
  { label: "Take order", role: "sales", requiresPhoto: false, order: 8 },
  { label: "Collect payment", role: "sales", requiresPhoto: false, order: 9 },
  { label: "Pitch a new listing", role: "sales", requiresPhoto: false, order: 10 },
  { label: "Count stock on hand", role: "sales", requiresPhoto: false, order: 11 },
];

router.get("/duties", wrap(async (req, res) => {
  const q = { status: "active" };
  if (req.query.role) q.role = { $in: [req.query.role, "both"] };
  ok(res, { duties: await Duty.find(q).sort({ order: 1, label: 1 }) });
}));
router.get("/reference/duties", wrap(async (_req, res) =>
  ok(res, { duties: await Duty.find({ status: "active" }).sort({ order: 1 }) })));

router.post("/duties", wrap(async (req, res) => {
  if (!req.body?.label?.trim()) return bad(res, 400, "A name for the duty is required");
  ok(res, await Duty.create({ ...req.body, label: req.body.label.trim() }));
}));

router.post("/duties/standard", wrap(async (_req, res) => {
  const existing = await Duty.countDocuments();
  if (existing) return bad(res, 409, "Duties already exist — add them one at a time instead");
  ok(res, { duties: await Duty.insertMany(STANDARD_DUTIES) });
}));

router.patch("/duties/:id", wrap(async (req, res) => {
  const d = await Duty.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!d) return bad(res, 404, "No such duty");
  ok(res, d);
}));

router.delete("/duties/:id", wrap(async (req, res) => {
  await Duty.findByIdAndDelete(req.params.id);
  ok(res);
}));

/* ============================================================
   Plans — and turning a published plan into visits
   ============================================================ */

router.get("/plans", wrap(async (req, res) => {
  const { date, team } = req.query;
  if (!date || !team) return bad(res, 400, "A date and a team are required");
  const plan = await Plan.findOne({ date, team });
  ok(res, plan || { date, team, status: "draft", assignments: [] });
}));

/** Create the visit records a published plan implies, and clear away stops that were removed. */
async function materialise(plan) {
  const dutyDocs = await Duty.find({ status: "active" });
  const dutyById = new Map(dutyDocs.map((d) => [d.id, d]));
  const storeIds = plan.assignments.flatMap((a) => a.stops.map((s) => s.storeId).filter(Boolean));
  const stores = await Store.find({ _id: { $in: storeIds } });
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const keep = [];
  for (const a of plan.assignments) {
    for (const stop of a.stops) {
      if (!stop.store?.trim()) continue;
      const store = stop.storeId ? storeById.get(String(stop.storeId)) : null;
      const duties = stop.duties.map((id) => {
        const d = dutyById.get(String(id));
        return {
          dutyId: String(id),
          label: d?.label || "Duty",
          requiresPhoto: !!d?.requiresPhoto,
          photoLabel: d?.photoLabel || "",
          done: false,
        };
      });

      const existing = await Visit.findOne({ planId: plan._id, stopId: String(stop._id) });
      if (existing) {
        // Never overwrite work already recorded in the field.
        existing.scheduledTime = stop.time;
        existing.store = stop.store;
        existing.storeId = stop.storeId || null;
        existing.address = store?.address || existing.address;
        if (existing.status === "pending") existing.duties = duties;
        await existing.save();
        keep.push(existing.id);
      } else {
        const created = await Visit.create({
          planId: plan._id,
          stopId: String(stop._id),
          date: plan.date,
          team: plan.team,
          personId: a.personId,
          personName: a.personName,
          storeId: stop.storeId || null,
          store: stop.store,
          address: store?.address || "",
          scheduledTime: stop.time,
          duties,
        });
        keep.push(created.id);
      }
    }
  }
  await Visit.deleteMany({
    planId: plan._id,
    status: "pending",
    _id: { $nin: keep },
  });
}

router.post("/plans", wrap(async (req, res) => {
  const { date, team, status, assignments } = req.body || {};
  if (!date || !team) return bad(res, 400, "A date and a team are required");

  const clean = (assignments || []).map((a) => ({
    personId: a.personId,
    personName: a.personName,
    role: a.role,
    routeName: a.routeName || "",
    stops: (a.stops || [])
      .filter((s) => s.store?.trim())
      .map((s) => ({
        // keep the id when the client already knows it, so visits survive an edit
        ...(String(s.id || "").match(/^[a-f\d]{24}$/i) ? { _id: s.id } : {}),
        storeId: s.storeId || null,
        store: s.store.trim(),
        time: s.time || "08:00",
        duties: s.duties || [],
        note: s.note || "",
      })),
  }));

  const plan = await Plan.findOneAndUpdate(
    { date, team },
    {
      date, team,
      status: status === "published" ? "published" : "draft",
      assignments: clean,
      ...(status === "published" ? { publishedAt: new Date() } : {}),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  if (plan.status === "published") await materialise(plan);
  ok(res, plan);
}));

router.post("/plans/copy", wrap(async (req, res) => {
  const { fromDate, toDate, team } = req.body || {};
  if (!fromDate || !toDate || !team) return bad(res, 400, "A source date, a target date and a team are required");
  const source = await Plan.findOne({ date: fromDate, team });
  if (!source || !source.assignments.length)
    return bad(res, 404, `Nothing was planned for ${fromDate}`);

  const assignments = source.assignments.map((a) => ({
    personId: a.personId,
    personName: a.personName,
    role: a.role,
    routeName: a.routeName,
    stops: a.stops.map((s) => ({
      storeId: s.storeId, store: s.store, time: s.time, duties: s.duties, note: s.note,
    })),
  }));

  const plan = await Plan.findOneAndUpdate(
    { date: toDate, team },
    { date: toDate, team, status: "draft", assignments },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  ok(res, plan);
}));

/* ============================================================
   Monitoring — the shape the ops screens read
   ============================================================ */

router.get("/field/day", wrap(async (req, res) => {
  const date = req.query.date || localDate();
  const team = req.query.team;
  if (!team) return bad(res, 400, "A team is required");

  const s = await settings();
  const [plan, visits] = await Promise.all([
    Plan.findOne({ date, team }),
    Visit.find({ date, team }).sort({ scheduledTime: 1 }),
  ]);

  const byPerson = new Map();
  const ensure = (id, name, route) => {
    const key = String(id);
    if (!byPerson.has(key))
      byPerson.set(key, { id: key, name: name || "Unknown", route: route || "", plannedCalls: [], visits: [] });
    return byPerson.get(key);
  };

  (plan?.assignments || []).forEach((a) => {
    const p = ensure(a.personId, a.personName, a.routeName);
    a.stops.forEach((st) => p.plannedCalls.push({ time: st.time, store: st.store, storeId: st.storeId }));
  });

  visits.forEach((v) => {
    const p = ensure(v.personId, v.personName, "");
    if (v.status === "pending") return;             // not started; the ghost marker covers it
    p.visits.push({
      id: v.id,
      time: v.checkInAt ? localTime(v.checkInAt) : v.scheduledTime,
      store: v.store,
      storeId: v.storeId,
      durationMin: v.status === "open" ? null : v.durationMin,
      gpsDeltaKm: v.gpsDeltaKm,
      outcome: v.outcome,
      valueKes: v.valueKes,
      orderRef: v.orderRef,
      sageStatus: v.sageStatus,
      verdict: v.verdict,
      ourFacings: v.ourFacings,
      competitorFacings: v.competitorFacings,
      outOfStockSkus: v.outOfStockSkus,
      notes: v.notes,
      photos: v.photos.map((ph) => ({
        id: ph.id, url: ph.url, thumbUrl: ph.thumbUrl || ph.url,
        label: ph.label, capturedAt: ph.capturedAt,
      })),
    });
  });

  const outOfStock = [];
  visits.forEach((v) =>
    (v.outOfStockSkus || []).forEach((sku) =>
      outOfStock.push({
        store: v.store, sku, reportedBy: v.personName,
        time: v.checkInAt ? localTime(v.checkInAt) : v.scheduledTime,
      })));

  ok(res, {
    date,
    generatedAt: new Date().toISOString(),
    shift: { start: s.shiftStart, end: s.shiftEnd },
    planStatus: plan?.status || "none",
    people: [...byPerson.values()],
    outOfStock,
  });
}));

/* ============================================================
   Field app
   ============================================================ */

/** Sign in with the phone number the manager entered, plus the PIN if one was set. */
router.post("/field/sign-in", wrap(async (req, res) => {
  const { phone, pin } = req.body || {};
  const person = await Staff.findOne({ phone: (phone || "").trim(), status: "active" });
  if (!person) return bad(res, 404, "No active employee uses that number");
  if (person.pin && person.pin !== String(pin || "")) return bad(res, 401, "That PIN does not match");
  ok(res, { person: { id: person.id, name: person.name, role: person.role } });
}));

router.get("/field/me/day", wrap(async (req, res) => {
  const personId = req.query.personId || req.get("x-person-id");
  if (!personId) return bad(res, 400, "Sign in first");
  const date = req.query.date || localDate();

  const person = await Staff.findById(personId);
  if (!person) return bad(res, 404, "That employee is no longer on file");

  const plan = await Plan.findOne({ date, team: person.role, status: "published" });
  const visits = await Visit.find({ date, personId }).sort({ scheduledTime: 1 });

  ok(res, {
    person: { id: person.id, name: person.name, role: person.role },
    date,
    published: !!plan,
    stops: visits.map((v) => ({
      id: v.id, store: v.store, storeId: v.storeId, time: v.scheduledTime,
      address: v.address, status: v.status, checkInAt: v.checkInAt,
      notes: v.notes, ourFacings: v.ourFacings, competitorFacings: v.competitorFacings,
      outOfStockSkus: v.outOfStockSkus,
      duties: v.duties.map((d) => ({
        id: d.dutyId, dutyId: d.dutyId, label: d.label,
        requiresPhoto: d.requiresPhoto, photoLabel: d.photoLabel, done: d.done,
      })),
      photos: v.photos.map((ph) => ({
        id: ph.id, url: ph.url, thumbUrl: ph.thumbUrl || ph.url, label: ph.label,
      })),
    })),
  });
}));

router.post("/field/visits/:id/check-in", wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return bad(res, 404, "That stop is no longer on the plan");
  if (v.status === "done") return bad(res, 409, "This call is already closed");

  const { lat, lng, accuracyM } = req.body || {};
  v.checkInAt = new Date();
  v.status = "open";
  if (typeof lat === "number") { v.lat = lat; v.lng = lng; v.accuracyM = accuracyM ?? null; }

  if (v.storeId) {
    const store = await Store.findById(v.storeId);
    v.gpsDeltaKm = haversineKm({ lat: v.lat, lng: v.lng }, { lat: store?.lat, lng: store?.lng });
  }
  await v.save();
  ok(res, { id: v.id, status: v.status, checkInAt: v.checkInAt, gpsDeltaKm: v.gpsDeltaKm });
}));

router.patch("/field/visits/:id", wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return bad(res, 404, "That stop is no longer on the plan");
  const b = req.body || {};

  if (Array.isArray(b.duties)) {
    // The field app identifies a duty by its catalogue id; accept the
    // sub-document id too so an older client still works.
    const done = new Map();
    b.duties.forEach((d) => {
      if (d?.dutyId != null) done.set(String(d.dutyId), !!d.done);
      if (d?.id != null) done.set(String(d.id), !!d.done);
    });
    v.duties = v.duties.map((d) => ({
      ...d.toObject(),
      done: done.get(String(d.dutyId)) ?? done.get(String(d._id)) ?? d.done,
    }));
  }
  if (b.notes !== undefined) v.notes = b.notes || "";
  if (b.outOfStockSkus !== undefined) v.outOfStockSkus = b.outOfStockSkus || [];
  if (b.ourFacings !== undefined) v.ourFacings = b.ourFacings;
  if (b.competitorFacings !== undefined) v.competitorFacings = b.competitorFacings;
  if (b.outcome !== undefined) v.outcome = b.outcome;
  if (b.valueKes !== undefined) v.valueKes = b.valueKes;
  if (b.orderRef !== undefined) v.orderRef = b.orderRef;

  await v.save();
  ok(res, { id: v.id });
}));

router.post("/field/visits/:id/complete", wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return bad(res, 404, "That stop is no longer on the plan");
  if (!v.checkInAt) return bad(res, 409, "Check in before closing the call");

  const s = await settings();
  v.completedAt = new Date();
  v.durationMin = Math.max(1, Math.round((v.completedAt - v.checkInAt) / 60000));
  v.status = "done";

  if (v.team === "merchandising") {
    const short = v.durationMin < s.thresholds.minCallMin;
    const issues = (v.outOfStockSkus || []).length > 0 ||
      v.duties.some((d) => !d.done) ||
      (v.ourFacings != null && v.competitorFacings != null &&
        v.ourFacings + v.competitorFacings > 0 &&
        v.ourFacings / (v.ourFacings + v.competitorFacings) < s.thresholds.minShareOfShelf);
    v.verdict = short ? "short" : issues ? "issues" : "complete";
  } else if (!v.outcome) {
    v.outcome = "no_order";
  }
  if (v.team === "sales" && v.outcome === "order" && v.sageStatus === "na") v.sageStatus = "queued";

  await v.save();
  ok(res, { id: v.id, status: v.status, durationMin: v.durationMin, verdict: v.verdict });
}));

/* -------------------------------------------------------- photo upload */

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve("uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
      cb(null, `${localDate()}-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(file.mimetype?.startsWith("image/") ? null : new Error("Only images can be uploaded"), true),
});

router.post("/field/visits/:id/photos", upload.single("photo"), wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return bad(res, 404, "That stop is no longer on the plan");
  if (!req.file) return bad(res, 400, "No photo came through");

  const photo = {
    label: req.body.label || "Photo",
    dutyId: req.body.dutyId || null,
    url: `/uploads/${req.file.filename}`,
    thumbUrl: `/uploads/${req.file.filename}`,
    capturedAt: req.body.capturedAt ? new Date(req.body.capturedAt) : new Date(),
    lat: req.body.lat ? Number(req.body.lat) : null,
    lng: req.body.lng ? Number(req.body.lng) : null,
    accuracyM: req.body.accuracyM ? Number(req.body.accuracyM) : null,
    bytes: req.file.size,
  };
  v.photos.push(photo);
  if (v.status === "pending") v.status = "open";
  await v.save();

  const saved = v.photos[v.photos.length - 1];
  ok(res, { id: saved.id, url: saved.url, thumbUrl: saved.thumbUrl, label: saved.label });
}));

/** Remove a call entirely — used when a stop was assigned by mistake. */
router.delete("/field/visits/:id", wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return ok(res);
  for (const photo of v.photos) {
    fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(photo.url))).catch(() => {});
  }
  await v.deleteOne();
  ok(res);
}));

router.delete("/field/visits/:id/photos/:photoId", wrap(async (req, res) => {
  const v = await Visit.findById(req.params.id);
  if (!v) return bad(res, 404, "That stop is no longer on the plan");
  const photo = v.photos.id(req.params.photoId);
  if (photo) {
    const file = path.join(UPLOAD_DIR, path.basename(photo.url));
    fs.promises.unlink(file).catch(() => {});
    photo.deleteOne();
    await v.save();
  }
  ok(res);
}));

/* ============================================================
   Products
   ============================================================ */

router.get("/onboarding/products", wrap(async (req, res) => {
  const q = req.query.stage ? { stage: req.query.stage } : {};
  ok(res, { products: await Product.find(q).sort({ createdAt: -1 }).limit(200) });
}));

router.post("/onboarding/products", wrap(async (req, res) => {
  const b = req.body || {};
  const p = b.product || {};
  const c = b.commercials || {};
  if (!p.name?.trim()) return bad(res, 400, "A product name is required");
  if (!p.supplier?.trim()) return bad(res, 400, "A supplier is required");

  const doc = await Product.create({
    ...p, ...c, ...(b.market || {}), ...(b.compliance || {}), ...(b.launch || {}),
    researchPack: b.researchPack || [],
    submittedBy: b.submittedBy || "",
    reference: "P-" + Date.now().toString(36).toUpperCase(),
  });

  // Add the supplier to the picklist so it is there next time.
  if (p.supplier) {
    const s = await settings();
    if (!s.lists.suppliers.includes(p.supplier.trim())) {
      s.lists.suppliers.push(p.supplier.trim());
      await s.save();
    }
  }
  ok(res, { id: doc.id, reference: doc.reference });
}));

router.patch("/onboarding/products/:id", wrap(async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!p) return bad(res, 404, "No such product");
  ok(res, p);
}));

/* ============================================================
   Overview counts, used by the setup screen
   ============================================================ */

router.get("/overview", wrap(async (_req, res) => {
  const today = localDate();
  const [staff, stores, duties, products, plansToday] = await Promise.all([
    Staff.countDocuments({ status: "active" }),
    Store.countDocuments({ status: "active" }),
    Duty.countDocuments({ status: "active" }),
    Product.countDocuments(),
    Plan.countDocuments({ date: today, status: "published" }),
  ]);
  ok(res, { staff, stores, duties, products, plansToday, today });
}));

export default router;
