import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Copy, Pencil, Plus, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { purchaseApi, type PDoc, type PListRow, type PLookups } from "../../api";
import { type ComboOption } from "../../components/Combobox";
import { Dialog, useDialog } from "../../components/Dialog";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { COMMON_HELP, HINTS, formEnterKey, money } from "../../components/purchase/Bits";
import { BillHeaderTable, BillRemarksTable, ImportDetailsButton, ImportDetailsDialog, IMPORT_FIELDS, importFilled, LinkedCostsTable, VendorBillsTable, useVendorBills } from "../../components/purchase/BillTables";
import { LinesGrid } from "../../components/purchase/LinesGrid";
import { ProductInfoPanel, useProductInfo } from "../../components/purchase/ProductInfo";
import { RailPanel, useRail } from "../../components/purchase/Rails";
import { useTermsDialog } from "../../components/purchase/TermsDialog";
import { PurchaseInvoiceTotals } from "../../components/purchase/PurchaseInvoiceTotals";
import {
  alwaysShowTerms, blankLine, copyBillForm, dateErr, defaultDate, effectiveQty, isBlankLine, isBlankTerm, lineAmount, lineFromDoc, lineToPayload, str, termFromDoc, termToPayload, trimDec, validateLines, validateTerms,
  type LineRow, type TermRow,
} from "../../lib/purchaseForm";
import { parseDec } from "../../../shared/decimal";
import { isForeign, nprRate } from "../../lib/foreignRate";
import { adToBs } from "../../lib/nepaliDate";
import { previewPurchase } from "../../../shared/purchase-preview";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";
import { useDocScreen, type DocConfig, type DocSnapshot, type Errors } from "./useDocScreen";

export const STATE_TONE: Record<string, "slate" | "green" | "amber" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "amber", REVERSAL: "blue" };
export const OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }, { value: "REVERSAL", label: "Reversal bills" }];
const TAB_ONLY = new Set(["Alt+4", "F4 / /", "Ctrl+↑ / Ctrl+↓", "Alt+1 / Alt+2 / Alt+3", "F3 / Ctrl+N", "Esc"]);
const HELP: [string, string][] = [
  ...COMMON_HELP.filter(([key]) => !TAB_ONLY.has(key)),
  ["F3 / Ctrl+N", "New bill in a new tab"],
  ["F6", "Add a line"],
  ["Esc", "Cancel editing; in the terms dialog, close it"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close this tab"],
  ["Alt+1 / Alt+2", "Sidebar / the form"],
  ["Alt+Shift+H / V / S", "Fold or open the header / vendor / stock panel"],
  ["Alt+Shift+T", "Open header terms"],
  ["Post", "Writes the journal voucher; a posted bill cannot be edited, only reversed"],
];
const BILL_HINTS = [...HINTS.filter((h) => !h.startsWith("F4")), "F6: Add line", "Alt+Shift+T: Terms"];

export interface BForm {
  numberSeriesId: string; docNumber: string; invoiceDate: string; invoiceType: "LOCAL" | "IMPORT"; purchaseType: string; vendorGLId: string; subLedgerId: string; agentId: string; vendorInvoiceNo: string; vendorInvoiceDate: string;
  dueDays: string; dueDate: string; remarks: string; purchaseChallanId: string; purchaseOrderId: string; importCostForBillId: string; importCostAllocationBasis: "VALUE" | "QUANTITY"; importCostTreatment: "CIF" | "LANDED_ONLY"; challanNo: string; orderNo: string;
  lines: LineRow[]; terms: TermRow[]; imp: Record<string, string>;
}
const iso10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");
// One bill, open in one tab of the purchase bill workspace. The workspace owns the lookups, the list and the tabs; this screen owns the document.
// The whole bill is one screen of tables: header, lines, terms, totals.
export interface BillEntryProps extends PurchaseScreenProps {
  tabId: number;
  lookups: PLookups;
  docId: number | null;
  initialForm?: BForm;
  fromChallan: { id: number; n: number } | null;
  hookSnapRef: MutableRefObject<DocSnapshot<BForm> | null>;
  onMeta: (tabId: number, meta: { title: string; dirty: boolean; docId: number | null; state: string | null }) => void;
  onNew: (prefill?: BForm) => void;
  onClose: (tabId: number) => void;
  onListChanged: () => void;
}

export default function PurchaseBillEntry(p: BillEntryProps) {
  const cfg = useMemo<DocConfig<BForm>>(() => ({
    kind: "bills", title: "Purchase Bill", singular: "Bill", statusOptions: OPTIONS,
    emptyForm: (lk) => ({
      numberSeriesId: "", docNumber: "", invoiceDate: defaultDate(lk.fiscalYears.find((y) => y.code === p.fyCode)), invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", vendorGLId: "", subLedgerId: "", agentId: "",
      vendorInvoiceNo: "", vendorInvoiceDate: "", dueDays: "", dueDate: "", remarks: "", purchaseChallanId: "", purchaseOrderId: "", importCostForBillId: "", importCostAllocationBasis: "VALUE", importCostTreatment: "CIF", challanNo: "", orderNo: "",
      lines: [blankLine()], terms: alwaysShowTerms(lk.terms), imp: {},
    }),
    toForm: (d: PDoc, lk) => {
      const prods = new Map(lk.products.map((x) => [String(x.id), x]));
      const imp: Record<string, string> = {};
      for (const k of IMPORT_FIELDS) imp[k.key] = str(d.importDetail?.[k.key]);
      return {
        numberSeriesId: str(d.numberSeriesId), docNumber: str(d.invoiceNumber), invoiceDate: str(d.invoiceDate), invoiceType: d.invoiceType, purchaseType: str(d.purchaseType), vendorGLId: str(d.vendorGLId), subLedgerId: str(d.subLedgerId), agentId: str(d.agentId),
        vendorInvoiceNo: str(d.vendorInvoiceNo), vendorInvoiceDate: str(d.vendorInvoiceDate), dueDays: str(d.dueDays), dueDate: str(d.dueDate), remarks: str(d.remarks),
        purchaseChallanId: str(d.purchaseChallanId), purchaseOrderId: str(d.purchaseOrderId), importCostForBillId: str(d.importCostForBillId), importCostAllocationBasis: d.importCostAllocationBasis === "QUANTITY" ? "QUANTITY" : "VALUE", importCostTreatment: d.importCostTreatment === "LANDED_ONLY" ? "LANDED_ONLY" : "CIF", challanNo: str(d.challanNumber), orderNo: str(d.orderNumber),
        lines: d.lines.length ? d.lines.map((l) => { const row = lineFromDoc(l, prods.get(str(l.productId))); return isForeign(imp.currencyCode) && l.foreignRate != null ? { ...row, rate: trimDec(l.foreignRate) } : row; }) : [blankLine()], terms: (d.terms ?? []).map(termFromDoc), imp,
      };
    },
    toPayload: (f, doc) => {
      const prods = new Map(lkRef.current!.products.map((x) => [String(x.id), x]));
      const masters = new Map(lkRef.current!.terms.map((x) => [String(x.id), x]));
      const nn = (v: string) => v.trim() || null;
      return {
        ...(doc ? {} : { invoiceNumber: f.docNumber.trim() || null, numberSeriesId: f.numberSeriesId ? Number(f.numberSeriesId) : null }),
        invoiceDate: f.invoiceDate, invoiceType: f.invoiceType, purchaseType: f.purchaseType, vendorGLId: Number(f.vendorGLId), subLedgerId: f.subLedgerId ? Number(f.subLedgerId) : null,
        agentId: f.agentId ? Number(f.agentId) : null, vendorInvoiceNo: nn(f.vendorInvoiceNo), vendorInvoiceDate: f.vendorInvoiceDate || null,
        dueDays: f.dueDays ? Number(f.dueDays) : null, dueDate: f.dueDate || null, remarks: nn(f.remarks),
        purchaseChallanId: f.purchaseChallanId ? Number(f.purchaseChallanId) : null, purchaseOrderId: f.purchaseOrderId ? Number(f.purchaseOrderId) : null,
        importCostForBillId: f.importCostForBillId ? Number(f.importCostForBillId) : null, importCostAllocationBasis: f.importCostAllocationBasis, importCostTreatment: f.importCostTreatment,
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => {
          const row = lineToPayload(l, prods.get(l.productId), "bill");
          return f.invoiceType === "IMPORT" && isForeign(f.imp.currencyCode) && !(doc && doc.lines.some((x: any) => x.foreignRate == null)) ? { ...row, rate: null, foreignRate: row.rate } : row; // typed in the invoice currency; the server converts to NPR
        }),
        terms: f.terms.filter((t) => !isBlankTerm(t)).map((t) => termToPayload(t, masters.get(t.termId))),
        importDetail: f.invoiceType === "IMPORT" ? Object.fromEntries(IMPORT_FIELDS.map((k) => [k.key, nn(f.imp[k.key] ?? "")])) : null,
      };
    },
    validate: (f, lk) => {
      const e: Errors = {};
      const vendor = lk.vendors.find((v) => String(v.id) === f.vendorGLId);
      e.invoiceDate = dateErr("Invoice date", f.invoiceDate, true);
      if (!vendor) e.vendorGLId = "Pick the vendor.";
      else if (vendor.requiresSubLedger && !f.subLedgerId) e.subLedgerId = `${vendor.code} needs a sub ledger.`;
      e.vendorInvoiceDate = dateErr("Vendor invoice date", f.vendorInvoiceDate);
      e.dueDate = dateErr("Due date", f.dueDate);
      if (f.dueDays && !/^\d{1,4}$/.test(f.dueDays)) e.dueDays = "Due days must be a whole number.";
      if (f.importCostForBillId && !f.purchaseType.startsWith("SERVICE_PURCHASE_")) e.importCostForBillId = "Only a service purchase bill can be linked to a goods bill as a cost.";
      for (const k of IMPORT_FIELDS) if (f.invoiceType === "IMPORT" && k.kind === "date") { const m = dateErr(k.label, f.imp[k.key] ?? ""); if (m) e[`imp.${k.key}`] = m; }
      const live = f.lines.filter((l) => !isBlankLine(l)).length;
      f.lines.forEach((l, i) => { if (!isBlankLine(l) && !l.locationId && lk.products.find((x) => String(x.id) === l.productId)?.type === "STOCK") e[`L.${i}.more`] = `Line ${i + 1}: choose the location (More).`; });
      // location, batch and dates are one "More" cell on a bill line
      for (const [key, message] of Object.entries(validateLines(f.lines, new Map(lk.products.map((x) => [String(x.id), x])), { rate: "required", tracking: true }))) {
        const more = key.replace(/^(L\.\d+)\.(lc|b|mf|ex)$/, "$1.more");
        if (!e[more]) e[more] = message;
      }
      Object.assign(e, validateTerms(f.terms, new Map(lk.terms.map((x) => [String(x.id), x])), live));
      return e;
    },
    editable: (d) => !d.isPosted, deletable: (d) => !d.isPosted, label: (d) => d.invoiceNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const lkRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const restored = useRef(p.hookSnapRef.current);
  const localDirty = useRef(false);
  const s = useDocScreen<BForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, {
    setStatus: p.setStatus, dirtyRef: localDirty, externalMessage: p.externalMessage, hints: BILL_HINTS,
    sharedLookups: p.lookups, skipList: true, initialDocId: p.docId, initialForm: p.initialForm, restore: restored.current, snapshotRef: p.hookSnapRef,
    onNew: () => p.onNew(), onDeleted: () => p.onClose(p.tabId), onListChanged: p.onListChanged,
  });
  lkRef.current = s.lookups;
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  const masters = useMemo(() => new Map((lk?.terms ?? []).map((x) => [String(x.id), x])), [lk]);
  // an IMPORT bill in a foreign currency is typed in it (an older saved bill without foreign rates stays in NPR)
  const foreignOn = !!f && f.invoiceType === "IMPORT" && isForeign(f.imp.currencyCode) && !(doc && doc.lines.some((l: any) => l.foreignRate == null));
  const invoicePreview = useMemo(() => {
    if (!f) return previewPurchase([], [], new Map(), true);
    const liveLines = f.lines.filter((line) => !isBlankLine(line));
    let incompleteLines = liveLines.length === 0;
    const pricedLines = liveLines.flatMap((line, index) => {
      const product = products.get(line.productId);
      const qty = effectiveQty(line, product);
      const invalidAltUnit = (!!line.altQty && !line.altUnitId) || (!!line.altUnitId && !line.altQty);
      const validQty = !!qty && !!parseDec(qty) && parseDec(qty)!.n > 0n;
      const validRate = !!line.rate && !!parseDec(line.rate);
      if (!product || invalidAltUnit || !validQty || !validRate) {
        incompleteLines = true;
        return [];
      }
      const amount = lineAmount(foreignOn && isForeign(f.imp.currencyCode) ? { ...line, rate: nprRate(line.rate, f.imp.exchangeRate) } : line, product); // a foreign-currency bill is priced in NPR like the server does
      if (!amount) {
        incompleteLines = true;
        return [];
      }
      return [{ lineNumber: index + 1, basicAmount: amount }];
    });
    const terms = f.terms.filter((term) => !isBlankTerm(term)).map((term) => ({
      rowKey: term.key, termId: Number(term.termId), lineNumber: term.lineNumber, calcType: term.calcType,
      rate: term.rate, inputAmount: term.inputAmount, isOverridden: term.isOverridden, overrideAmount: term.overrideAmount,
    }));
    const termMasters = new Map((lk?.terms ?? []).map((term) => [term.id, term]));
    return previewPurchase(pricedLines, terms, termMasters, incompleteLines);
  }, [f, lk?.terms, products, foreignOn]);

  const liveLines = f ? f.lines.filter((line) => !isBlankLine(line)).length : 0;
  const T = useTermsDialog({
    lines: f?.lines ?? [], terms: f?.terms ?? [], lookups: lk, products, masters, readOnly: ro, saved: !!doc, preview: invoicePreview,
    savedBasic: doc ? str(doc.basicAmount) : undefined, savedNet: doc ? str(doc.totalAmount) : undefined,
    errors: s.errors, clearError: s.clearError, setTerms: (terms) => s.patch({ terms }), contextKey: String(p.companyId), noun: "bill",
  });
  const termsRef = useRef(T);
  termsRef.current = T;
  const updateBillLines = (nextLines: LineRow[]) => T.updateLines(nextLines, (change) => s.patch(change));
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key !== "F6" || T.isOpen || !f || ro) return;
      event.preventDefault();
      window.dispatchEvent(new Event("namo:bill-add-line"));
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [T.isOpen, f, ro]);

  // ---- tab state: title / unsaved mark for the tab strip (Alt+, / Alt+. move between tabs, Alt+W closes this one; the workspace handles those) ----
  useEffect(() => { p.onMeta(p.tabId, { title: doc ? String(doc.invoiceNumber) : "New bill", dirty: s.dirty, docId: doc?.id ?? null, state: doc?.state ?? null }); }, [doc?.invoiceNumber, doc?.id, doc?.state, s.dirty, p.tabId]);
  // A save that found a problem in the import details opens their dialog and puts the cursor on the field; every other field is already on screen
  // and useDocScreen moves the cursor to it.
  useEffect(() => {
    const first = Object.keys(s.errors).find((key) => s.errors[key] && key.startsWith("imp."));
    if (!first) return;
    setImportDlg((current) => current ?? "manual");
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus(), 60);
  }, [s.errors]);

  // What a confirmed challan gives a bill: vendor, agent, links and the lines still to be billed (nothing is saved).
  const loadChallan = async (challanId: number) => {
    const [b, c] = await Promise.all([purchaseApi.billFromChallan(p.companyId, challanId), purchaseApi.get("challans", challanId, p.companyId)]);
    const prods = new Map(lk!.products.map((x) => [String(x.id), x]));
    const lines: LineRow[] = (b.lines as any[]).map((l) => ({
      ...blankLine({ productId: str(l.productId), qty: trimDec(l.qty), rate: trimDec(l.rate), locationId: str(l.locationId), batchNo: str(l.batchNo), manufactureDate: iso10(l.manufactureDate), expiryDate: iso10(l.expiryDate), purchaseOrderLineId: str(l.purchaseOrderLineId), challanLineId: str(l.challanLineId), link: "From challan" }),
      unitId: prods.get(str(l.productId))?.baseUnitId ? "" : str(l.unitId),
    }));
    return {
      number: String(c.challanNumber),
      fields: { vendorGLId: str(b.vendorGLId), subLedgerId: str(b.subLedgerId), agentId: str(b.agentId), purchaseChallanId: str(b.purchaseChallanId), purchaseOrderId: str(b.purchaseOrderId), challanNo: str(c.challanNumber), orderNo: str(c.orderNumber), lines } satisfies Partial<BForm>,
    };
  };
  // start from a confirmed challan (the "Create Bill" button on the challan screen)
  const started = useRef(0);
  useEffect(() => {
    if (restored.current || !p.fromChallan || !lk || started.current === p.fromChallan.n) return;
    started.current = p.fromChallan.n;
    (async () => {
      try {
        const r = await loadChallan(p.fromChallan!.id);
        s.newDoc({ ...cfg.emptyForm(lk), ...r.fields });
        s.flash(`Bill started from challan ${r.number}: enter the vendor's invoice details and check the rates`, "info");
      } catch (e) { s.flash((e as Error).message, "err"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fromChallan, lk]);

  // the Challan field of the header: confirmed challans a new goods bill can start from; picking one prefills the bill
  const dialog = useDialog();
  const [challans, setChallans] = useState<PListRow[]>([]);
  useEffect(() => {
    if (s.doc) return;
    purchaseApi.list("challans", { companyId: p.companyId, branchId: p.branchId, fiscalYear: "", status: "CONFIRMED" }).then((r) => setChallans(r.rows)).catch(() => setChallans([]));
  }, [p.companyId, p.branchId, s.doc?.id, s.mode, f?.purchaseChallanId]);
  const challanOptions = useMemo<ComboOption[]>(() => {
    const vendor = f?.vendorGLId ?? "";
    const rows = challans.filter((c) => String(c.id) === f?.purchaseChallanId || !vendor || String(c.vendorGLId) === vendor);
    return rows.map((c) => ({ value: String(c.id), label: `${c.challanNumber} — ${c.vendorName} (${String(c.challanDate ?? "").slice(0, 10)})${c.orderNumber ? ` · ${c.orderNumber}` : ""}` }));
  }, [challans, f?.vendorGLId, f?.purchaseChallanId]);
  const pickChallan = async (value: string) => {
    if (!f) return;
    if (!value) { // cleared: the lines stay, but they are no longer tied to a challan
      s.patch({ purchaseChallanId: "", purchaseOrderId: "", challanNo: "", orderNo: "", lines: f.lines.map((l) => (l.challanLineId || l.purchaseOrderLineId || l.link ? { ...l, challanLineId: "", purchaseOrderLineId: "", link: "" } : l)) });
      return;
    }
    if (value === f.purchaseChallanId) return;
    if (f.lines.some((l) => !isBlankLine(l)) && !(await dialog.confirm("Replace the lines already entered with the lines of this challan?", { confirmLabel: "Replace" }))) return;
    try {
      const r = await loadChallan(Number(value));
      s.patch(r.fields);
      s.clearError("vendorGLId", "subLedgerId", "lines");
      s.flash(`Filled from challan ${r.number}: check the rates`, "info");
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-field="invoiceDate"]')?.focus(), 60);
    } catch (e) { s.flash((e as Error).message, "err"); }
  };

  // posted goods bills that a service bill can be linked to as a cost
  const [mains, setMains] = useState<PListRow[]>([]);
  // Import details live in a dialog ("auto": opened by the flow after the header, "manual": by the user or a save error); the linked-costs table stays collapsed until opened.
  const [importDlg, setImportDlg] = useState<null | "auto" | "manual">(null);
  const [landedOpen, setLandedOpen] = useState(false);
  const importAutoOpened = useRef(false);
  const landedAutoOpened = useRef(false);
  useEffect(() => {
    purchaseApi.list("bills", { companyId: p.companyId, branchId: p.branchId, fiscalYear: "", status: "POSTED" }).then((r) => setMains(r.rows.filter((x) => !x.isAdditional))).catch((e: Error) => s.flash(e.message, "err", "Could not load the bill list"));
  }, [p.companyId, p.branchId, s.doc?.id, s.mode]);
  const sourceTargetOpts = useMemo<ComboOption[]>(() => {
    const o = mains.filter((x) => String(x.purchaseType).startsWith("GOODS_PURCHASE_") && !x.isAdditional)
      .map((x) => ({ value: String(x.id), label: `${x.invoiceNumber} — ${x.vendorName} (${x.invoiceDate})${x.invoiceType === "IMPORT" ? " · import" : " · local"}` }));
    if (f?.importCostForBillId && !o.some((x) => x.value === f.importCostForBillId) && doc?.importCostTarget) {
      o.push({ value: f.importCostForBillId, label: doc.importCostTarget.invoiceNumber });
    }
    return o;
  }, [mains, f?.importCostForBillId, doc]);

  // The import dialog opens by itself once per bill; switching away from "Import" (or another bill) arms it again.
  useEffect(() => {
    if (!f || f.invoiceType !== "IMPORT") { importAutoOpened.current = false; setImportDlg(null); }
  }, [f?.invoiceType, doc?.id]);
  // Auto-expand the linked-costs table once when the open document already carries data.
  useEffect(() => {
    const sources = doc?.importCostSources?.length ?? 0;
    if (sources > 0 && !landedAutoOpened.current) { setLandedOpen(true); landedAutoOpened.current = true; }
    if (!doc) landedAutoOpened.current = false;
  }, [doc?.id, doc?.importCostSources?.length]);

  // the vendor's other bills: shown in a table, and the source of the "vendor invoice number already used" warning in the header
  const vendorBills = useVendorBills(p.companyId, p.branchId, f?.vendorGLId ?? "", doc?.id, f?.vendorInvoiceNo ?? "");

  const vendor = lk?.vendors.find((v) => String(v.id) === (f?.vendorGLId ?? ""));
  // side panels: the header folds to the left edge; the vendor and stock panels to the right edge (the right ones start folded on a narrow window)
  const narrow = typeof window !== "undefined" && window.innerWidth < 1400;
  const [hdrOff, setHdrOff] = useState(false);
  const [headerFlowPassed, setHeaderFlowPassed] = useState(false);
  const [vendOff, setVendOff] = useRail("bill.vendor", narrow);
  const [stockOff, setStockOff] = useRail("bill.stock", narrow);
  useEffect(() => { setHdrOff(!!doc); setHeaderFlowPassed(!!doc); }, [doc?.id]);
  const [focusLine, setFocusLine] = useState(0); // the line the cursor is on drives the stock panel
  const focusProduct = f?.lines[focusLine]?.productId ?? "";
  const productInfo = useProductInfo(p.companyId, p.branchId, focusProduct);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyT") {
        e.preventDefault();
        termsRef.current.open({ scope: "header" });
        return;
      }
      const set = e.code === "KeyH" ? setHdrOff : e.code === "KeyV" ? setVendOff : e.code === "KeyS" ? setStockOff : null;
      if (!set) return;
      e.preventDefault();
      if (e.code === "KeyH") setHeaderFlowPassed(true);
      set((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setVendOff, setStockOff]);
  // a save that found a problem in a header field opens the header again, so the field can be seen and fixed
  useEffect(() => {
    if (Object.entries(s.errors).some(([key, message]) => message && !/^(L\.|T\.|imp\.)/.test(key) && key !== "lines" && key !== "terms")) setHdrOff(false);
  }, [s.errors]);

  const state = doc?.state as string | undefined;
  const reversible = !!doc && state === "POSTED";
  // A new draft from this bill (any state): same vendor, lines and charges, dated today, without the vendor invoice no., links or declaration no.
  const canCopy = !!doc && !!lk && state !== "REVERSAL" && !doc.mainBillId;
  const copyBill = () => { if (doc && lk) p.onNew(copyBillForm(cfg.toForm(doc, lk), cfg.emptyForm(lk).invoiceDate)); };
  const actions = doc && (
    <>
      {canCopy && <button data-nav className="btn" onClick={copyBill}><Copy size={14} /> Copy</button>}
      {state === "DRAFT" && <button data-nav className="btn btn-primary" onClick={() => s.run({ action: "post", title: "Post bill?", body: <>Post <b className="font-mono">{doc.invoiceNumber}</b> for <b>{money(doc.totalAmount)}</b>? A balanced journal voucher is written and the bill can no longer be edited or deleted — only reversed.</>, button: "Post", done: (d) => `Posted ${d.invoiceNumber}${d.journalVoucher ? ` (voucher ${d.journalVoucher.voucherNumber})` : ""}` })}><Send size={14} /> Post</button>}
      {reversible && (
        <button data-nav className="btn" onClick={() => {
          const fy = lk?.fiscalYears.find((y) => y.code === p.fyCode);
          const d0 = defaultDate(fy), rv = { date: d0 < doc.invoiceDate ? doc.invoiceDate : d0, reason: "" };
          s.run({
            action: "reverse", title: "Reverse bill?", button: "Reverse", danger: true, payload: rv,
            body: (
              <div className="space-y-2">
                <p>Reverse <b className="font-mono">{doc.invoiceNumber}</b>? A reversal bill and a reversing voucher are posted; the original stays on record.</p>
                <label className="block text-[12px]">Reversal date (AD, YYYY-MM-DD)<input data-af defaultValue={rv.date} onChange={(e) => { rv.date = e.target.value.trim(); }} className="fld mt-0.5" /></label>
                <label className="block text-[12px]">Reason<input defaultValue="" maxLength={200} onChange={(e) => { rv.reason = e.target.value; }} className="fld mt-0.5" /></label>
              </div>
            ),
            done: (d) => `Reversed ${d.invoiceNumber}`,
          });
        }}><RotateCcw size={14} /> Reverse</button>
      )}
    </>
  );

  const notice = doc && (
    <div className="mx-5 mt-3 space-y-1">
      {state === "POSTED" && <p className="text-[12px] rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">Posted{doc.journalVoucher ? <> as voucher <b className="font-mono">{doc.journalVoucher.voucherNumber}</b> dated {doc.journalVoucher.voucherDate}</> : ""}. A posted bill cannot be edited; reverse it to correct it.</p>}
      {state === "REVERSED" && <p className="text-[12px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">Reversed by <b className="font-mono">{doc.reversedBy?.invoiceNumber}</b>.</p>}
      {state === "REVERSAL" && <p className="text-[12px] rounded-lg border border-cobalt-200 bg-cobalt-50 px-3 py-2 text-cobalt-800">This is the reversal of <b className="font-mono">{doc.reversalOf?.invoiceNumber}</b>.</p>}
    </div>
  );

  if (!f || !lk) {
    return (
      <>
        <section data-purchase-document className="grid min-h-0 flex-1 place-items-center text-slate-500">Loading…</section>
        {s.dialog && <Dialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      </>
    );
  }

  // "Header completed": nothing outside the lines, terms and import details is still failing validation.
  const headerDone = Object.entries(cfg.validate(f, lk)).every(([key, message]) => !message || /^(L\.|T\.|imp\.)/.test(key) || key === "lines" || key === "terms");
  const autoImport = f.invoiceType === "IMPORT" && !ro && headerDone && !importAutoOpened.current && importFilled(f.imp) === 0;
  const onFormKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && !e.shiftKey && headerDone && target.closest("[data-bill-header-field]")) {
      const headerFields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-bill-header-field]"));
      const usable = (field: HTMLElement) => Array.from(field.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])"))
        .some((el) => !("disabled" in el && (el as HTMLInputElement).disabled) && el.getClientRects().length > 0);
      const last = [...headerFields].reverse().find(usable);
      if (target.closest("[data-bill-header-field]") === last) {
        e.preventDefault();
        e.stopPropagation();
        setHeaderFlowPassed(true);
        setHdrOff(true);
        const selector = autoImport ? '[data-nav="import-details"]' : '[data-field="L.0.p"]';
        window.setTimeout(() => document.querySelector<HTMLElement>(`${selector}:not(:disabled)`)?.focus(), 50);
        return;
      }
    }
    formEnterKey(e);
  };
  const closeImport = () => {
    const auto = importDlg === "auto";
    setImportDlg(null);
    // after the automatic dialog the flow carries on to the lines; after a manual one the cursor goes back to the button
    window.setTimeout(() => ((auto ? document.querySelector<HTMLElement>('[data-field="L.0.p"]:not(:disabled)') : null) ?? document.querySelector<HTMLElement>('[data-nav="import-details"]'))?.focus(), 40);
  };
  const signedMoney = (value: string) => {
    const formatted = money(value);
    return formatted.startsWith("-") ? `− ${formatted.slice(1)}` : formatted;
  };
  const enteredHeaderTerms = f.terms.filter((term) => !isBlankTerm(term) && !masters.get(term.termId)?.isProductwise);
  const termsTooltip = enteredHeaderTerms.length
    ? enteredHeaderTerms.map((term) => {
      const master = masters.get(term.termId);
      return `${master?.name ?? master?.code ?? term.termId}: ${signedMoney(T.signedOf(term))}`;
    }).join("\n")
    : "No header terms entered.";
  const termsError = s.err("terms");

  return (
    <>
      <section data-purchase-document className="flex min-h-0 min-w-0 flex-1 flex-col">
        {notice && <div className="shrink-0 px-5 pt-3">{notice}</div>}

        <div data-zone="form" onKeyDown={onFormKeyDown} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {hdrOff ? (
            <div className="flex min-h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-slate-200 bg-slate-50 px-3 text-left text-[12px] text-slate-600">
              <button type="button" data-nav="bill-header-summary" aria-expanded={false} onClick={() => setHdrOff(false)}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left hover:text-cobalt-800">
                <span className="shrink-0 font-semibold text-ink">{vendor?.name ?? "Vendor"}</span><span aria-hidden>·</span>
                <span className="truncate">Inv {doc ? String(doc.invoiceNumber) : f.docNumber || "—"}</span><span aria-hidden>·</span>
                <span className="shrink-0">{p.calendar === "BS" ? (adToBs(f.invoiceDate) ?? f.invoiceDate) || "—" : f.invoiceDate || "—"}</span><span aria-hidden>·</span>
                <span className="shrink-0">{f.invoiceType === "IMPORT" ? "Import" : "Local"}</span><span aria-hidden>·</span>
                <span className="shrink-0">Due {f.dueDate ? (p.calendar === "BS" ? adToBs(f.dueDate) ?? f.dueDate : f.dueDate) : f.dueDays ? `${f.dueDays} days` : "—"}</span>
              </button>
              {f.invoiceType === "IMPORT" && <ImportDetailsButton imp={f.imp} readOnly={ro} autoOpen={autoImport} onOpen={(auto) => { importAutoOpened.current = true; setImportDlg(auto ? "auto" : "manual"); }} />}
              <span className="shrink-0 text-[11px] text-cobalt-700">Alt+Shift+H</span>
            </div>
          ) : (
            <div className="shrink-0 border-b border-slate-200 bg-white">
              <BillHeaderTable wide f={f} lk={lk} doc={doc} readOnly={ro} companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} calendar={p.calendar}
                err={s.err} patch={s.patch} clearError={s.clearError} costTargets={sourceTargetOpts} mains={mains} duplicate={vendorBills.duplicate}
                onInvoiceType={(type) => { if (type !== "IMPORT") setImportDlg(null); }} challanOptions={challanOptions} onPickChallan={pickChallan} />
              {f.invoiceType === "IMPORT" && (
                <div className="shrink-0 border-t border-slate-100 px-2 py-1">
                  <ImportDetailsButton imp={f.imp} readOnly={ro} autoOpen={autoImport} onOpen={(auto) => { importAutoOpened.current = true; setImportDlg(auto ? "auto" : "manual"); }} />
                </div>
              )}
            </div>
          )}

          {headerFlowPassed && <div className="flex min-h-0 min-w-0 flex-1"
            onFocusCapture={(e) => { const row = (e.target as HTMLElement).closest<HTMLElement>('[data-grid="lines"] [data-row]'); if (row?.dataset.row !== undefined) setFocusLine(Number(row.dataset.row)); }}>
          <div className="lg-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-auto [scrollbar-gutter:stable]">
          {/* the lines take whatever height is left */}
          <section aria-label="Lines" className="flex min-h-[240px] flex-1 flex-col [&>.lg-card]:min-h-0 [&>.lg-card]:flex-1 [&>.lg-card]:rounded-none">
            <LinesGrid fill kind="bill" currency={foreignOn ? f.imp.currencyCode.trim().toUpperCase() : undefined} lines={f.lines} onChange={updateBillLines} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} lockProducts
              onOpenTerms={(index, continueAfterApply) => T.open({ scope: "line", lineNumber: T.lineNumberAt(index), lineIndex: index, continueAfterApply })} termSummary={T.lineSummary} />
          </section>
          <div className="shrink-0"><BillRemarksTable f={f} readOnly={ro} companyId={p.companyId} err={s.err} patch={s.patch} /></div>

          {!!doc && String(doc.purchaseType ?? "").startsWith("GOODS_PURCHASE_") && (
            <div className="shrink-0"><LinkedCostsTable doc={doc} open={landedOpen} onToggle={() => setLandedOpen((v) => !v)} /></div>
          )}
          {ro && doc && doc.lines.some((l) => Number(l.landedAmount) !== 0) && (
            <p className="shrink-0 text-[12px] text-slate-600">Landed cost per line: {doc.lines.map((l) => `${l.lineNumber}: ${money(l.landedAmount)}`).join(" · ")}</p>
          )}

          </div>

          <div className="flex min-h-0 shrink-0 flex-col items-end gap-3">
            <RailPanel side="right" label="Vendor and recent bills" collapsed={vendOff} onToggle={() => setVendOff((v) => !v)} shortcut="Alt+Shift+V" className="min-h-0 flex-[3_1_0]">
              {vendor && (
                <div className="space-y-0.5 border-b border-slate-200 px-3 py-2 text-[12.5px]">
                  <div className="truncate font-semibold text-ink" title={vendor.name}>{vendor.name}</div>
                  <div className="flex justify-between text-slate-600"><span>Code</span><span className="font-mono">{vendor.code}</span></div>
                  {vendor.paymentTermDays != null && <div className="flex justify-between text-slate-600"><span>Payment terms</span><span>{vendor.paymentTermDays} days</span></div>}
                  {vendor.creditLimit && <div className="flex justify-between text-slate-600"><span>Credit limit</span><span className="tabular-nums">{money(vendor.creditLimit)}</span></div>}
                </div>
              )}
              <div className="[&_.lg-card-head]:hidden [&_.lg-card]:rounded-none [&_.lg-card]:border-0">
                <VendorBillsTable lookups={lk} vendorGLId={f.vendorGLId} vendorBills={vendorBills} doc={doc} companyId={p.companyId} userId={p.userId} calendar={p.calendar} />
              </div>
            </RailPanel>
            <RailPanel side="right" label="Stock and last rates" collapsed={stockOff} onToggle={() => setStockOff((v) => !v)} shortcut="Alt+Shift+S" className="min-h-0 flex-[2_1_0]">
              <ProductInfoPanel lookups={lk} productId={focusProduct} info={productInfo} calendar={p.calendar} />
            </RailPanel>
          </div>
          </div>}
        </div>

        <footer className="tape flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-3">
          <div className="min-w-0 flex-1">
            <PurchaseInvoiceTotals compact summaryOnly preview={invoicePreview} savedDoc={doc} readOnly={ro} hasLines={liveLines > 0}
              termsAction={<button type="button" data-nav="header-terms" onClick={() => T.open({ scope: "header" })} title={`Alt+Shift+T · ${termsTooltip}`}
                aria-label={`${ro ? "View terms" : "Net terms"}, ${signedMoney(T.header.amount)}. Alt+Shift+T opens header terms.`}
                className={`flex flex-col items-start text-left ${termsError ? "text-rose-300 hover:text-rose-200" : "text-white hover:text-brass"}`}>
                <span className="flex items-center gap-2 text-[12px] font-medium text-white/65">{ro ? "View terms" : "Net terms"}{termsError && <span className="font-semibold text-rose-300">Required</span>}</span>
                <span className="flex items-center gap-2 text-[15px] font-semibold leading-tight tabular-nums">{signedMoney(T.header.amount)} <span className="kbd">Alt+Shift+T</span></span>
              </button>} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!ro ? (
              <>
                <button data-nav className="btn btn-primary" disabled={s.saving} onClick={() => void s.save()}><Save size={14} /> {s.mode === "edit" ? "Update" : "Save"} <span className="kbd">Ctrl+S</span></button>
                <button data-nav className="btn" onClick={() => (doc ? s.cancel() : s.guard(() => p.onClose(p.tabId)))}><X size={14} /> Cancel {doc && <span className="kbd">Esc</span>}</button>
              </>
            ) : (
              <>
                <button data-nav className="btn" onClick={() => p.onNew()}><Plus size={14} /> New <span className="kbd">F3</span></button>
                <button data-nav className="btn" disabled={!doc || !cfg.editable(doc)} onClick={s.edit}><Pencil size={14} /> Edit <span className="kbd">F2</span></button>
                <button data-nav className="btn" disabled={!doc || !cfg.deletable(doc)} onClick={s.askDelete}><Trash2 size={14} /> Delete <span className="kbd">Ctrl+Del</span></button>
                {actions && <><span className="tape-sep mx-1" />{actions}</>}
              </>
            )}
          </div>
        </footer>
      </section>

      {T.node}
      {importDlg && (
        <ImportDetailsDialog imp={f.imp} readOnly={ro} calendar={p.calendar} err={s.err} onClose={closeImport}
          onSave={(imp) => { s.patch({ imp }); s.clearError(...IMPORT_FIELDS.map((k) => `imp.${k.key}`)); closeImport(); }} />
      )}
      {s.dialog && <Dialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      {s.help && <ShortcutsOverlay onClose={() => s.setHelp(false)} shortcuts={HELP} />}
    </>
  );
}
