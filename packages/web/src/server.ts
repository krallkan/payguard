// Web console: serves the single-page UI and a small JSON API over the guard, the risk service,
// the agent and the owner console. Local tool for the owner; binds to localhost only.
import "dotenv/config";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { liveSources } from "../../risk/src/signals.js";
import { createRiskService } from "../../risk/src/service.js";
import { GuardedWallet, toYocto } from "../../agent/src/wallet.js";
import { NearAiLlm, ScriptedLlm } from "../../agent/src/llm.js";
import { readInbox, runAgent } from "../../agent/src/agent.js";
import { OwnerConsole } from "../../agent/src/owner.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] || d;
  if (!v) throw new Error(`missing ${k} in .env`);
  return v;
};
const GUARD = env("GUARD_CONTRACT_ID");
const AGENT = env("AGENT_ACCOUNT_ID");
const OWNER = env("OWNER_ACCOUNT_ID");
const watch = [AGENT, process.env.SHOP_ACCOUNT_ID, process.env.BAD_ACCOUNT_ID, process.env.NEWVENDOR_ACCOUNT_ID].filter(Boolean) as string[];

const risk = createRiskService({
  sources: liveSources({
    rpcUrl: env("NEAR_RPC_URL", "https://rpc.testnet.near.org"),
    nearblocksUrl: env("NEARBLOCKS_API_URL", "https://api-testnet.nearblocks.io"),
    guard: GUARD,
  }),
  guard: GUARD,
  agent: AGENT,
  oracleKey: env("ORACLE_PRIVATE_KEY"),
});
const owner = new OwnerConsole(GUARD, OWNER, process.env.OWNER_CONSOLE_KEY, watch);
const inboxDir = fileURLToPath(new URL("../../../inbox", import.meta.url));
const indexHtml = fileURLToPath(new URL("../public/index.html", import.meta.url));

/** A wallet whose log lines are collected for the response. */
function walletWithLog() {
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  const wallet = new GuardedWallet({
    guard: GUARD,
    agent: AGENT,
    agentKey: env("AGENT_PRIVATE_KEY"),
    check: (receiver, amountYocto) => risk({ receiver, amountYocto }),
    log,
  });
  return { wallet, lines, log };
}

const routes: Record<string, (body: any) => Promise<unknown>> = {
  "GET /api/state": async () => ({ guard: GUARD, agent: AGENT, owner: OWNER, ownerConsole: !!process.env.OWNER_CONSOLE_KEY, ...(await owner.state()) }),
  "POST /api/check": async (b) => risk({ receiver: String(b.receiver), amountYocto: toYocto(String(b.amountNear)) }),
  "POST /api/pay": async (b) => {
    const { wallet, lines } = walletWithLog();
    const outcome = await wallet.pay(String(b.receiver), String(b.amountNear), String(b.memo ?? "manual"));
    return { outcome: { ...outcome, check: undefined, verdict: outcome.check?.verdict }, log: lines };
  },
  "POST /api/agent/run": async () => {
    const { wallet, lines, log } = walletWithLog();
    const llm = process.env.NEAR_AI_API_KEY ? new NearAiLlm(process.env.NEAR_AI_API_KEY, process.env.NEAR_AI_MODEL || undefined) : new ScriptedLlm();
    log(`LLM: ${llm.name}`);
    const outcomes = await runAgent(llm, wallet, readInbox(inboxDir), log);
    return { outcomes, log: lines };
  },
  "GET /api/inbox": async () => ({ inbox: readInbox(inboxDir) }),
  "POST /api/owner/approve": async (b) => owner.approve(Number(b.id)),
  "POST /api/owner/reject": async (b) => owner.reject(Number(b.id)),
  "POST /api/owner/freeze": async (b) => owner.freeze(Boolean(b.frozen)),
  "POST /api/owner/report": async (b) => owner.report(String(b.receiver), String(b.reason), String(b.evidence ?? "")),
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const port = Number(process.env.PORT || 3000);
createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (req.method === "GET" && path === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(readFileSync(indexHtml));
  }
  const route = routes[`${req.method} ${path}`];
  if (!route) return json(res, 404, { error: "not found" });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return json(res, 413, { error: "body too large" });
  }
  try {
    json(res, 200, await route(raw ? JSON.parse(raw) : {}));
  } catch (e: any) {
    json(res, 400, { error: e.message });
  }
}).listen(port, "127.0.0.1", () => console.log(`PayGuard console on http://localhost:${port}`));
