// GuardedWallet: the only way the agent can move money. It asks the risk service first and acts
// on the verdict; the LLM never sees keys or signatures.
//   block → refuse, nothing is signed
//   warn  → submit to the guard, which holds the payment until the owner approves on-chain
//   allow → submit to the guard, which re-checks the signature, limits and blocklist, then pays
import { Near } from "near-kit";
import type { CheckResult } from "../../risk/src/service.js";

export type PayOutcome =
  | { status: "sent"; txHash: string | null; check: CheckResult }
  | { status: "pending_owner"; txHash: string | null; check: CheckResult }
  | { status: "refused_by_wrapper"; check: CheckResult }
  | { status: "refused_by_contract"; txHash: string | null; error: string; check?: CheckResult };

export interface WalletConfig {
  guard: string;
  agent: string;
  agentKey: string; // function-call key scoped to the guard
  check: (receiver: string, amountYocto: string) => Promise<CheckResult>;
  log?: (line: string) => void;
}

export const explorerTx = (h: string | null) => `https://testnet.nearblocks.io/txns/${h}`;

export function toYocto(near: string): string {
  if (!/^\d+(\.\d{1,24})?$/.test(near)) throw new Error(`bad NEAR amount: ${near}`);
  const [i, f = ""] = near.split(".");
  return (BigInt(i) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

export class GuardedWallet {
  private near: Near;
  private log: (line: string) => void;

  constructor(private cfg: WalletConfig) {
    this.near = new Near({ network: "testnet", privateKey: cfg.agentKey as `ed25519:${string}`, defaultSignerId: cfg.agent });
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
    if (!res.ok) return { status: "refused_by_contract", txHash: res.txHash, error: res.error, check };
    if (check.verdict === "warn") {
      this.log(`  wallet: HELD by guard — owner must approve (npm run owner -- approve <id>)`);
      return { status: "pending_owner", txHash: res.txHash, check };
    }
    this.log(`  wallet: SENT`);
    return { status: "sent", txHash: res.txHash, check };
  }

  /** Calls `pay` on the guard. Exposed so the attack demo can show the contract layer alone. */
  async submit(args: { receiver: string; amount: string; memo: string; verdict: unknown }) {
    const tx = this.near
      .transaction(this.cfg.agent)
      .functionCall(this.cfg.guard, "pay", args, { gas: "50 Tgas" });
    await tx.sign();
    const txHash = tx.getHash();
    try {
      await tx.send();
      this.log(`  guard: accepted  ${explorerTx(txHash)}`);
      return { ok: true as const, txHash };
    } catch (e: any) {
      const error = String(e.panic ?? e.message);
      this.log(`  guard: REJECTED — ${error}  ${explorerTx(txHash)}`);
      return { ok: false as const, txHash, error };
    }
  }
}
