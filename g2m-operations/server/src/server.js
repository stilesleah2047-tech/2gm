import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "node:path";
import fs from "node:fs";
import api from "./api.js";

const PORT = process.env.PORT || 4000;
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/g2m";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve("uploads");
const WEB_DIR = process.env.WEB_DIR || path.resolve("../web/dist");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

// Photos taken in the field.
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));

app.use("/api", api);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? "connected" : "down" }));

// Serve the built dashboard when it exists, so everything runs on one origin.
if (fs.existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR));
  app.get("*", (req, res, next) =>
    req.path.startsWith("/api") ? next() : res.sendFile(path.join(WEB_DIR, "index.html")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Something went wrong on the server" });
});

console.log("Connecting to MongoDB at", MONGO_URL.replace(/\/\/[^@]*@/, "//***@"));

mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 8000 })
  .then(() => {
    console.log("Connected.");
    app.listen(PORT, () => {
      console.log(`G2M operations service on http://localhost:${PORT}`);
      if (!fs.existsSync(WEB_DIR))
        console.log("Dashboard not built yet — run `npm run dev` in ../web, or `npm run build` to serve it from here.");
    });
  })
  .catch((err) => {
    console.error("\nCould not reach MongoDB —", err.message);
    console.error("Start mongod locally, or set MONGO_URL in server/.env to your Atlas connection string.\n");
    process.exit(1);
  });
