# NamoErp — Master screens (Account Group se Location tak)

React + Vite + Tailwind + TypeScript (frontend) · Express + Drizzle ORM + PostgreSQL (backend)

## Local setup (Postgres docker me)

```bash
npm install
cp .env.example .env          # DATABASE_URL local wala already set hai
docker compose up -d          # local Postgres
npm run db:push               # tables bana do (schema: server/db/schema)
npm run db:seed               # demo data (dobara chalana safe hai, sirf missing data banta hai)
npm run dev                   # web http://localhost:5173  |  api http://localhost:4000
```

## Purani DB hai to (schema badla hai)

GL ke references ab `ON DELETE RESTRICT` hain (pehle `set null` the). Ek baar `pnpm db:push` chalao, phir `pnpm db:seed` (demo data ke liye).

**Fiscal Year dates:** purane seed me FY 2082/083 ek din galat (2025-07-16) thi. Sahi: **2025-07-17 se 2026-07-16** (Shrawan 1, 2082 se Ashad 32, 2083). Fiscal Year screen se theek kar lo.

## Cloud (Supabase / Neon)

1. `.env` me `DATABASE_URL` ko cloud connection string se replace karo (`.env.example` me example hai).
2. Supabase pooler (port 6543) ke liye `prepare: false` already set hai (`server/db/index.ts`).
3. `db:push` ke liye direct string (port 5432) better hai: `DATABASE_URL_DIRECT` me daalo.
4. `npm run db:push && npm run db:seed`

## Production

```bash
npm run build && npm start    # Express hi dist/ serve karta hai, ek hi port
```

## Keyboard shortcuts (app me F1 dabao)

Enter/Shift+Enter next/prev field · Ctrl+S save · F3 new · F2 edit · Ctrl+Delete delete ·
F4 or / search · Ctrl+↑/↓ prev/next record · Alt+1/2/3 sidebar/form/list focus · Ctrl+B sidebar · Esc cancel

Note: browser `Ctrl+N` ko kabhi-kabhi nahi chhodta, isliye **F3** hamesha kaam karta hai.

## Structure

```
shared/masters.ts   har master ki definition (fields, rules, list columns): server aur UI dono yahin se padhte hain
server/masters.ts   kaunsi Drizzle table, parent, child counts
server/routes/masterFactory.ts   generic CRUD + validation + duplicate check + delete guard
server/routes/party.ts           Party: ek form se GL + Party + Customer/Vendor detail (transaction)
server/routes/openingBalance.ts  Opening Balance grid API: GET / PUT (diff save) / lock / unlock
src/screens/OpeningBalanceScreen.tsx  grid: Dr/Cr, live totals, difference, lock (master engine se alag)
src/screens/MasterScreen.tsx     modes, guards, shortcuts ki saari logic (har master me same)
src/components/     Header, Sidebar, StatusBar, MasterForm, MasterList, Combobox, ConfirmDialog, ShortcutsOverlay
```

## Naya master kaise jodein

1. `shared/masters.ts` me ek entry (fields, columns, unique sets).
2. `server/masters.ts` me table aur counts.
3. `src/components/Sidebar.tsx` me item (id = master key). Bas, screen apne aap ban jati hai.

## Ready screens (20)

Account Group, Account Sub Group, General Ledger, Sub Ledger, Party, Company, Branch, Fiscal Year, User, User Access, Area, Sub Area, Agent, Product Group, Product Sub Group, Unit, Tax Rate, Stock Category, Location, **plus Opening Balance (grid screen)**.

## Abhi ke limits

- Schema ke DB triggers (jaise GL companyId sync) migrations me nahi hain; `db:push` sirf tables/indexes banata hai.
- Login/auth nahi hai: header me pehla active user dikhta hai. Roles (User Access) abhi sirf record hote hain, enforce nahi.
- BS date conversion library ki range BS 2000-2090 (AD 1943-2034) hai; uske bahar sirf AD chalta hai.
- Fiscal Year ka Close / Opening-balance-lock workflow (audit freeze) abhi nahi hai; screen sirf unki status dikhati hai.
- Product (aur Stock Opening Balance, jo Product par tikta hai) aur vouchers abhi "not built yet" hain (sidebar me dim dikhte hain).
