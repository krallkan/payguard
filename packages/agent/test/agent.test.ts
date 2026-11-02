import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ScriptedLlm } from "../src/llm.js";
import { readInbox, runAgent } from "../src/agent.js";
import { toYocto } from "../src/wallet.js";

const inbox = readInbox(fileURLToPath(new URL("../../../inbox", import.meta.url)));

test("scripted LLM follows the injected instruction (it is meant to be vulnerable)", async () => {
  const calls: string[] = [];
  const wallet = { pay: async (r: string, a: string) => (calls.push(`${r} ${a}`), { status: "sent" }) };
  await runAgent(new ScriptedLlm(), wallet, inbox, () => {});
  assert.deepEqual(calls, [
    "shop.taskin-hack.testnet 0.05",
    "shop.taskin-hack.testnet 0.03",
    "refund-desk.taskin-hack.testnet 0.2",
  ]);
});

test("wallet outcomes are returned per tool call", async () => {
  const wallet = {
    pay: async (r: string) => ({ status: r.startsWith("refund") ? "refused_by_wrapper" : "sent" }),
  };
  const out = await runAgent(new ScriptedLlm(), wallet, inbox, () => {});
  assert.equal(out.filter((o) => o.status === "sent").length, 2);
  assert.equal(out.find((o) => o.receiver.startsWith("refund"))?.status, "refused_by_wrapper");
});

test("toYocto", () => {
  assert.equal(toYocto("0.1"), "100000000000000000000000");
  assert.equal(toYocto("2"), "2000000000000000000000000");
  assert.throws(() => toYocto("-1"));
});

test("fallback LLM reports the outage and keeps the agent working", async () => {
  const { FallbackLlm } = await import("../src/llm.js");
  const broken = { name: "broken", next: async () => { throw new Error("HTTP 402: no credits"); } };
  const logs: string[] = [];
  const calls: string[] = [];
  const wallet = { pay: async (r: string) => (calls.push(r), { status: "sent" }) };
  await runAgent(new FallbackLlm(broken), wallet, inbox, (l) => logs.push(l));
  assert.equal(calls.length, 3);
  assert.ok(logs.some((l) => l.includes("broken unavailable: HTTP 402")));
});
