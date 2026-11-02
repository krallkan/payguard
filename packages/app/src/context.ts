// Builds the app for one of two modes and hands the same pieces to the web console, the attack
// demo and the owner CLI.
//   demo    (DEMO=1, the default without .env): simulated guard + fixtures + fresh in-memory keys.
//   testnet (DEMO=0): the deployed guard contract, live RPC/NearBlocks, keys from .env.
import { generateKey } from "near-kit";
import { liveSources, type Sources } from "../../risk/src/signals.js";
import { createRiskService } from "../../risk/src/service.js";
import { signVerdict } from "../../risk/src/verdict.js";
import { NearGuardClient, type GuardClient } from "../../agent/src/guard.js";
import { GuardedWallet } from "../../agent/src/wallet.js";
import { FallbackLlm, NearAiLlm, ScriptedLlm, type Llm } from "../../agent/src/llm.js";
import { OwnerConsole } from "../../agent/src/owner.js";
import { SimGuard } from "../../sim/src/sim-guard.js";
import { DEMO_IDS, FIXTURE_ACCOUNTS, demoSources } from "../../sim/src/fixtures.js";

export interface AppContext {
  mode: "demo" | "testnet";
  ids: { guard: string; owner: string; agent: string; shop: string; bad: string; newvendor?: string };
  guard: GuardClient;
  sources: Sources;
  check: ReturnType<typeof createRiskService>;
  owner: OwnerConsole;
  llm: Llm;
  wallet(log?: (l: string) => void): GuardedWallet;
  /** Signs any verdict with the oracle key. Used only by the attack demo to play a compromised oracle. */
  compromisedOracleSign(receiver: string, amountYocto: string): unknown;
}

const NEAR = 10n ** 24n;

export function isDemo(env = process.env): boolean {
  return (env.DEMO ?? "1") !== "0";
}

export async function createContext(env = process.env): Promise<AppContext> {
  return isDemo(env) ? createDemoContext(env) : createTestnetContext(env);
}

function pickLlm(env: NodeJS.ProcessEnv): Llm {
  return env.NEAR_AI_API_KEY ? new FallbackLlm(new NearAiLlm(env.NEAR_AI_API_KEY, env.NEAR_AI_MODEL || undefined)) : new ScriptedLlm();
}

export async function createDemoContext(env = process.env): Promise<AppContext> {
  const oracle = generateKey();
  const ids = { ...DEMO_IDS };
  const balances = Object.fromEntries(Object.entries(FIXTURE_ACCOUNTS).map(([id, a]) => [id, a.balance]));
  const guard = new SimGuard({
    guard: ids.guard,
    owner: ids.owner,
    agent: ids.agent,
    oraclePublicKey: oracle.publicKey.toString(),
    perTxLimitYocto: NEAR / 2n,
    dailyLimitYocto: NEAR,
    guardBalanceYocto: 3n * NEAR,
    accounts: balances,
  });
  const sources = demoSources(guard);
  const check = createRiskService({ sources, guard: ids.guard, agent: ids.agent, oracleKey: oracle.secretKey });

  // Same starting state as the testnet deployment: the scammer is reported, the shop was paid once.
  await guard.report(ids.bad, "Impersonates vendors in invoice emails and asks agents to pay a 'refund desk'", "demo: inbox/invoice-003.txt (prompt injection)");
  const first = await check({ receiver: ids.shop, amountYocto: (NEAR / 10n).toString() });
  await guard.pay({ receiver: ids.shop, amount: (NEAR / 10n).toString(), memo: "setup: first order", verdict: first.signed });

  return {
    mode: "demo",
    ids,
    guard,
    sources,
    check,
    owner: new OwnerConsole(guard, [ids.agent, ids.shop, ids.bad, ids.newvendor, ids.vault]),
    llm: pickLlm(env),
    wallet: (log) => new GuardedWallet({ guard, check: (receiver, amountYocto) => check({ receiver, amountYocto }), log }),
    compromisedOracleSign: (receiver, amountYocto) =>
      signVerdict(oracle.secretKey, { guard: ids.guard, agent: ids.agent, receiver, amountYocto, verdict: "allow" }),
  };
}

export async function createTestnetContext(env = process.env): Promise<AppContext> {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`DEMO=0 needs ${k} in .env (see .env.example), or run with DEMO=1`);
    return v;
  };
  const ids = {
    guard: need("GUARD_CONTRACT_ID"),
    owner: need("OWNER_ACCOUNT_ID"),
    agent: need("AGENT_ACCOUNT_ID"),
    shop: need("SHOP_ACCOUNT_ID"),
    bad: need("BAD_ACCOUNT_ID"),
    newvendor: env.NEWVENDOR_ACCOUNT_ID,
  };
  const oracleKey = need("ORACLE_PRIVATE_KEY");
  const guard = new NearGuardClient({
    guard: ids.guard,
    agent: ids.agent,
    agentKey: env.AGENT_PRIVATE_KEY,
    owner: ids.owner,
    ownerConsoleKey: env.OWNER_CONSOLE_KEY,
  });
  const sources = liveSources({
    rpcUrl: env.NEAR_RPC_URL || "https://rpc.testnet.near.org",
    nearblocksUrl: env.NEARBLOCKS_API_URL || "https://api-testnet.nearblocks.io",
    guard: ids.guard,
  });
  const check = createRiskService({ sources, guard: ids.guard, agent: ids.agent, oracleKey });
  return {
    mode: "testnet",
    ids,
    guard,
    sources,
    check,
    owner: new OwnerConsole(guard, [ids.agent, ids.shop, ids.bad, ids.newvendor].filter(Boolean) as string[]),
    llm: pickLlm(env),
    wallet: (log) => new GuardedWallet({ guard, check: (receiver, amountYocto) => check({ receiver, amountYocto }), log }),
    compromisedOracleSign: (receiver, amountYocto) =>
      signVerdict(oracleKey, { guard: ids.guard, agent: ids.agent, receiver, amountYocto, verdict: "allow" }),
  };
}
