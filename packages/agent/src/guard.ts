// GuardClient: everything the app needs from the guard contract. `NearGuardClient` talks to the
// deployed contract on testnet; `SimGuard` (packages/sim) runs the same rules in memory for demo mode.
import { Near } from "near-kit";

export interface TxResult {
  ok: boolean;
  txHash: string | null;
  explorer: string | null; // null in demo mode (no chain)
  error?: string;
}

export interface PayArgs {
  receiver: string;
  amount: string; // yocto
  memo: string;
  verdict: unknown; // SignedVerdict as JSON
}

export interface GuardClient {
  readonly mode: "testnet" | "demo";
  /** Agent → guard.pay */
  pay(args: PayArgs): Promise<TxResult>;
  /** Owner actions */
  approve(id: number): Promise<TxResult>;
  reject(id: number): Promise<TxResult>;
  report(receiver: string, reason: string, evidence: string): Promise<TxResult>;
  freeze(frozen: boolean): Promise<TxResult>;
  /** Views */
  config(): Promise<any>;
  payments(): Promise<any[]>;
  pending(): Promise<any[]>;
  blocklist(): Promise<[string, any[]][]>;
  balance(accountId: string): Promise<string | null>; // decimal NEAR
}

export const explorerTx = (h: string | null) => (h ? `https://testnet.nearblocks.io/txns/${h}` : null);

export class NearGuardClient implements GuardClient {
  readonly mode = "testnet" as const;
  private agentNear?: Near;
  private ownerNear?: Near;
  private reader = new Near({ network: "testnet" });

  constructor(private o: { guard: string; agent: string; agentKey?: string; owner: string; ownerConsoleKey?: string }) {
    if (o.agentKey) this.agentNear = new Near({ network: "testnet", privateKey: o.agentKey as `ed25519:${string}`, defaultSignerId: o.agent });
    if (o.ownerConsoleKey)
      this.ownerNear = new Near({ network: "testnet", privateKey: o.ownerConsoleKey as `ed25519:${string}`, defaultSignerId: o.owner });
  }

  pay = (args: PayArgs) => this.call(this.agentNear, this.o.agent, "pay", args, "AGENT_PRIVATE_KEY");
  approve = (id: number) => this.call(this.ownerNear, this.o.owner, "approve_pending", { id }, "OWNER_CONSOLE_KEY");
  reject = (id: number) => this.call(this.ownerNear, this.o.owner, "reject_pending", { id }, "OWNER_CONSOLE_KEY");
  report = (receiver: string, reason: string, evidence: string) =>
    this.call(this.ownerNear, this.o.owner, "report", { receiver, reason, evidence }, "OWNER_CONSOLE_KEY");
  freeze = (frozen: boolean) => this.call(this.ownerNear, this.o.owner, "set_frozen", { frozen }, "OWNER_CONSOLE_KEY");

  // Optimistic finality so a payment shows up right after its transaction returns.
  private view = async <T>(m: string, a: object = {}) =>
    (await this.reader.view<T>(this.o.guard, m, a, { finality: "optimistic" })) as T;
  config = () => this.view<any>("get_config");
  payments = async () => (await this.view<any[]>("get_payments", { limit: 100 })) ?? [];
  pending = async () => (await this.view<any[]>("get_pending")) ?? [];
  blocklist = async () => (await this.view<[string, any[]][]>("get_blocklist", { limit: 100 })) ?? [];
  balance = (id: string) => this.reader.getBalance(id, { finality: "optimistic" }).catch(() => null);

  private async call(near: Near | undefined, signer: string, method: string, args: object, keyName: string): Promise<TxResult> {
    if (!near) throw new Error(`${keyName} is not set in .env`);
    const tx = near.transaction(signer).functionCall(this.o.guard, method, args, { gas: "50 Tgas" });
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
