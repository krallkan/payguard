// In-memory port of contract/src/lib.rs for demo mode. Same checks, same order, same panic
// messages, real ed25519 verification. Balances are simulated; nothing touches a chain.
import { createPublicKey, verify as edVerify } from "node:crypto";
import bs58 from "bs58";
import { verdictMessage, type Verdict } from "../../risk/src/verdict.js";
import type { GuardClient, PayArgs, TxResult } from "../../agent/src/guard.js";

const NS_PER_DAY = 86_400n * 1_000_000_000n;
const YOCTO = 10n ** 24n;
const RESERVE = YOCTO / 10n; // BALANCE_RESERVE: 0.1 NEAR
const MAX_TEXT = 280;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

class Panic extends Error {}
const require_ = (cond: unknown, msg: string): void => {
  if (!cond) throw new Panic(msg);
};

interface Payment {
  id: number;
  receiver: string;
  amount: string;
  verdict: Verdict;
  status: "sent" | "pending" | "rejected" | "failed";
  memo: string;
  created_at: string;
}
interface Report {
  reporter: string;
  reason: string;
  evidence: string;
  at: string;
}

export interface SimGuardInit {
  guard: string;
  owner: string;
  agent: string;
  oraclePublicKey: string; // "ed25519:<base58 32 bytes>"
  perTxLimitYocto: bigint;
  dailyLimitYocto: bigint;
  guardBalanceYocto: bigint;
  accounts: Record<string, bigint>; // existing accounts and their balances
}

export class SimGuard implements GuardClient {
  readonly mode = "demo" as const;
  private oracleKey;
  private frozen = false;
  private dayIndex: bigint;
  private spentToday = 0n;
  private usedNonces = new Set<string>();
  private pendingIds = new Set<number>();
  private blocked = new Map<string, Report[]>();
  private log: Payment[] = [];
  private balances: Map<string, bigint>;
  private txCounter = 0;
  /** Who the next call comes from. The app sets it per action; tests can set it to anything. */
  caller: string;

  constructor(private c: SimGuardInit) {
    const raw = bs58.decode(c.oraclePublicKey.replace(/^ed25519:/, ""));
    this.oracleKey = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" });
    this.balances = new Map(Object.entries(c.accounts));
    this.balances.set(c.guard, c.guardBalanceYocto);
    this.dayIndex = this.now() / NS_PER_DAY;
    this.caller = c.agent;
  }

  // ------------------------------------------------------------- GuardClient

  pay = (a: PayArgs) => this.tx(this.c.agent, () => this.payInner(a.receiver, BigInt(a.amount), a.memo, a.verdict as any));
  approve = (id: number) => this.tx(this.c.owner, () => this.approveInner(id));
  reject = (id: number) =>
    this.tx(this.c.owner, () => {
      this.assertOwner();
      require_(this.pendingIds.delete(id), "no pending payment with this id");
      this.log[id].status = "rejected";
    });
  freeze = (frozen: boolean) =>
    this.tx(this.c.owner, () => {
      this.assertOwner();
      this.frozen = frozen;
    });
  report = (receiver: string, reason: string, evidence: string) =>
    this.tx(this.c.owner, () => this.reportInner(receiver, reason, evidence, 0n));

  async config() {
    return {
      owner: this.c.owner,
      agent: this.c.agent,
      oracle_pk: this.c.oraclePublicKey,
      per_tx_limit: this.c.perTxLimitYocto.toString(),
      daily_limit: this.c.dailyLimitYocto.toString(),
      spent_today: (this.now() / NS_PER_DAY === this.dayIndex ? this.spentToday : 0n).toString(),
      frozen: this.frozen,
      available: this.available().toString(),
    };
  }
  async payments() {
    return this.log.map((p) => ({ ...p }));
  }
  async pending() {
    return [...this.pendingIds].map((id) => ({ ...this.log[id] }));
  }
  async blocklist(): Promise<[string, any[]][]> {
    return [...this.blocked.entries()].map(([k, v]) => [k, v.map((r) => ({ ...r }))]);
  }
  async balance(id: string) {
    const b = this.balances.get(id);
    if (b === undefined) return null;
    const s = (b * 100n) / YOCTO; // 2 decimals, like near-kit's getBalance
    return `${s / 100n}.${(s % 100n).toString().padStart(2, "0")}`;
  }

  /** Raw call as any account, for tests and the bypass demo. */
  callAs(caller: string, fn: () => void): TxResult {
    const before = this.caller;
    this.caller = caller;
    try {
      fn();
      return { ok: true, txHash: this.hash(), explorer: null };
    } catch (e) {
      if (!(e instanceof Panic)) throw e;
      return { ok: false, txHash: this.hash(), explorer: null, error: `Smart contract panicked: ${e.message}` };
    } finally {
      this.caller = before;
    }
  }

  /** Report as any account with an attached deposit (stranger reports need 0.01 NEAR). */
  reportAs(caller: string, receiver: string, reason: string, evidence: string, depositYocto = 0n) {
    return this.callAs(caller, () => this.reportInner(receiver, reason, evidence, depositYocto));
  }

  // ------------------------------------------------------------- contract logic

  private payInner(receiver: string, amount: bigint, memo: string | undefined, v: any) {
    require_(!this.frozen, "guard is frozen");
    require_(this.caller === this.c.agent, "only the agent can pay");
    require_(amount > 0n, "amount must be positive");
    memo ??= "";
    require_(memo.length <= MAX_TEXT, "memo too long");

    this.verifyVerdict(receiver, amount, v);
    require_(v.verdict !== "block", "blocked by risk oracle");
    require_(!this.blocked.has(receiver), "receiver is on the shared blocklist");
    require_(amount <= this.c.perTxLimitYocto, "amount exceeds per-transaction limit");

    const payment: Payment = {
      id: this.log.length,
      receiver,
      amount: amount.toString(),
      verdict: v.verdict,
      status: "pending",
      memo,
      created_at: this.now().toString(),
    };
    if (v.verdict === "warn") {
      this.pendingIds.add(payment.id);
      this.log.push(payment);
      return;
    }
    this.send(payment);
    payment.status = this.transfer(receiver, amount) ? "sent" : "failed";
    if (payment.status === "failed") this.spentToday -= amount;
    this.log.push(payment);
  }

  private approveInner(id: number) {
    this.assertOwner();
    require_(!this.frozen, "guard is frozen");
    require_(this.pendingIds.delete(id), "no pending payment with this id");
    const p = this.log[id];
    require_(!this.blocked.has(p.receiver), "receiver is on the shared blocklist");
    require_(BigInt(p.amount) <= this.c.perTxLimitYocto, "amount exceeds per-transaction limit");
    this.send(p);
    p.status = this.transfer(p.receiver, BigInt(p.amount)) ? "sent" : "failed";
    if (p.status === "failed") this.spentToday -= BigInt(p.amount);
  }

  private reportInner(receiver: string, reason: string, evidence: string, deposit: bigint) {
    if (this.caller !== this.c.owner && this.caller !== this.c.agent) require_(deposit >= YOCTO / 100n, "attach 0.01 NEAR to report");
    require_(reason.length <= MAX_TEXT && evidence.length <= MAX_TEXT, "text too long");
    require_(reason.length > 0, "reason is required");
    const reports = this.blocked.get(receiver) ?? [];
    require_(reports.length < 20, "too many reports for this account");
    reports.push({ reporter: this.caller, reason, evidence, at: this.now().toString() });
    this.blocked.set(receiver, reports);
  }

  private verifyVerdict(receiver: string, amount: bigint, v: any) {
    require_(BigInt(v?.expires_at ?? 0) > this.now(), "verdict expired");
    require_(!this.usedNonces.has(String(v.nonce)), "verdict nonce already used");
    const sig = Buffer.from(String(v.signature ?? ""), "base64");
    require_(sig.length === 64, "signature must be 64 bytes");
    const msg = verdictMessage(this.c.guard, this.caller, receiver, amount.toString(), v.verdict, String(v.nonce), String(v.expires_at));
    require_(edVerify(null, Buffer.from(msg, "utf8"), this.oracleKey, sig), "invalid oracle signature");
    this.usedNonces.add(String(v.nonce));
  }

  private send(p: Payment) {
    const today = this.now() / NS_PER_DAY;
    if (today !== this.dayIndex) {
      this.dayIndex = today;
      this.spentToday = 0n;
    }
    const amount = BigInt(p.amount);
    const spent = this.spentToday + amount;
    require_(spent <= this.c.dailyLimitYocto, "amount exceeds daily limit");
    require_(amount <= this.available(), "not enough available balance");
    this.spentToday = spent;
  }

  /** Mirrors the transfer receipt: fails (and the callback marks the payment failed) if the receiver does not exist. */
  private transfer(receiver: string, amount: bigint): boolean {
    this.balances.set(this.c.guard, this.balances.get(this.c.guard)! - amount);
    if (!this.balances.has(receiver)) {
      this.balances.set(this.c.guard, this.balances.get(this.c.guard)! + amount);
      return false;
    }
    this.balances.set(receiver, this.balances.get(receiver)! + amount);
    return true;
  }

  private assertOwner() {
    require_(this.caller === this.c.owner, "only the owner");
  }
  private available() {
    const b = (this.balances.get(this.c.guard) ?? 0n) - RESERVE;
    return b > 0n ? b : 0n;
  }
  private now() {
    return BigInt(Date.now()) * 1_000_000n;
  }
  private hash() {
    return `demo-${++this.txCounter}`;
  }
  private async tx(as: string, fn: () => void): Promise<TxResult> {
    return this.callAs(as, fn);
  }
}
