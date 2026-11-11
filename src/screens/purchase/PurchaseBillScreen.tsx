import { NumberField } from "../../components/purchase/NumberField";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Copy, Pencil, Plus, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { purchaseApi, type PDoc, type PListRow, type PLookups } from "../../api";
import { Combobox, type ComboOption } from "../../components/Combobox";
import { Dialog } from "../../components/Dialog";
import { ShortcutsOverlay } from "../../components/ShortcutsOverlay";
import { COMMON_HELP, DocHeader, Field, FormSection, HINTS, Pill, focusStep, formEnterKey, money } from "../../components/purchase/Bits";
import { EmptyPanel, HeaderSummary, SidePanel, VendorPanel, usePanelState } from "../../components/purchase/BillPanels";
import { DateField, TextField, VendorFields } from "../../components/purchase/HeadFields";
import { LinesGrid, TermsGrid } from "../../components/purchase/LinesGrid";
import { PurchaseInvoiceTotals } from "../../components/purchase/PurchaseInvoiceTotals";
import {
  addDaysIso, alwaysShowTerms, blankLine, copyBillForm, dateErr, defaultDate, dialogTermRows, dialogTermsToApply, effectiveQty, isBlankLine, isBlankTerm, isZeroTerm, lineAmount, lineFromDoc, lineToPayload, str, termFromDoc, termToPayload, trimDec, validateLines, validateTerms,
  type LineRow, type TermRow,
} from "../../lib/purchaseForm";
import { parseDec } from "../../../shared/decimal";
import { previewPurchase } from "../../../shared/purchase-preview";
import { formatImportCost } from "../../../shared/import-costing";
import { toMicro } from "../../../shared/purchase-calculation";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";
import { useDocScreen, type DocConfig, type DocSnapshot, type Errors } from "./useDocScreen";

const IMPORT_FIELDS: { key: string; label: string; kind: "text" | "date" | "mode"; max?: number }[] = [
  { key: "customsDeclarationNo", label: "Customs Declaration No", kind: "text", max: 30 }, { key: "customsDeclarationDate", label: "Declaration Date", kind: "date" },
  { key: "customsOffice", label: "Customs Office", kind: "text", max: 100 }, { key: "countryOfOrigin", label: "Country of Origin", kind: "text", max: 50 },
  { key: "lcNo", label: "LC No", kind: "text", max: 30 }, { key: "lcDate", label: "LC Date", kind: "date" }, { key: "lcBankName", label: "LC Bank", kind: "text", max: 100 },
  { key: "transportMode", label: "Transport Mode", kind: "mode" }, { key: "blAwbNo", label: "BL / AWB No", kind: "text", max: 30 }, { key: "blAwbDate", label: "BL / AWB Date", kind: "date" },
  { key: "transporterName", label: "Transporter", kind: "text", max: 100 }, { key: "vehicleNo", label: "Vehicle No", kind: "text", max: 30 }, { key: "lrNo", label: "LR No", kind: "text", max: 30 }, { key: "lrDate", label: "LR Date", kind: "date" },
  { key: "importPermitNo", label: "Import Permit No", kind: "text", max: 30 }, { key: "importPermitDate", label: "Permit Date", kind: "date" },
  // Optional foreign currency: amounts on the bill stay in NPR; these record how they were converted.
  { key: "currencyCode", label: "Foreign Currency (optional, e.g. USD)", kind: "text", max: 3 }, { key: "exchangeRate", label: "Exchange Rate (NPR per 1 unit)", kind: "text", max: 20 }, { key: "foreignInvoiceAmount", label: "Invoice Total in Foreign Currency", kind: "text", max: 20 },
];
const PURCHASE_TYPES = [
  { value: "GOODS_PURCHASE_OTHERS", label: "Goods — Others" }, { value: "GOODS_PURCHASE_CAPITAL", label: "Goods — Capital" },
  { value: "SERVICE_PURCHASE_OTHERS", label: "Service — Others" }, { value: "SERVICE_PURCHASE_CAPITAL", label: "Service — Capital" },
];
export const STATE_TONE: Record<string, "slate" | "green" | "amber" | "blue"> = { DRAFT: "slate", POSTED: "green", REVERSED: "amber", REVERSAL: "blue" };
export const OPTIONS = [{ value: "DRAFT", label: "Draft" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }, { value: "REVERSAL", label: "Reversal bills" }];
const TAB_ONLY = new Set(["Alt+4", "F4 / /", "Ctrl+↑ / Ctrl+↓", "Alt+1 / Alt+2 / Alt+3", "F3 / Ctrl+N", "Esc"]);
const HELP: [string, string][] = [
  ...COMMON_HELP.filter(([key]) => !TAB_ONLY.has(key)),
  ["F3 / Ctrl+N", "New bill in a new tab"],
  ["Ctrl+S (new bill, header open)", "Finish the header and go to the lines"],
  ["Esc", "Cancel editing; in the terms dialog, close it"],
  ["Alt+[ / Alt+]", "Collapse / expand the header panel (left) / vendor panel (right)"],
  ["Alt+, / Alt+.", "Previous / next tab"],
  ["Alt+W", "Close this tab"],
  ["Alt+1 / Alt+2", "Sidebar / the form"],
  ["Post", "Writes the journal voucher; a posted bill cannot be edited, only reversed"],
];
const BILL_HINTS = [...HINTS.filter((h) => !h.startsWith("F4")), "Alt+[ ]: Side panels"];

export interface BForm {
  numberSeriesId: string; docNumber: string; invoiceDate: string; invoiceType: "LOCAL" | "IMPORT"; purchaseType: string; vendorGLId: string; subLedgerId: string; agentId: string; vendorInvoiceNo: string; vendorInvoiceDate: string;
  dueDays: string; dueDate: string; remarks: string; purchaseChallanId: string; purchaseOrderId: string; importCostForBillId: string; importCostAllocationBasis: "VALUE" | "QUANTITY"; importCostTreatment: "CIF" | "LANDED_ONLY"; challanNo: string; orderNo: string;
  lines: LineRow[]; terms: TermRow[]; imp: Record<string, string>;
}
type TermDialog = { scope: "header" } | { scope: "line"; lineNumber: number; lineIndex: number; continueAfterApply?: () => void };
const iso10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");
export type Stage = "header" | "lines";
// Errors of the header form: everything that is not a line, a term or the "lines" / "terms" summary.
const isHeaderKey = (key: string) => !/^(L\.|T\.)/.test(key) && key !== "lines" && key !== "terms";

// One bill, open in one tab of the purchase bill workspace. The workspace owns the lookups, the list and the tabs; this screen owns the document.
export interface BillEntryProps extends PurchaseScreenProps {
  tabId: number;
  lookups: PLookups;
  docId: number | null;
  initialForm?: BForm;
  fromChallan: { id: number; n: number } | null;
  hookSnapRef: MutableRefObject<DocSnapshot<BForm> | null>;
  stageRef: MutableRefObject<Stage | null>;
  onMeta: (tabId: number, meta: { title: string; dirty: boolean; docId: number | null }) => void;
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
        lines: d.lines.length ? d.lines.map((l) => lineFromDoc(l, prods.get(str(l.productId)))) : [blankLine()], terms: (d.terms ?? []).map(termFromDoc), imp,
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
        lines: f.lines.filter((l) => !isBlankLine(l)).map((l) => lineToPayload(l, prods.get(l.productId), "bill")),
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
      Object.assign(e, validateLines(f.lines, new Map(lk.products.map((x) => [String(x.id), x])), { rate: "required", tracking: true }));
      Object.assign(e, validateTerms(f.terms, new Map(lk.terms.map((x) => [String(x.id), x])), live));
      return e;
    },
    editable: (d) => !d.isPosted, deletable: (d) => !d.isPosted, label: (d) => d.invoiceNumber,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p.fyCode]);
  const lkRef = useMemo(() => ({ current: null as ReturnType<typeof useDocScreen>["lookups"] }), []);
  const restored = useRef(p.hookSnapRef.current);
  const localDirty = useRef(false);
  const beforeSave = useRef<() => boolean>(() => true);
  const s = useDocScreen<BForm>(cfg, { companyId: p.companyId, branchId: p.branchId, fyCode: p.fyCode, userId: p.userId, calendar: p.calendar }, {
    setStatus: p.setStatus, dirtyRef: localDirty, externalMessage: p.externalMessage, hints: BILL_HINTS,
    sharedLookups: p.lookups, skipList: true, initialDocId: p.docId, initialForm: p.initialForm, restore: restored.current, snapshotRef: p.hookSnapRef,
    onNew: () => p.onNew(), onDeleted: () => p.onClose(p.tabId), onListChanged: p.onListChanged, beforeSave: () => beforeSave.current(),
  });
  const [stage, setStage] = useState<Stage>(() => p.stageRef.current ?? (p.docId ? "lines" : "header"));
  const [leftCollapsed, toggleLeft] = usePanelState("purchase-bill-left-collapsed");
  const [rightCollapsed, toggleRight] = usePanelState("purchase-bill-right-collapsed");
  const [termDialog, setTermDialog] = useState<TermDialog | null>(null);
  const [termDraft, setTermDraft] = useState<TermRow[]>([]);
  lkRef.current = s.lookups;
  const f = s.form, lk = s.lookups, doc = s.doc, ro = s.readOnly;
  const products = useMemo(() => new Map((lk?.products ?? []).map((x) => [String(x.id), x])), [lk]);
  const masters = useMemo(() => new Map((lk?.terms ?? []).map((x) => [String(x.id), x])), [lk]);
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
      const amount = lineAmount(line, product);
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
  }, [f, lk?.terms, products]);

  const isScopedTerm = (term: TermRow, scope: TermDialog) => {
    if (isBlankTerm(term)) return false;
    const master = masters.get(term.termId);
    const productwise = master?.isProductwise ?? !!term.lineNumber;
    if (scope.scope === "header") return !productwise;
    return productwise && Number(term.lineNumber) === scope.lineNumber;
  };
  const openTerms = (scope: TermDialog) => {
    if (!f) return;
    const scoped = f.terms.filter((term) => isScopedTerm(term, scope)).map((term) => ({ ...term }));
    // Editing: every term of this kind, by sequence, the ones not on the bill yet at zero. Viewing: only what the bill carries.
    setTermDraft(ro ? scoped : dialogTermRows(lk?.terms ?? [], scoped, { productwise: scope.scope === "line", lineNumber: scope.scope === "line" ? scope.lineNumber : undefined }));
    setTermDialog(scope);
    window.setTimeout(() => (document.querySelector<HTMLElement>('[data-term-dialog] [data-field^="T."]:not(:disabled)')
      ?? document.querySelector<HTMLElement>("[data-term-dialog] button"))?.focus(), 40);
  };
  const closeTermDialog = (continueAfterApply = false) => {
    const previous = termDialog;
    setTermDialog(null);
    window.requestAnimationFrame(() => {
      const target = previous?.scope === "line"
        ? document.querySelector<HTMLElement>(`[data-nav="line-terms-${previous.lineIndex}"]`)
        : document.querySelector<HTMLElement>('[data-nav="header-terms"]');
      if (continueAfterApply) {
        if (previous?.scope === "line" && previous.continueAfterApply) { previous.continueAfterApply(); return; }
        if (target && focusStep(target, 1)) return;
      }
      target?.focus();
    });
  };
  const applyTermDialog = () => {
    if (!f || !termDialog) return;
    const preserved = f.terms.filter((term) => !isBlankTerm(term) && !isScopedTerm(term, termDialog));
    const changed = dialogTermsToApply(termDraft, masters);
    s.patch({ terms: [...preserved, ...changed] });
    s.clearError(...Object.keys(s.errors).filter((key) => key === "terms" || key.startsWith("T.")));
    closeTermDialog(true);
  };
  const lineNumberAt = (index: number) => f
    ? f.lines.slice(0, index).filter((line) => !isBlankLine(line)).length + 1
    : index + 1;
  const updateBillLines = (nextLines: LineRow[]) => {
    if (!f) return;
    const oldLive = f.lines.filter((line) => !isBlankLine(line));
    const nextLive = nextLines.filter((line) => !isBlankLine(line));
    const nextNumber = new Map(nextLive.map((line, index) => [line.key, index + 1]));
    let termsChanged = false;
    const terms = f.terms.flatMap((term) => {
      const master = masters.get(term.termId);
      if (!master?.isProductwise) return [term];
      const oldLineNumber = Number(term.lineNumber);
      if (!Number.isInteger(oldLineNumber) || oldLineNumber < 1) return [term];
      const oldLine = oldLive[oldLineNumber - 1];
      if (!oldLine) return [term];
      const newLineNumber = oldLine ? nextNumber.get(oldLine.key) : undefined;
      if (!newLineNumber) { termsChanged = true; return []; }
      if (newLineNumber === Number(term.lineNumber)) return [term];
      termsChanged = true;
      return [{ ...term, lineNumber: String(newLineNumber) }];
    });
    s.patch(termsChanged ? { lines: nextLines, terms } : { lines: nextLines });
  };
  const lineTermsSummary = (index: number) => {
    if (!f || isBlankLine(f.lines[index])) return { amount: "0.00", count: 0 };
    const lineNumber = lineNumberAt(index);
    let total = 0n;
    let count = 0;
    for (const term of f.terms) {
      const master = masters.get(term.termId);
      if (!master?.isProductwise || Number(term.lineNumber) !== lineNumber) continue;
      count += 1;
      const live = invoicePreview.terms.get(term.key)?.signedAmount;
      const stored = term.finalAmount && (ro || !!doc) ? `${term.nature === "DEDUCTIVE" || master.nature === "DEDUCTIVE" ? "-" : ""}${term.finalAmount}` : "0";
      try { total += toMicro(live ?? stored); } catch { /* keep the last valid displayed total */ }
    }
    return { amount: formatImportCost(total, 2), count };
  };
  const headerTermsTotal = (() => {
    let total = 0n;
    for (const term of f?.terms ?? []) {
      const master = masters.get(term.termId);
      if (master?.isProductwise) continue;
      const live = invoicePreview.terms.get(term.key)?.signedAmount;
      const stored = term.finalAmount && (ro || !!doc) ? `${term.nature === "DEDUCTIVE" || master?.nature === "DEDUCTIVE" ? "-" : ""}${term.finalAmount}` : "0";
      try { total += toMicro(live ?? stored); } catch { /* ignore malformed legacy data in the preview label */ }
    }
    return formatImportCost(total, 2);
  })();
  useEffect(() => {
    if (termDialog) return;
    const key = Object.keys(s.errors).find((name) => /^T\.\d+\./.test(name) && s.errors[name]);
    if ((!key && !s.errors.terms) || !f) return;
    if (!key) { openTerms({ scope: "header" }); return; }
    const index = Number(/^T\.(\d+)\./.exec(key)?.[1]);
    const term = f.terms[index];
    if (!term) return;
    const master = masters.get(term.termId);
    if (master?.isProductwise) {
      const lineNumber = Number(term.lineNumber) || 1;
      openTerms({ scope: "line", lineNumber, lineIndex: Math.max(0, lineNumber - 1) });
    } else openTerms({ scope: "header" });
    // The dialog opens only in response to a new validation error object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.errors]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key !== "F6" || termDialog || !f || ro || stage !== "lines") return;
      event.preventDefault();
      document.querySelector<HTMLElement>('[data-grid="lines"] [data-nav="add-line"]')?.click();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termDialog, f, ro, stage]);

  // ---- tab state: title / unsaved mark for the tab strip, stage of the entry (header form first, then the lines) ----
  useEffect(() => { p.stageRef.current = stage; });
  useEffect(() => { p.onMeta(p.tabId, { title: doc ? String(doc.invoiceNumber) : "New bill", dirty: s.dirty, docId: doc?.id ?? null }); }, [doc?.invoiceNumber, doc?.id, s.dirty, p.tabId]);
  // a saved or reopened bill is never "waiting for its header"
  useEffect(() => { if (doc && s.mode === "view") setStage("lines"); }, [doc?.id, s.mode]);
  // an error from a save sends the user to the part of the form that holds it
  useEffect(() => {
    const keys = Object.keys(s.errors).filter((key) => s.errors[key]);
    if (!keys.length) return;
    const inHeader = keys.some(isHeaderKey);
    if (inHeader && stage === "lines") {
      setStage("header");
      const first = keys.find(isHeaderKey)!;
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus(), 60);
    } else if (!inHeader && stage === "header") setStage("lines");
    if (keys.some((key) => key.startsWith("imp."))) setImportOpen(true);
  }, [s.errors]);

  // Finish the header: check only the header fields, then show its summary on the left, the vendor on the right and the lines in the middle.
  const confirmHeader = () => {
    if (!f || !lk) return false;
    const found = Object.entries(cfg.validate(f, lk)).filter(([key, message]) => message && isHeaderKey(key));
    s.setErrors((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([key]) => !isHeaderKey(key))), ...Object.fromEntries(found) }));
    if (found.length) {
      const [first, message] = found[0];
      if (first.startsWith("imp.")) setImportOpen(true);
      s.flash(message!, "warn");
      window.setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus(), 30);
      return false;
    }
    setStage("lines");
    s.flash(doc ? "Header checked" : "Header complete — enter the lines", "info");
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-field="L.0.p"]:not(:disabled)')?.focus(), 60);
    return true;
  };
  // Ctrl+S on a new bill whose header is still open means "header done", not "save an empty bill".
  beforeSave.current = () => { if (stage === "header" && !doc) { confirmHeader(); return false; } return true; };
  const editHeader = () => {
    setStage("header");
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-zone=form] [data-field]:not(:disabled)')?.focus(), 40);
  };

  // ---- side panels and tabs: Alt+[ / Alt+] fold the panels, Alt+, / Alt+. move between tabs (Alt+W closes this one; the workspace handles those) ----
  const panelKeys = useRef({ toggleLeft, toggleRight });
  panelKeys.current = { toggleLeft, toggleRight };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || termDialog) return;
      if (event.code === "BracketLeft") { event.preventDefault(); panelKeys.current.toggleLeft(); }
      else if (event.code === "BracketRight") { event.preventDefault(); panelKeys.current.toggleRight(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [termDialog]);

  // start from a confirmed challan (the "Create Bill" button on the challan screen)
  const started = useRef(0);
  useEffect(() => {
    if (restored.current || !p.fromChallan || !lk || started.current === p.fromChallan.n) return;
    started.current = p.fromChallan.n;
    (async () => {
      try {
        const b = await purchaseApi.billFromChallan(p.companyId, p.fromChallan!.id);
        const c = await purchaseApi.get("challans", p.fromChallan!.id, p.companyId);
        const prods = new Map(lk.products.map((x) => [String(x.id), x]));
        const base = cfg.emptyForm(lk);
        const lines: LineRow[] = (b.lines as any[]).map((l) => ({
          ...blankLine({ productId: str(l.productId), qty: trimDec(l.qty), rate: trimDec(l.rate), locationId: str(l.locationId), batchNo: str(l.batchNo), manufactureDate: iso10(l.manufactureDate), expiryDate: iso10(l.expiryDate), purchaseOrderLineId: str(l.purchaseOrderLineId), challanLineId: str(l.challanLineId), link: "From challan" }),
          unitId: prods.get(str(l.productId))?.baseUnitId ? "" : str(l.unitId),
        }));
        s.newDoc({ ...base, vendorGLId: str(b.vendorGLId), subLedgerId: str(b.subLedgerId), agentId: str(b.agentId), purchaseChallanId: str(b.purchaseChallanId), purchaseOrderId: str(b.purchaseOrderId), challanNo: str(c.challanNumber), orderNo: str(c.orderNumber), lines });
        s.flash(`Bill started from challan ${c.challanNumber}: enter the vendor's invoice details and check the rates`, "info");
      } catch (e) { s.flash((e as Error).message, "err"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fromChallan, lk]);

  // posted goods bills that a service bill can be linked to as a cost
  const [mains, setMains] = useState<PListRow[]>([]);
  // Import / landed-cost detail panels stay collapsed until the user opens them (or existing data forces open once).
  const [importOpen, setImportOpen] = useState(false);
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

  // Auto-expand collapsible panels once when the open document already carries data.
  useEffect(() => {
    if (!f || f.invoiceType !== "IMPORT") { importAutoOpened.current = false; return; }
    const hasImp = Object.values(f.imp).some((v) => String(v ?? "").trim() !== "");
    if (hasImp && !importAutoOpened.current) { setImportOpen(true); importAutoOpened.current = true; }
  }, [f?.invoiceType, f?.imp, doc?.id]);
  useEffect(() => {
    const sources = doc?.importCostSources?.length ?? 0;
    if (sources > 0 && !landedAutoOpened.current) { setLandedOpen(true); landedAutoOpened.current = true; }
    if (!doc) landedAutoOpened.current = false;
  }, [doc?.id, doc?.importCostSources?.length]);

  const state = doc?.state as string | undefined;
  const reversible = !!doc && state === "POSTED";
  const includedSources = (doc?.importCostSources ?? []).filter((source: any) => source.includedInCIF);
  const cifSources = includedSources.filter((source: any) => source.importCostTreatment === "CIF");
  const landedOnlySources = includedSources.filter((source: any) => source.importCostTreatment === "LANDED_ONLY");
  const cifSourceAmount = cifSources.reduce((sum: bigint, source: any) => sum + toMicro(source.basicAmount), 0n);
  const landedOnlyAmount = landedOnlySources.reduce((sum: bigint, source: any) => sum + toMicro(source.basicAmount), 0n);
  const cifTotal = doc?.invoiceType === "IMPORT" ? formatImportCost(toMicro(doc.basicAmount) + cifSourceAmount, 2) : null;
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
    const dialogErrors: Errors = {};
    if (termDialog) {
      for (const [key, value] of Object.entries(s.errors)) {
        if (key === "terms") { dialogErrors.terms = value; continue; }
        const match = /^T\.(\d+)\.(.+)$/.exec(key);
        if (!match) continue;
        const localIndex = termDraft.findIndex((term) => term.key === f.terms[Number(match[1])]?.key);
        if (localIndex >= 0) dialogErrors[`T.${localIndex}.${match[2]}`] = value;
      }
    }
    const clearDialogError = (...keys: string[]) => {
      const mapped = keys.map((key) => {
        const match = /^T\.(\d+)\.(.+)$/.exec(key);
        if (!match) return key;
        const globalIndex = f.terms.findIndex((term) => term.key === termDraft[Number(match[1])]?.key);
        return globalIndex < 0 ? key : `T.${globalIndex}.${match[2]}`;
      });
      s.clearError(...mapped);
    };
    const liveLines = f.lines.filter((line) => !isBlankLine(line)).length;
    const impFilled = Object.values(f.imp).filter((v) => String(v ?? "").trim() !== "").length;
    const dialogPreview = termDialog && !ro ? (() => {
      let incompleteLines = liveLines === 0;
      const pricedLines = f.lines.filter((line) => !isBlankLine(line)).flatMap((line, index) => {
        const product = products.get(line.productId);
        const qty = effectiveQty(line, product);
        const validQty = !!qty && !!parseDec(qty) && parseDec(qty)!.n > 0n;
        const validRate = !!line.rate && !!parseDec(line.rate);
        if (!product || !validQty || !validRate || (!!line.altQty !== !!line.altUnitId)) { incompleteLines = true; return []; }
        const amount = lineAmount(line, product);
        return amount ? [{ lineNumber: index + 1, basicAmount: amount }] : (incompleteLines = true, []);
      });
      const rows = [...f.terms.filter((term) => !isBlankTerm(term) && !isScopedTerm(term, termDialog)), ...termDraft.filter((term) => !isBlankTerm(term))].map((term) => ({
        rowKey: term.key, termId: Number(term.termId), lineNumber: term.lineNumber, calcType: term.calcType,
        rate: term.rate, inputAmount: term.inputAmount, isOverridden: term.isOverridden, overrideAmount: term.overrideAmount,
      }));
      const termMasters = new Map(lk.terms.map((term) => [term.id, term]));
      return previewPurchase(pricedLines, rows, termMasters, incompleteLines);
    })() : undefined;
    let dialogTotalMicro = 0n;
    let dialogTotalComplete = !!ro;
    if (termDialog && ro) {
      for (const term of termDraft) {
        const master = masters.get(term.termId);
        if (!term.finalAmount) continue;
        const sign = term.nature === "DEDUCTIVE" || master?.nature === "DEDUCTIVE" ? "-" : "";
        try { dialogTotalMicro += toMicro(`${sign}${term.finalAmount}`); } catch { /* Ignore a legacy malformed term in the display total. */ }
      }
    } else if (dialogPreview?.status === "ready") {
      dialogTotalComplete = true;
      for (const term of termDraft) {
        const amount = dialogPreview.terms.get(term.key)?.signedAmount;
        if (amount) dialogTotalMicro += toMicro(amount);
      }
    }
    const dialogTotalText = dialogTotalComplete ? formatImportCost(dialogTotalMicro, 2) : "—";

  const headerReady = stage === "lines" || !!doc;
  const dialogLine = termDialog?.scope === "line" ? f.lines[termDialog.lineIndex] : undefined;
  const dialogBasic = termDialog?.scope === "line"
    ? (dialogLine ? lineAmount(dialogLine, products.get(dialogLine.productId)) : "")
    : ro ? str(doc?.basicAmount) : (dialogPreview?.basicAmount ?? "");
  const dialogNet = termDialog?.scope === "line"
    ? (dialogBasic && dialogTotalComplete ? formatImportCost(toMicro(dialogBasic) + dialogTotalMicro, 2) : "")
    : ro ? str(doc?.totalAmount) : (dialogPreview?.status === "ready" ? dialogPreview.netAmount ?? "" : "");
  const shown = (v: string) => (v === "" ? "—" : v.startsWith("-") ? `− ${money(v.slice(1))}` : money(v));
  const dialogFilled = termDraft.filter((term) => !isBlankTerm(term) && (ro || !isZeroTerm(term))).length;

  // The lines grid starts as one blank line and grows with every product. `fill` caps it at the height of the lines stage (the rows then scroll inside).
  const linesGrid = (fill: boolean) => (
    <LinesGrid fill={fill} kind="bill" lines={f.lines} onChange={updateBillLines} lookups={lk} products={products} readOnly={ro} errors={s.errors} calendar={p.calendar} clearError={s.clearError} contextKey={String(p.companyId)} lockProducts
      onOpenTerms={(index, continueAfterApply) => openTerms({ scope: "line", lineNumber: lineNumberAt(index), lineIndex: index, continueAfterApply })} termSummary={lineTermsSummary} />
  );

  return (
    <>
      <section data-purchase-document className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DocHeader title="Purchase bill" number={doc ? String(doc.invoiceNumber) : undefined} pill={state ? <Pill text={state} tone={STATE_TONE[state]} /> : undefined}
          branchName={p.branchName} fyCode={p.fyCode} dirty={s.dirty}
          steps={doc ? undefined : { labels: ["Header", "Lines"], current: stage === "header" ? 0 : 1 }}
          right={<span className="text-[12px] text-slate-500">F1 help</span>} />
        {notice && <div className="shrink-0 px-5 pt-3">{notice}</div>}

        <div className="flex min-h-0 flex-1">
          <SidePanel side="left" title="Header" collapsed={leftCollapsed} onToggle={toggleLeft} shortcut="Alt+[">
            {headerReady
              ? <HeaderSummary form={f} invoiceNumber={doc ? String(doc.invoiceNumber) : undefined} calendar={p.calendar} readOnly={ro} onEdit={editHeader} />
              : <EmptyPanel>The header you enter in the middle appears here.</EmptyPanel>}
          </SidePanel>

          <div data-zone="form" onKeyDown={formEnterKey} className={`min-w-0 flex-1 px-5 py-4 ${stage === "header" ? "lg-scroll overflow-y-auto" : "flex min-h-0 flex-col gap-3 overflow-hidden"}`}>
            {stage === "header" ? (
              <div className="mx-auto max-w-[1080px] space-y-4">
          <FormSection title="Bill Header" hint="Invoice, supplier, payment and document links">
            <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3.5 xl:grid-cols-3 2xl:grid-cols-4">
              <NumberField label="Invoice No" documentType="PURCHASE_BILL" companyId={p.companyId} branchId={p.branchId} fyCode={p.fyCode} userId={p.userId} existingNumber={doc ? String(doc.invoiceNumber) : undefined} readOnly={ro} seriesId={f.numberSeriesId} number={f.docNumber} onChange={(c) => s.patch(c)} />
              <DateField label="Invoice Date" name="invoiceDate" value={f.invoiceDate} onChange={(v) => {
                // with due days entered, the due date follows the invoice date
                const due = f.dueDays ? addDaysIso(v, Number(f.dueDays)) : "";
                s.patch(due ? { invoiceDate: v, dueDate: due } : { invoiceDate: v });
                s.clearError("invoiceDate");
              }} calendar={p.calendar} readOnly={ro} error={s.err("invoiceDate")} required />
              <Field label="Invoice Type">
                <select data-field="invoiceType" disabled={ro} value={f.invoiceType} onChange={(e) => { s.patch({ invoiceType: e.target.value as BForm["invoiceType"] }); if (e.target.value !== "IMPORT") setImportOpen(false); }} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}><option value="LOCAL">Local</option><option value="IMPORT">Import</option></select>
              </Field>
              <Field label="Purchase Type">
                <select data-field="purchaseType" disabled={ro} value={f.purchaseType} onChange={(e) => { const purchaseType = e.target.value; s.patch({ purchaseType, importCostForBillId: purchaseType.startsWith("SERVICE_PURCHASE_") ? f.importCostForBillId : "" }); s.clearError("importCostForBillId"); }} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}>{PURCHASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
              </Field>
              <VendorFields lookups={lk} contextKey={String(p.companyId)} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} agentId={f.agentId} readOnly={ro} errors={s.errors} lockVendor={!!f.purchaseChallanId}
                onChange={(c) => {
                  // a new vendor brings its payment term days, unless due days are already filled
                  const days = c.vendorGLId && c.vendorGLId !== f.vendorGLId && !f.dueDays ? lk.vendors.find((v) => String(v.id) === c.vendorGLId)?.paymentTermDays : null;
                  s.patch(days ? { ...c, dueDays: String(days), dueDate: f.invoiceDate ? addDaysIso(f.invoiceDate, days) : f.dueDate } : c);
                  s.clearError("vendorGLId", "subLedgerId");
                }} />
              <TextField label="Vendor Invoice No" name="vendorInvoiceNo" value={f.vendorInvoiceNo} onChange={(v) => s.patch({ vendorInvoiceNo: v })} readOnly={ro} error={s.err("vendorInvoiceNo")} max={30} />
              <DateField label="Vendor Invoice Date" name="vendorInvoiceDate" value={f.vendorInvoiceDate} onChange={(v) => { s.patch({ vendorInvoiceDate: v }); s.clearError("vendorInvoiceDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("vendorInvoiceDate")} />
              <TextField label="Due Days" name="dueDays" value={f.dueDays} onChange={(v) => {
                if (!/^\d{0,4}$/.test(v)) return;
                // typing the days sets the due date from the invoice date; a due date typed afterwards still wins
                const due = v ? addDaysIso(f.invoiceDate, Number(v)) : "";
                s.patch(due ? { dueDays: v, dueDate: due } : { dueDays: v });
                if (due) s.clearError("dueDate");
              }} readOnly={ro} error={s.err("dueDays")} max={4} />
              <DateField label="Due Date" name="dueDate" value={f.dueDate} onChange={(v) => { s.patch({ dueDate: v }); s.clearError("dueDate"); }} calendar={p.calendar} readOnly={ro} error={s.err("dueDate")} />
              {f.purchaseType.startsWith("SERVICE_PURCHASE_") && (
                <>
                  <Field label="Cost of goods bill" error={s.err("importCostForBillId")}>
                    <Combobox fieldName="importCostForBillId" placeholder="— (not linked: stays an expense)" value={f.importCostForBillId} hasError={!!s.err("importCostForBillId")} options={sourceTargetOpts} disabled={ro} allowClear onChange={(value) => { const target = mains.find((x) => String(x.id) === value); s.patch({ importCostForBillId: value, ...(value && target && target.invoiceType !== "IMPORT" ? { importCostTreatment: "LANDED_ONLY" as const } : {}) }); s.clearError("importCostForBillId"); }} onCommit={(el, dir) => focusStep(el, dir)} />
                  </Field>
                  <Field label="Source allocation basis">
                    <select data-field="importCostAllocationBasis" disabled={ro || !f.importCostForBillId} value={f.importCostAllocationBasis} onChange={(e) => s.patch({ importCostAllocationBasis: e.target.value as BForm["importCostAllocationBasis"] })} className={`fld ${ro || !f.importCostForBillId ? "bg-slate-100 text-slate-600" : ""}`}>
                      <option value="VALUE">By goods value</option><option value="QUANTITY">By quantity</option>
                    </select>
                  </Field>
                  <Field label="Cost treatment">
                    <select data-field="importCostTreatment" disabled={ro || !f.importCostForBillId} value={f.importCostTreatment} onChange={(e) => s.patch({ importCostTreatment: e.target.value as BForm["importCostTreatment"] })} className={`fld ${ro || !f.importCostForBillId ? "bg-slate-100 text-slate-600" : ""}`}>
                      <option value="CIF">CIF input (pre-customs)</option><option value="LANDED_ONLY">Landed only (post-CIF)</option>
                    </select>
                  </Field>
                </>
              )}
              <Field label="Challan / Order"><input disabled className="fld bg-slate-100 text-slate-600" value={[f.challanNo && `Challan ${f.challanNo}`, f.orderNo && `Order ${f.orderNo}`].filter(Boolean).join(" · ")} placeholder="—" aria-label="Linked documents" /></Field>
            </div>
          </FormSection>

          {f.invoiceType === "IMPORT" && (
            <section className="lg-card">
              <button type="button" className="flex min-h-[42px] w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50" onClick={() => setImportOpen((v) => !v)} aria-expanded={importOpen}>
                {importOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="lg-card-title">Import details</span>
                <span className="lg-card-hint">{impFilled ? `${impFilled} field${impFilled === 1 ? "" : "s"} filled` : "Optional — expand to enter customs, LC, transport, FX"}</span>
              </button>
              {importOpen && (
                <div className="border-t border-slate-100 px-4 py-3.5">
                  <p className="mb-3 text-[12px] text-slate-600">Customs declaration number is needed to post an import bill. Other fields are optional.</p>
                  <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {IMPORT_FIELDS.map((k) => k.kind === "date"
                      ? <DateField key={k.key} label={k.label} name={`imp.${k.key}`} value={f.imp[k.key] ?? ""} onChange={(v) => { s.patch({ imp: { ...f.imp, [k.key]: v } }); s.clearError(`imp.${k.key}`); }} calendar={p.calendar} readOnly={ro} error={s.err(`imp.${k.key}`)} />
                      : k.kind === "mode"
                        ? <Field key={k.key} label={k.label}><select data-field={`imp.${k.key}`} disabled={ro} value={f.imp[k.key] ?? ""} onChange={(e) => s.patch({ imp: { ...f.imp, [k.key]: e.target.value } })} className={`fld ${ro ? "bg-slate-100 text-slate-600" : ""}`}><option value="">—</option><option value="ROAD">Road</option><option value="AIR">Air</option><option value="RAIL">Rail</option><option value="OTHER">Other</option></select></Field>
                        : <TextField key={k.key} label={k.label} name={`imp.${k.key}`} value={f.imp[k.key] ?? ""} onChange={(v) => s.patch({ imp: { ...f.imp, [k.key]: v } })} readOnly={ro} max={k.max ?? 60} error={s.err(`imp.${k.key}`)} />)}
                  </div>
                  {Number(f.imp.exchangeRate) > 0 && Number(f.imp.foreignInvoiceAmount) > 0 && <p className="mt-1 text-[11px] text-slate-600">{(f.imp.currencyCode ?? "").toUpperCase()} {f.imp.foreignInvoiceAmount} × {f.imp.exchangeRate} = NPR <b>{(Math.round(Number(f.imp.foreignInvoiceAmount) * Number(f.imp.exchangeRate) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</b>. Enter line rates in NPR (foreign rate × exchange rate).</p>}
                </div>
              )}
            </section>
          )}
                <div className="flex justify-end pb-2">
                  <button type="button" data-nav="header-continue" className="btn btn-primary" onClick={confirmHeader}>
                    {doc ? "Done — back to lines" : "Header done"} <ArrowRight size={14} />{!doc && <span className="kbd">Ctrl+S</span>}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <section className="lg-card flex min-h-0 flex-col">
                  <header className="lg-card-head">
                    <h2 className="lg-card-title">Lines</h2>
                    <p className="lg-card-hint">Product, quantity and rate. Click a line's term amount to assess its terms.</p>
                  </header>
                  <div className="flex min-h-0 flex-col">
                    {linesGrid(true)}
                  </div>
                </section>
          <section className="lg-card flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" aria-label="Header terms and conditions">
            <div className="min-w-0 flex-1">
              <h2 className="lg-card-title">Header terms and conditions</h2>
              <p className="lg-card-hint mt-0.5">Document-level charges, discounts and taxes. Product-specific charges are available from each line.</p>
            </div>
            <span className="lg-chip">{f.terms.filter((term) => !isBlankTerm(term) && !masters.get(term.termId)?.isProductwise).length} terms</span>
            <b className="min-w-[100px] text-right text-[15px] font-semibold tabular-nums">{headerTermsTotal.startsWith("-") ? `− ${money(headerTermsTotal.slice(1))}` : (money(headerTermsTotal) || "0.00")}</b>
            <button type="button" data-nav="header-terms" className="btn" onClick={() => openTerms({ scope: "header" })}>
              {ro ? "View terms" : "Assess terms"}
            </button>
            {s.err("terms") && <p className="w-full text-[12px] text-rose-700" role="alert">{s.err("terms")}</p>}
          </section>
          {ro && doc && doc.lines.some((l) => Number(l.landedAmount) !== 0) && (
            <p className="text-[12px] text-slate-600">Landed cost per line: {doc.lines.map((l) => `${l.lineNumber}: ${money(l.landedAmount)}`).join(" · ")}</p>
          )}
                <div className="max-h-[35%] shrink-0 overflow-y-auto">
          {!!doc && String(doc.purchaseType ?? "").startsWith("GOODS_PURCHASE_") && (
            <section className="lg-card shrink-0 border-sky-200 bg-sky-50/50">
              <button type="button" className="flex min-h-[42px] w-full items-center gap-2 px-4 py-2 text-left hover:bg-sky-50" onClick={() => setLandedOpen((v) => !v)} aria-expanded={landedOpen}>
                {landedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="lg-card-title">Linked service costs and landed value</span>
                <span className="lg-card-hint">{(doc.importCostSources ?? []).length ? `${(doc.importCostSources ?? []).length} linked` : "No service invoices linked yet"}</span>
              </button>
              {landedOpen && (
                <div className="px-3 py-2">
                  <p className="text-[12px] text-slate-700">Only posted, unreversed service bills are included. Tax-exclusive basic amount is allocated; the service bill&apos;s tax stays on its own term. CIF = before customs; Landed only = after CIF.</p>
                  <div className="mt-1 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2 xl:grid-cols-4">
                    <p>Goods basic: <b>{money(doc.basicAmount)}</b></p>
                    <p>CIF service costs: <b>{money(formatImportCost(cifSourceAmount, 2))}</b></p>
                    <p>Landed-only costs: <b>{money(formatImportCost(landedOnlyAmount, 2))}</b></p>
                    <p>CIF base: <b>{money(cifTotal ?? "0")}</b></p>
                  </div>
                  {(doc.importCostSources ?? []).length > 0 ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="xl-table min-w-[560px] text-left text-[12px]">
                        <thead><tr className="border-b border-sky-200 text-slate-600"><th className="py-1 pr-3">Service invoice</th><th className="py-1 pr-3">Vendor</th><th className="py-1 pr-3">Source basis</th><th className="py-1 pr-3">Treatment</th><th className="py-1 pr-3 text-right">Basic amount</th><th className="py-1 text-left">Cost status</th></tr></thead>
                        <tbody>{doc.importCostSources.map((source: any) => <tr key={source.id} className="border-b border-sky-100 last:border-0">
                          <td className="py-1 pr-3 font-mono">{source.invoiceNumber}{source.vendorInvoiceNo ? ` · ${source.vendorInvoiceNo}` : ""}</td>
                          <td className="py-1 pr-3">{source.vendorName}</td>
                          <td className="py-1 pr-3">{source.importCostAllocationBasis === "QUANTITY" ? "Quantity" : "Goods value"}</td>
                          <td className="py-1 pr-3">{source.importCostTreatment === "LANDED_ONLY" ? "Landed only" : "CIF"}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{money(source.basicAmount)}</td>
                          <td className="py-1 text-left">{source.includedInCIF ? "Included" : source.state.toLowerCase()}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  ) : <p className="mt-1 text-[12px] text-slate-600">No service purchase invoices are linked yet.</p>}
                </div>
              )}
            </section>
          )}

                </div>
                <section className="lg-card shrink-0 px-4 py-2.5" aria-label="Remarks">
                  <label className="flex items-start gap-3">
                    <span className="mt-1.5 w-[64px] shrink-0 text-[12px] font-semibold text-slate-700">Remarks</span>
                    <span className="min-w-0 flex-1">
                      <textarea data-field="remarks" maxLength={1024} disabled={ro} value={f.remarks} onChange={(e) => s.patch({ remarks: e.target.value })}
                        placeholder="Optional note for this bill…" className={`fld h-14 min-h-14 resize-y py-1.5 ${s.err("remarks") ? "fld-err" : ""}`} aria-label="Remarks" />
                      {s.err("remarks") && <span className="mt-1 block text-[12px] text-rose-700">{s.err("remarks")}</span>}
                    </span>
                  </label>
                </section>
              </>
            )}
          </div>

          <SidePanel side="right" title="Vendor" collapsed={rightCollapsed} onToggle={toggleRight} shortcut="Alt+]">
            {headerReady
              ? <VendorPanel lookups={lk} companyId={p.companyId} branchId={p.branchId} vendorGLId={f.vendorGLId} subLedgerId={f.subLedgerId} agentId={f.agentId} vendorInvoiceNo={f.vendorInvoiceNo} docId={doc?.id} calendar={p.calendar} />
              : <EmptyPanel>The vendor's details appear here once the header is complete.</EmptyPanel>}
          </SidePanel>
        </div>

        <footer className="tape flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2.5 px-5 py-3">
          <div className="min-w-0 flex-1"><PurchaseInvoiceTotals compact preview={invoicePreview} savedDoc={doc} readOnly={ro} hasLines={liveLines > 0} /></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!ro ? (
              <>
                <button data-nav className="btn btn-primary" disabled={s.saving || (stage === "header" && !doc)} title={stage === "header" && !doc ? "Finish the header first (Header done)" : undefined} onClick={() => void s.save()}><Save size={14} /> {s.mode === "edit" ? "Update" : "Save"} <span className="kbd">Ctrl+S</span></button>
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

      {termDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) closeTermDialog(); }}>
          <div data-term-dialog data-purchase-document role="dialog" aria-modal="true" aria-labelledby="purchase-term-dialog-title" className="flex max-h-[92vh] w-[min(1120px,96vw)] flex-col border border-slate-500 bg-white shadow-xl" onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeTermDialog(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); if (!ro) applyTermDialog(); return; }
            if (e.key === "Tab") {
              const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter((item) => item.getClientRects().length > 0);
              const first = items[0], last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
          }}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-3 py-2">
              <div>
                <h2 id="purchase-term-dialog-title" className="text-[14px] font-semibold text-slate-800">
                  {termDialog.scope === "header" ? "Header terms & conditions" : `Line ${termDialog.lineNumber} terms`}
                </h2>
                <p className="text-[11px] text-slate-600">
                  {termDialog.scope === "header" ? "Document-level terms, in sequence. Terms left at 0 are not saved." : `${dialogLine ? products.get(dialogLine.productId)?.description ?? "Product line" : "Product line"} — terms in sequence. Terms left at 0 are not saved.`}
                </p>
              </div>
              <button type="button" className="btn" onClick={() => closeTermDialog()} aria-label="Close terms dialog">Close <span className="kbd">Esc</span></button>
            </div>
            <div className="grid shrink-0 grid-cols-3 divide-x divide-slate-200 border-b border-slate-300 bg-white text-center" aria-live="polite">
              <Stat label={termDialog.scope === "line" ? "Line amount" : "Basic amount"} value={shown(dialogBasic)} />
              <Stat label="Terms" value={dialogTotalText === "—" ? "—" : shown(dialogTotalText)} />
              <Stat label={termDialog.scope === "line" ? "Net amount after terms" : "Bill net amount"} value={shown(dialogNet)} strong />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <TermsGrid terms={termDraft} onChange={setTermDraft} lookups={lk} masters={masters} lineCount={liveLines} readOnly={ro} errors={dialogErrors} clearError={clearDialogError} contextKey={String(p.companyId)} calculationPreview={ro ? undefined : dialogPreview?.terms} previewError={dialogPreview?.message}
                excludeCategory="COSTING" productwiseOnly={termDialog.scope === "line"} fixedLineNumber={termDialog.scope === "line" ? termDialog.lineNumber : undefined} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 bg-slate-50 px-3 py-2">
              <span className="text-[12px] text-slate-600">{dialogFilled} term(s) with a value</span>
              <div className="flex gap-2">
                <button type="button" className="btn" onClick={() => closeTermDialog()}>Cancel</button>
                {!ro && <button type="button" className="btn btn-primary" onClick={applyTermDialog}>Apply to bill <span className="kbd">Ctrl+S</span></button>}
              </div>
            </div>
          </div>
        </div>
      )}
      {s.dialog && <Dialog spec={s.dialog} onClose={() => s.setDialog(null)} />}
      {s.help && <ShortcutsOverlay onClose={() => s.setHelp(false)} shortcuts={HELP} />}
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`tabular-nums ${strong ? "text-[17px] font-bold text-blue-950" : "text-[15px] font-semibold text-slate-900"}`}>{value}</div>
    </div>
  );
}
