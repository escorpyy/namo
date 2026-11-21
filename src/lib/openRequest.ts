import { useEffect } from "react";

/** A request from another screen (Ctrl+Enter on a ledger report line) to open one record of this screen. `n` is unique per request. */
export interface OpenRequest { docId: number; n: number }

let consumed = 0;

/** Opens the requested record once, even if the workspace is remounted while the app still holds the request. */
export function useOpenRequest(req: OpenRequest | null | undefined, open: (docId: number) => void) {
  useEffect(() => {
    if (!req || req.n <= consumed) return;
    consumed = req.n;
    open(req.docId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);
}
