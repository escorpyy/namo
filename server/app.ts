import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { contextRouter } from "./routes/context";
import { masterRouters } from "./masters";
import { openingBalanceRouter } from "./routes/openingBalance";
import { stockOpeningRouter } from "./routes/stockOpening";
import { HttpError } from "./routes/_util";

export const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});
app.use("/api/context", contextRouter);
app.use("/api/opening-balance", openingBalanceRouter);
app.use("/api/stock-opening", stockOpeningRouter);
for (const { key, router } of masterRouters) app.use(`/api/masters/${key}`, router);

// Production: build ki hui React app yahin se serve hoti hai (npm run build && npm start)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, field: err.field });
  // Postgres unique violation (race condition me DB index pakad leta hai)
  if ((err as { code?: string }).code === "23505")
    return res.status(409).json({ message: "Duplicate value: code or description already exists." });
  // Kisi aur table me use ho raha hai (FK) to friendly message
  if ((err as { code?: string }).code === "23503")
    return res.status(409).json({ message: "Cannot delete: this record is used elsewhere." });
  console.error(err);
  res.status(500).json({ message: (err as Error).message ?? "Server error" });
});

