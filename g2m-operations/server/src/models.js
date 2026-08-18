import mongoose from "mongoose";

const { Schema, model } = mongoose;

/* Every document exposes `id` instead of `_id` so the browser never sees Mongo internals. */
const shape = {
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  },
};

/* ---------------------------------------------------------------- staff */
const StaffSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ["sales", "merchandising", "supervisor"], required: true },
    phone: { type: String, required: true, trim: true },
    pin: { type: String, default: "" },            // 4 digits, field app sign-in
    territory: { type: String, default: "" },
    employeeNo: { type: String, default: "" },
    startDate: { type: String, default: "" },      // YYYY-MM-DD
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, ...shape }
);
StaffSchema.index({ role: 1, status: 1 });

/* --------------------------------------------------------------- stores */
const StoreSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    channel: { type: String, default: "" },        // chain, mini-mart, duka, wholesaler…
    chain: { type: String, default: "" },          // Naivas, Quickmart…
    area: { type: String, default: "" },           // Westlands, CBD…
    address: { type: String, default: "" },
    contact: { type: String, default: "" },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, ...shape }
);
StoreSchema.index({ name: "text", area: "text" });

/* --------------------------------------------------------------- duties */
const DutySchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    role: { type: String, enum: ["sales", "merchandising", "both"], default: "merchandising" },
    requiresPhoto: { type: Boolean, default: false },
    photoLabel: { type: String, default: "" },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, ...shape }
);

/* -------------------------------------------------------------- settings */
const SettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    shiftStart: { type: String, default: "07:00" },
    shiftEnd: { type: String, default: "18:00" },
    currency: { type: String, default: "KES" },
    thresholds: {
      minStrikeRate: { type: Number, default: 0.6 },
      maxIdleMin: { type: Number, default: 75 },
      maxGapMin: { type: Number, default: 75 },
      maxGpsDeltaKm: { type: Number, default: 0.4 },
      minCallMin: { type: Number, default: 15 },
      minShareOfShelf: { type: Number, default: 0.3 },
      minCoverage: { type: Number, default: 0.8 },
      minMarginPct: { type: Number, default: 25 },
    },
    lists: {
      categories: { type: [String], default: [] },
      channels: { type: [String], default: [] },
      chains: { type: [String], default: [] },
      territories: { type: [String], default: [] },
      suppliers: { type: [String], default: [] },
      paymentTerms: { type: [String], default: [] },
      vatTreatments: { type: [String], default: [] },
      storage: { type: [String], default: [] },
      owners: { type: [String], default: [] },
    },
  },
  { timestamps: true, ...shape }
);

/* ---------------------------------------------------------------- plans */
const StopSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
    store: { type: String, default: "" },
    time: { type: String, default: "08:00" },
    duties: { type: [String], default: [] },       // Duty ids
    note: { type: String, default: "" },
  },
  shape
);

const AssignmentSchema = new Schema(
  {
    personId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    personName: { type: String, default: "" },
    role: { type: String, default: "" },
    routeName: { type: String, default: "" },
    stops: { type: [StopSchema], default: [] },
  },
  shape
);

const PlanSchema = new Schema(
  {
    date: { type: String, required: true },        // YYYY-MM-DD
    team: { type: String, enum: ["sales", "merchandising"], required: true },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    assignments: { type: [AssignmentSchema], default: [] },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, ...shape }
);
PlanSchema.index({ date: 1, team: 1 }, { unique: true });

/* --------------------------------------------------------------- visits */
const PhotoSchema = new Schema(
  {
    label: { type: String, default: "Photo" },
    dutyId: { type: String, default: null },
    url: { type: String, required: true },
    thumbUrl: { type: String, default: "" },
    capturedAt: { type: Date, default: Date.now },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    accuracyM: { type: Number, default: null },
    bytes: { type: Number, default: 0 },
  },
  shape
);

const VisitDutySchema = new Schema(
  {
    dutyId: { type: String, required: true },
    label: { type: String, default: "" },
    requiresPhoto: { type: Boolean, default: false },
    photoLabel: { type: String, default: "" },
    done: { type: Boolean, default: false },
  },
  shape
);

const VisitSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: "Plan", default: null },
    stopId: { type: String, default: null },       // the stop subdocument id
    date: { type: String, required: true },
    team: { type: String, required: true },
    personId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    personName: { type: String, default: "" },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", default: null },
    store: { type: String, default: "" },
    address: { type: String, default: "" },
    scheduledTime: { type: String, default: "" },

    status: { type: String, enum: ["pending", "open", "done"], default: "pending" },
    checkInAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    durationMin: { type: Number, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    accuracyM: { type: Number, default: null },
    gpsDeltaKm: { type: Number, default: null },

    duties: { type: [VisitDutySchema], default: [] },
    notes: { type: String, default: "" },
    photos: { type: [PhotoSchema], default: [] },

    // merchandising
    ourFacings: { type: Number, default: null },
    competitorFacings: { type: Number, default: null },
    outOfStockSkus: { type: [String], default: [] },
    verdict: { type: String, enum: ["complete", "issues", "short", null], default: null },

    // sales
    outcome: { type: String, enum: ["order", "no_order", "collection", null], default: null },
    valueKes: { type: Number, default: null },
    orderRef: { type: String, default: "" },
    sageStatus: { type: String, enum: ["na", "queued", "pushed", "failed"], default: "na" },
  },
  { timestamps: true, ...shape }
);
VisitSchema.index({ date: 1, team: 1 });
VisitSchema.index({ date: 1, personId: 1 });

/* -------------------------------------------------------------- products */
const ProductSchema = new Schema(
  {
    name: { type: String, required: true },
    variant: String,
    supplier: { type: String, required: true },
    category: String,
    packSize: String,
    unitsPerCase: Number,
    barcode: String,
    shelfLifeMonths: Number,
    storage: String,
    sampleAvailable: Boolean,

    supplierCost: Number,
    tradePrice: Number,
    chainPrice: Number,
    recommendedRetail: Number,
    distributorMarginPct: Number,
    retailerMarginPct: Number,
    moqCases: Number,
    leadTimeDays: Number,
    paymentTerms: String,
    vatTreatment: String,

    channels: [String],
    targetChains: [String],
    territories: [String],
    knownCompetitor: String,
    competitorShelfPrice: Number,
    expectedMonthlyUnits: Number,

    kebsStandardisationMark: String,
    kraItemClassification: String,
    etrReady: { type: Boolean, default: false },

    targetDate: String,
    firstOrderCases: Number,
    priority: String,
    notes: String,
    researchPack: [String],

    stage: {
      type: String,
      enum: ["submitted", "researching", "approved", "rejected", "listed"],
      default: "submitted",
    },
    submittedBy: String,
    reference: String,
  },
  { timestamps: true, ...shape }
);

export const Staff = model("Staff", StaffSchema);
export const Store = model("Store", StoreSchema);
export const Duty = model("Duty", DutySchema);
export const Settings = model("Settings", SettingsSchema);
export const Plan = model("Plan", PlanSchema);
export const Visit = model("Visit", VisitSchema);
export const Product = model("Product", ProductSchema);
