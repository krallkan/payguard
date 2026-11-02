// Demo-mode world: accounts and indexer facts the risk service sees instead of RPC/NearBlocks.
// Names match the testnet deployment so the README reads the same in both modes.
import type { Sources } from "../../risk/src/signals.js";
import type { SimGuard } from "./sim-guard.js";

const DAY = 24 * 3600_000;
const NEAR = 10n ** 24n;
const NO_CODE = "11111111111111111111111111111111";

export interface FixtureAccount {
  balance: bigint;
  contract: boolean;
  createdAgoMs: number | null; // null: indexer has no record
  txCount: number | null;
  lastDeployAgoMs: number | null;
  note: string;
}

export const DEMO_IDS = {
  guard: "guard.taskin-hack.testnet",
  owner: "taskin-hack.testnet",
  agent: "agent.taskin-hack.testnet",
  shop: "shop.taskin-hack.testnet",
  bad: "refund-desk.taskin-hack.testnet",
  newvendor: "newvendor.taskin-hack.testnet",
  vault: "vault.taskin-hack.testnet",
};

export const FIXTURE_ACCOUNTS: Record<string, FixtureAccount> = {
  [DEMO_IDS.owner]: { balance: 5n * NEAR, contract: false, createdAgoMs: 30 * DAY, txCount: 40, lastDeployAgoMs: null, note: "owner (human)" },
  [DEMO_IDS.agent]: { balance: 1n * NEAR, contract: false, createdAgoMs: 30 * DAY, txCount: 12, lastDeployAgoMs: null, note: "agent (function-call key only)" },
  [DEMO_IDS.shop]: { balance: NEAR / 2n, contract: false, createdAgoMs: 400 * DAY, txCount: 120, lastDeployAgoMs: null, note: "regular vendor, paid before" },
  [DEMO_IDS.bad]: { balance: NEAR / 2n, contract: false, createdAgoMs: 3 * DAY, txCount: 9, lastDeployAgoMs: null, note: "scammer, on the shared blocklist" },
  [DEMO_IDS.newvendor]: { balance: NEAR / 10n, contract: false, createdAgoMs: null, txCount: null, lastDeployAgoMs: null, note: "new vendor, indexer has no record → warn" },
  [DEMO_IDS.vault]: { balance: 2n * NEAR, contract: true, createdAgoMs: 200 * DAY, txCount: 300, lastDeployAgoMs: 2 * 3600_000, note: "contract whose code changed 2h ago → warn" },
  "hello.near-examples.testnet": { balance: 12n * NEAR, contract: true, createdAgoMs: 1490 * DAY, txCount: 1573, lastDeployAgoMs: 1490 * DAY, note: "old, busy contract → allow" },
};

/** Risk-service sources backed by fixtures and the simulated guard. */
export function demoSources(guard: SimGuard, accounts = FIXTURE_ACCOUNTS): Sources {
  const now = () => Date.now();
  return {
    async viewAccount(id) {
      const a = accounts[id];
      if (!a) return null;
      return { amount: a.balance.toString(), code_hash: a.contract ? "DemoCodeHash1111111111111111111111" : NO_CODE };
    },
    async nearblocksAccount(id) {
      const a = accounts[id];
      if (!a) return null;
      return { createdAtMs: a.createdAgoMs === null ? null : now() - a.createdAgoMs };
    },
    async nearblocksTxCount(id) {
      return accounts[id]?.txCount ?? null;
    },
    async nearblocksLastDeploy(id) {
      const a = accounts[id];
      return a?.lastDeployAgoMs == null ? null : now() - a.lastDeployAgoMs;
    },
    async guardBlockReports(id) {
      const entry = (await guard.blocklist()).find(([acc]) => acc === id);
      return (entry?.[1] ?? []).map((r: any) => ({ reporter: r.reporter, reason: r.reason, evidence: r.evidence }));
    },
    async guardPayments() {
      return guard.payments();
    },
  };
}
