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
import { purchaseRouter } from "./routes/purchase";
import { auditRouter } from "./routes/audit";
import { periodLockRouter } from "./routes/periodLock";
import { codeRulesRouter } from "./routes/codeRules";
import { HttpError, pgError } from "./routes/_util";

export const app = express();
// CORS: off by default. The React app is served by this server in production and proxied by Vite in development, so it is same-origin and
// needs none. To allow another origin, list it: CORS_ORIGIN=https://erp.example.com,https://other.example.com
const corsOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
if (corsOrigins.length) app.use(cors({ origin: corsOrigins }));
// 5 MB: a stock opening save may carry up to 5000 rows (the 100 KB default refused a few thousand; ERP-017).
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); // details stay in the server log, not in the answer
    res.status(500).json({ ok: false, message: "Database not reachable" });
  }
});
app.use("/api/context", contextRouter);
app.use("/api/opening-balance", openingBalanceRouter);
app.use("/api/stock-opening", stockOpeningRouter);
app.use("/api/purchase", purchaseRouter);
app.use("/api/audit", auditRouter);
app.use("/api/period-lock", periodLockRouter);
app.use("/api/code-rules", codeRulesRouter);
for (const { key, router } of masterRouters) app.use(`/api/masters/${key}`, router);

// Production: build ki hui React app yahin se serve hoti hai (npm run build && npm start)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // The body parser's own errors carry a type: too large -> 413, not valid JSON -> 400 (they used to fall through to a 500).
  const parserType = (err as { type?: unknown } | null)?.type;
  if (parserType === "entity.too.large") return res.status(413).json({ message: "The request is too large." });
  if (parserType === "entity.parse.failed" || parserType === "encoding.unsupported" || parserType === "charset.unsupported")
    return res.status(400).json({ message: "The request body is not valid JSON." });
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, field: err.field, code: err.code });
  // A rule the DATABASE refused. Routes normally pre-check, so this is the safety net (races, new code paths). The answer is built from
  // the Postgres code, never from drizzle's wrapper message (that one is the SQL text and its parameters).
  const pg = pgError(err);
  if (pg) {
    // Postgres unique violation (race condition me DB index pakad leta hai)
    if (pg.code === "23505") return res.status(409).json({ message: "Duplicate value: code or description already exists." });
    // Foreign key: deleting something that is used elsewhere, or saving a row whose linked record is missing
    if (pg.code === "23503")
      return res.status(409).json({
        message: req.method === "DELETE" ? "Cannot delete: this record is used elsewhere." : "A linked record does not exist or can no longer be used.",
      });
    // Check constraint or trigger (e.g. the company-integrity rules): the rule's own message is written for people
    if (pg.code === "23514") return res.status(409).json({ message: pg.message });
  }
  // Anything else: details go to the server log only, never to the client (no SQL text, no parameters, no stack)
  console.error(err);
  res.status(500).json({ message: "Server error" });
}
app.use(errorHandler);
