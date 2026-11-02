// Rule-based scoring. Every rule that fires adds a human-readable reason; the worst level wins.
import type { Signals } from "./signals.js";
import type { Verdict } from "./verdict.js";

export interface Reason {
  level: Verdict;
  code: string;
  text: string;
}

export interface Assessment {
  verdict: Verdict;
  reasons: Reason[];
}

export interface Policy {
  newAccountMs: number; // accounts younger than this → warn
  recentDeployMs: number; // code changed within this window → warn
  firstPaymentWarnYocto: bigint; // first payment to a receiver above this → warn
}

export const DEFAULT_POLICY: Policy = {
  newAccountMs: 24 * 3600_000,
  recentDeployMs: 24 * 3600_000,
  firstPaymentWarnYocto: 250_000_000_000_000_000_000_000n, // 0.25 NEAR
};

const RANK: Record<Verdict, number> = { allow: 0, warn: 1, block: 2 };

export function assess(s: Signals, amountYocto: string, now = Date.now(), policy = DEFAULT_POLICY): Assessment {
  const reasons: Reason[] = [];
  const add = (level: Verdict, code: string, text: string) => reasons.push({ level, code, text });
  const hours = (ms: number) => {
    const h = Math.max(0, Math.round(ms / 3600_000));
    return h > 48 ? `${Math.round(h / 24)}d` : `${h}h`;
  };

  if (s.blocklisted) {
    const first = s.blockReports[0];
    add("block", "blocklisted", `on the shared blocklist (${s.blockReports.length} report(s); first: "${first.reason}", evidence: ${first.evidence || "none"})`);
  }
  if (!s.exists) add("block", "no_account", "receiver account does not exist");

  if (s.exists) {
    // NearBlocks testnet lags behind the chain, so fresh accounts often have no record. A receiver
    // this guard already paid successfully is trusted on that history instead.
    if (s.createdAtMs === null && s.priorPaymentsToReceiver === 0) {
      const why = s.indexerError ? `indexer unavailable: ${s.indexerError}` : "indexer has no record";
      add("warn", "age_unknown", `account age unknown (${why}) and never paid before`);
    }
    else if (now - s.createdAtMs < policy.newAccountMs) add("warn", "new_account", `account created ${hours(now - s.createdAtMs)} ago`);

    if (s.lastDeployAtMs !== null && now - s.lastDeployAtMs < policy.recentDeployMs)
      add("warn", "recent_deploy", `contract code changed ${hours(now - s.lastDeployAtMs)} ago`);

    if (s.priorPaymentsToReceiver === 0 && BigInt(amountYocto) > policy.firstPaymentWarnYocto)
      add("warn", "first_payment_large", "first payment to this receiver and amount is above the first-payment threshold");

    const twin = s.knownReceivers.find((k) => k !== s.receiver && editDistance(k, s.receiver) <= 2);
    if (twin) add("warn", "look_alike", `name looks like a previously paid receiver: ${twin}`);
  }

  if (reasons.length === 0) {
    const facts = [
      s.priorPaymentsToReceiver ? `paid ${s.priorPaymentsToReceiver} time(s) before` : "no prior payments",
      s.createdAtMs ? `account age ${hours(now - s.createdAtMs)}` : null,
      s.txCount !== null ? `${s.txCount} transactions` : null,
      s.isContract ? "is a contract" : "not a contract",
    ].filter(Boolean);
    add("allow", "ok", `no risk rule fired (${facts.join(", ")})`);
  }

  const verdict = reasons.reduce<Verdict>((w, r) => (RANK[r.level] > RANK[w] ? r.level : w), "allow");
  return { verdict, reasons };
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
