import { app } from "./app";
import { resumeJobs } from "./services/ledgerReassign";

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`NamoErp API ready on http://localhost:${port}`));
void resumeJobs().catch((e) => console.error("Could not resume ledger reassignment jobs:", e));
