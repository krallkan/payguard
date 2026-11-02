// Owner console actions and read-only state. Signs with the owner's function-call key, which can
// only approve/reject held payments, report receivers and freeze the guard (no withdrawals).
import { Near } from "near-kit";
import { explorerTx } from "./wallet.js";

export interface GuardState {
  config: any;
  payments: any[];
  pending: any[];
  blocklist: [string, any[]][];
  balances: Record<string, string | null>;
}

export class OwnerConsole {
  private near: Near;
  constructor(
    private guard: string,
    private owner: string,
    consoleKey: string | undefined,
    private watch: string[] = [],
  ) {
    this.near = consoleKey
      ? new Near({ network: "testnet", privateKey: consoleKey as `ed25519:${string}`, defaultSignerId: owner })
      : new Near({ network: "testnet" });
  }

  async state(): Promise<GuardState> {
    // Optimistic finality so a payment shows up right after its transaction returns.
    const v = <T>(m: string, a: object = {}) => this.near.view<T>(this.guard, m, a, { finality: "optimistic" });
    const [config, payments, pending, blocklist] = await Promise.all([
      v<any>("get_config"),
      v<any[]>("get_payments", { limit: 100 }),
      v<any[]>("get_pending"),
      v<[string, any[]][]>("get_blocklist", { limit: 100 }),
    ]);
    const balances: Record<string, string | null> = {};
    await Promise.all(
      this.watch.map(async (id) => {
        balances[id] = await this.near.getBalance(id, { finality: "optimistic" }).catch(() => null);
      }),
    );
    return { config, payments: payments ?? [], pending: pending ?? [], blocklist: blocklist ?? [], balances };
  }

  approve = (id: number) => this.call("approve_pending", { id });
  reject = (id: number) => this.call("reject_pending", { id });
  freeze = (frozen: boolean) => this.call("set_frozen", { frozen });
  report = (receiver: string, reason: string, evidence: string) => this.call("report", { receiver, reason, evidence });

  private async call(method: string, args: object) {
    const tx = this.near.transaction(this.owner).functionCall(this.guard, method, args, { gas: "50 Tgas" });
    await tx.sign();
    const txHash = tx.getHash();
    try {
      await tx.send();
      return { ok: true, txHash, explorer: explorerTx(txHash) };
    } catch (e: any) {
      return { ok: false, txHash, explorer: explorerTx(txHash), error: String(e.panic ?? e.message) };
    }
  }
}
