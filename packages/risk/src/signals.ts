// Collects raw facts about a receiver. Every source is behind `Sources` so demo mode can swap in
// fixtures. A missing fact is `null` (unknown), never a guess.

export interface Signals {
  receiver: string;
  exists: boolean;
  balanceYocto: string | null;
  isContract: boolean | null;
  createdAtMs: number | null; // null: unknown (indexer gap or genesis account)
  txCount: number | null;
  lastDeployAtMs: number | null; // null: never deployed or unknown
  blocklisted: boolean;
  blockReports: { reporter: string; reason: string; evidence: string }[];
  priorPaymentsToReceiver: number; // successful payments by this guard
  knownReceivers: string[]; // receivers this guard paid before (for look-alike checks)
  indexerError: string | null; // set when the indexer could not be reached (facts above are unknown)
}

export interface Sources {
  viewAccount(id: string): Promise<{ amount: string; code_hash: string } | null>;
  nearblocksAccount(id: string): Promise<{ createdAtMs: number | null } | null>;
  nearblocksTxCount(id: string): Promise<number | null>;
  nearblocksLastDeploy(id: string): Promise<number | null>;
  guardBlockReports(id: string): Promise<{ reporter: string; reason: string; evidence: string }[]>;
  guardPayments(): Promise<{ receiver: string; status: string }[]>;
}

const NO_CODE = "11111111111111111111111111111111";

export async function collectSignals(src: Sources, receiver: string): Promise<Signals> {
  let indexerError: string | null = null;
  const soft = <T>(p: Promise<T>) =>
    p.catch((e: Error) => {
      indexerError ??= e.message;
      return null;
    });
  const [account, nb, txCount, lastDeploy, reports, payments] = await Promise.all([
    src.viewAccount(receiver),
    soft(src.nearblocksAccount(receiver)),
    soft(src.nearblocksTxCount(receiver)),
    soft(src.nearblocksLastDeploy(receiver)),
    src.guardBlockReports(receiver),
    src.guardPayments(),
  ]);
  const sent = payments.filter((p) => p.status === "sent");
  return {
    receiver,
    exists: account !== null,
    balanceYocto: account?.amount ?? null,
    isContract: account ? account.code_hash !== NO_CODE : null,
    createdAtMs: nb?.createdAtMs ?? null,
    txCount,
    lastDeployAtMs: lastDeploy,
    blocklisted: reports.length > 0,
    blockReports: reports,
    priorPaymentsToReceiver: sent.filter((p) => p.receiver === receiver).length,
    knownReceivers: [...new Set(sent.map((p) => p.receiver))],
    indexerError,
  };
}

/** Live sources: public NEAR RPC, NearBlocks API and the guard contract's views. */
export function liveSources(opts: { rpcUrl: string; nearblocksUrl: string; guard: string }): Sources {
  const rpc = async (params: object) => {
    const res = await fetch(opts.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }),
    });
    return (await res.json()) as any;
  };
  const view = async (method: string, args: object) => {
    const r = await rpc({
      request_type: "call_function",
      account_id: opts.guard,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    if (r.error) throw new Error(`guard.${method}: ${JSON.stringify(r.error)}`);
    return JSON.parse(Buffer.from(r.result.result).toString());
  };
  // The free NearBlocks API rate-limits hard (HTTP 429), so successful answers are cached.
  const cache = new Map<string, { at: number; body: any }>();
  const nb = async (path: string) => {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.body;
    const res = await fetch(`${opts.nearblocksUrl}/v1/account/${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`nearblocks HTTP ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
    const body = await res.json();
    cache.set(path, { at: Date.now(), body });
    return body;
  };
  const nsToMs = (ns: string | number | null | undefined) => (ns ? Math.floor(Number(ns) / 1e6) : null);

  return {
    async viewAccount(id) {
      const r = await rpc({ request_type: "view_account", account_id: id });
      if (r.error) {
        if (JSON.stringify(r.error).includes("UNKNOWN_ACCOUNT")) return null;
        throw new Error(`view_account: ${JSON.stringify(r.error)}`);
      }
      return { amount: r.result.amount, code_hash: r.result.code_hash };
    },
    async nearblocksAccount(id) {
      const a = (await nb(id)).account?.[0];
      return a ? { createdAtMs: nsToMs(a.created?.block_timestamp) } : null;
    },
    async nearblocksTxCount(id) {
      const c = (await nb(`${id}/txns-only/count`)).txns?.[0]?.count;
      return c === undefined ? null : Number(c);
    },
    async nearblocksLastDeploy(id) {
      const d = (await nb(`${id}/contract/deployments`)).deployments ?? [];
      const ts = d.map((x: any) => nsToMs(x.block_timestamp) ?? 0);
      return ts.length ? Math.max(...ts) : null;
    },
    async guardBlockReports(id) {
      const all: [string, any[]][] = await view("get_blocklist", { limit: 100 });
      return (all.find(([acc]) => acc === id)?.[1] ?? []).map((r) => ({
        reporter: r.reporter,
        reason: r.reason,
        evidence: r.evidence,
      }));
    },
    async guardPayments() {
      return view("get_payments", { limit: 100 });
    },
  };
}
