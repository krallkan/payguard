// Web console: serves the single-page UI and a small JSON API over the guard, the risk service,
// the agent and the owner console. Local tool for the owner; binds to localhost only.
import "dotenv/config";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext } from "../../app/src/context.js";
import { toYocto } from "../../agent/src/wallet.js";
import { readInbox, runAgent } from "../../agent/src/agent.js";

const ctx = await createContext();
const inboxDir = fileURLToPath(new URL("../../../inbox", import.meta.url));
const indexHtml = fileURLToPath(new URL("../public/index.html", import.meta.url));
const canOwn = ctx.mode === "demo" || !!process.env.OWNER_CONSOLE_KEY;

function collector() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

const routes: Record<string, (body: any) => Promise<unknown>> = {
  "GET /api/state": async () => ({ mode: ctx.mode, ...ctx.ids, ownerConsole: canOwn, ...(await ctx.owner.state()) }),
  "POST /api/check": async (b) => ctx.check({ receiver: String(b.receiver), amountYocto: toYocto(String(b.amountNear)) }),
  "POST /api/pay": async (b) => {
    const { lines, log } = collector();
    const outcome = await ctx.wallet(log).pay(String(b.receiver), String(b.amountNear), String(b.memo || "manual"));
    return { outcome: { status: outcome.status, verdict: (outcome as any).check?.verdict }, log: lines };
  },
  "POST /api/agent/run": async () => {
    const { lines, log } = collector();
    log(`LLM: ${ctx.llm.name}`);
    const outcomes = await runAgent(ctx.llm, ctx.wallet(log), readInbox(inboxDir), log);
    return { outcomes, log: lines };
  },
  "POST /api/attack/bypass": async () => {
    // The attacker owns the agent process and calls the guard directly, skipping the wallet.
    const { lines, log } = collector();
    const w = ctx.wallet(log);
    const amount = toYocto("0.2");
    log(`2a. genuine allow issued for ${ctx.ids.shop}, re-targeted to ${ctx.ids.bad}`);
    const shopAllow = await ctx.check({ receiver: ctx.ids.shop, amountYocto: amount });
    await w.submit({ receiver: ctx.ids.bad, amount, memo: "bypass: re-targeted verdict", verdict: shopAllow.signed });
    log(`\n2b. compromised oracle signs allow for ${ctx.ids.bad}`);
    await w.submit({ receiver: ctx.ids.bad, amount, memo: "bypass: compromised oracle", verdict: ctx.compromisedOracleSign(ctx.ids.bad, amount) });
    return { log: lines };
  },
  "GET /api/inbox": async () => ({ inbox: readInbox(inboxDir) }),
  "POST /api/owner/approve": async (b) => ctx.owner.approve(Number(b.id)),
  "POST /api/owner/reject": async (b) => ctx.owner.reject(Number(b.id)),
  "POST /api/owner/freeze": async (b) => ctx.owner.freeze(Boolean(b.frozen)),
  "POST /api/owner/report": async (b) => ctx.owner.report(String(b.receiver), String(b.reason), String(b.evidence ?? "")),
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
}).listen(port, "127.0.0.1", () => {
  console.log(`PayGuard console (${ctx.mode} mode) on http://localhost:${port}`);
  if (ctx.mode === "demo") console.log("Demo mode: simulated guard contract and fixtures, no keys or funds needed. Set DEMO=0 in .env for testnet.");
});
