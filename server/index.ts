import { app } from "./app";
import { resumeJobs } from "./services/ledgerReassign";
import { purgeExpiredCompanies } from "./services/companyTrash";

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`NamoErp API ready on http://localhost:${port}`));
void resumeJobs().catch((e) => console.error("Could not resume ledger reassignment jobs:", e));

// Companies that stayed in the Trash past the restore window are erased: checked at start and then every hour.
const purgeTrash = () => void purgeExpiredCompanies()
  .then((codes) => { if (codes.length) console.log(`Permanently deleted expired companies: ${codes.join(", ")}`); })
  .catch((e) => console.error("Could not empty the company Trash:", e));
purgeTrash();
setInterval(purgeTrash, 60 * 60 * 1000);
