// Paisa (integer) me hisaab: float ke rounding errors se bachne ke liye. 1 NPR = 100 paisa.
export const toPaise = (s: string): number => {
  if (!s) return 0;
  const [w, f = ""] = s.split(".");
  return Number(w || "0") * 100 + Number((f + "00").slice(0, 2));
};
export const fromPaise = (p: number) => `${Math.trunc(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, "0")}`;

// en-IN grouping = lakh/crore (12,34,567.00), Nepal me bhi yahi chalta hai
const nf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPaise = (p: number) => nf.format(Math.abs(p) / 100);
// Server ki "1000.00" string ko edit-string banao: zero ho to khali
export const editStr = (v: string) => (toPaise(v) === 0 ? "" : fromPaise(toPaise(v)));
