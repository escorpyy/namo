import { useState } from "react";
import { AdvanceBlock } from "../../components/AdvanceBlock";
import CustomerInvoices from "./CustomerInvoices";

// The extra block of the customer panel: advances (with apply / undo on a posted invoice), then the recent invoices and the unpaid total.
type Doc = { id: number; invoiceNumber: string; state: string; fiscalYear: string } | null;

export default function CustomerSide(p: {
  companyId: number; branchId: number; userId: number; customerGLId: number; doc: Doc; fiscalYears?: { code: string; startDate: string; endDate: string }[];
  calendar: "BS" | "AD"; onOpen?: (id: number) => void;
}) {
  const [ver, setVer] = useState(0);
  return (
    <div>
      <AdvanceBlock companyId={p.companyId} userId={p.userId} kind="SALES_INVOICE" generalLedgerId={p.customerGLId} fiscalYears={p.fiscalYears} calendar={p.calendar}
        doc={p.doc ? { id: p.doc.id, number: p.doc.invoiceNumber, state: p.doc.state, fiscalYear: p.doc.fiscalYear } : null} onChanged={() => setVer((v) => v + 1)} />
      <CustomerInvoices key={ver} companyId={p.companyId} branchId={p.branchId} customerGLId={p.customerGLId} docId={p.doc?.id} calendar={p.calendar} onOpen={p.onOpen} />
    </div>
  );
}
