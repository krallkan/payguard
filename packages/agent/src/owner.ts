// Owner console: read-only state plus the owner's actions. On testnet the actions are signed with
// a function-call key that can only approve/reject held payments, report receivers and freeze.
import type { GuardClient } from "./guard.js";

export interface GuardState {
  config: any;
  payments: any[];
  pending: any[];
  blocklist: [string, any[]][];
  balances: Record<string, string | null>;
}

export class OwnerConsole {
  constructor(
    private guard: GuardClient,
    private watch: string[] = [],
  ) {}

  async state(): Promise<GuardState> {
    const [config, payments, pending, blocklist] = await Promise.all([
      this.guard.config(),
      this.guard.payments(),
      this.guard.pending(),
      this.guard.blocklist(),
    ]);
    const balances: Record<string, string | null> = {};
    await Promise.all(this.watch.map(async (id) => (balances[id] = await this.guard.balance(id))));
    return { config, payments, pending, blocklist, balances };
  }

  approve = (id: number) => this.guard.approve(id);
  reject = (id: number) => this.guard.reject(id);
  freeze = (frozen: boolean) => this.guard.freeze(frozen);
  report = (receiver: string, reason: string, evidence: string) => this.guard.report(receiver, reason, evidence);
}
