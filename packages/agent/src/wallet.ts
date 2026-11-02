// GuardedWallet: the only way the agent can move money. It asks the risk service first and acts
// on the verdict; the LLM never sees keys or signatures.
//   block → refuse, nothing is signed
//   warn  → submit to the guard, which holds the payment until the owner approves on-chain
//   allow → submit to the guard, which re-checks the signature, limits and blocklist, then pays
import type { CheckResult } from "../../risk/src/service.js";
import type { GuardClient, PayArgs } from "./guard.js";

export type PayOutcome =
  | { status: "sent"; txHash: string | null; check: CheckResult }
  | { status: "pending_owner"; txHash: string | null; check: CheckResult }
  | { status: "refused_by_wrapper"; check: CheckResult }
  | { status: "refused_by_contract"; txHash: string | null; error: string; check?: CheckResult };

export interface WalletConfig {
  guard: GuardClient;
  check: (receiver: string, amountYocto: string) => Promise<CheckResult>;
  log?: (line: string) => void;
}

export function toYocto(near: string): string {
  if (!/^\d+(\.\d{1,24})?$/.test(near)) throw new Error(`bad NEAR amount: ${near}`);
  const [i, f = ""] = near.split(".");
  return (BigInt(i) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

export class GuardedWallet {
  private log: (line: string) => void;

  constructor(private cfg: WalletConfig) {
    this.log = cfg.log ?? console.log;
  }

  async pay(receiver: string, amountNear: string, memo: string): Promise<PayOutcome> {
    const amountYocto = toYocto(amountNear);
    this.log(`  wallet: risk check ${receiver} ${amountNear} NEAR`);
    const check = await this.cfg.check(receiver, amountYocto);
    for (const r of check.reasons) this.log(`    [${r.level}] ${r.text}`);

    if (check.verdict === "block") {
      this.log(`  wallet: REFUSED — verdict block, nothing signed`);
      return { status: "refused_by_wrapper", check };
    }
    const res = await this.submit({ receiver, amount: amountYocto, memo, verdict: check.signed });
    if (!res.ok) return { status: "refused_by_contract", txHash: res.txHash, error: res.error ?? "", check };
    if (check.verdict === "warn") {
      this.log(`  wallet: HELD by guard — owner must approve (web console or: npm run owner -- approve <id>)`);
      return { status: "pending_owner", txHash: res.txHash, check };
    }
    this.log(`  wallet: SENT`);
    return { status: "sent", txHash: res.txHash, check };
  }

  /** Calls `pay` on the guard. Exposed so the attack demo can show the contract layer alone. */
  async submit(args: PayArgs) {
    const res = await this.cfg.guard.pay(args);
    const where = res.explorer ?? `(demo tx ${res.txHash})`;
    this.log(res.ok ? `  guard: accepted  ${where}` : `  guard: REJECTED — ${res.error}  ${where}`);
    return res;
  }
}
