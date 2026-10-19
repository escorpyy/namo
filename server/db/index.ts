import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL set nahi hai. .env.example ko .env me copy karke bharo.");

// Same code local Postgres aur cloud (Supabase/Neon) dono ke liye — sirf DATABASE_URL badlo.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const client = postgres(url, {
  prepare: false, // Supabase transaction pooler (port 6543) ke liye zaroori; local me harmless
  ssl: isLocal ? false : "require",
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
