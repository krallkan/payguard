import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, editDistance } from "../src/score.js";
import type { Signals } from "../src/signals.js";

const NOW = Date.UTC(2026, 10, 2);
const DAY = 24 * 3600_000;
const tenth = "100000000000000000000000";
const one = "1000000000000000000000000";

const base: Signals = {
  receiver: "shop.testnet",
  exists: true,
  balanceYocto: one,
  isContract: false,
  createdAtMs: NOW - 400 * DAY,
  txCount: 120,
  lastDeployAtMs: null,
  blocklisted: false,
  blockReports: [],
  priorPaymentsToReceiver: 3,
  knownReceivers: ["shop.testnet"],
  indexerError: null,
};

test("established receiver is allowed with a reason", () => {
  const a = assess(base, tenth, NOW);
  assert.equal(a.verdict, "allow");
  assert.equal(a.reasons[0].code, "ok");
});

test("blocklisted receiver is blocked and the evidence is quoted", () => {
  const a = assess(
    { ...base, blocklisted: true, blockReports: [{ reporter: "o.testnet", reason: "phishing", evidence: "tx 1" }] },
    tenth,
    NOW,
  );
  assert.equal(a.verdict, "block");
  assert.match(a.reasons[0].text, /phishing/);
});

test("missing account is blocked", () => {
  assert.equal(assess({ ...base, exists: false }, tenth, NOW).verdict, "block");
});

test("new account warns", () => {
  const a = assess({ ...base, createdAtMs: NOW - 2 * 3600_000 }, tenth, NOW);
  assert.equal(a.verdict, "warn");
  assert.equal(a.reasons[0].code, "new_account");
});

test("unknown age warns for a never-paid receiver", () => {
  const fresh = { ...base, createdAtMs: null, priorPaymentsToReceiver: 0, knownReceivers: [] };
  assert.equal(assess(fresh, tenth, NOW).reasons[0].code, "age_unknown");
});

test("indexer outage is named in the reason", () => {
  const fresh = { ...base, createdAtMs: null, priorPaymentsToReceiver: 0, knownReceivers: [], indexerError: "nearblocks HTTP 429 (rate limited)" };
  assert.match(assess(fresh, tenth, NOW).reasons[0].text, /rate limited/);
});

test("unknown age is fine for a receiver paid before", () => {
  assert.equal(assess({ ...base, createdAtMs: null }, tenth, NOW).verdict, "allow");
});

test("recent code change warns", () => {
  const a = assess({ ...base, isContract: true, lastDeployAtMs: NOW - 3600_000 }, tenth, NOW);
  assert.equal(a.verdict, "warn");
  assert.ok(a.reasons.some((r) => r.code === "recent_deploy"));
});

test("large first payment warns, small one does not", () => {
  const fresh = { ...base, priorPaymentsToReceiver: 0, knownReceivers: [] };
  assert.equal(assess(fresh, one, NOW).verdict, "warn");
  assert.equal(assess(fresh, tenth, NOW).verdict, "allow");
});

test("look-alike of a known receiver warns", () => {
  const a = assess({ ...base, receiver: "sh0p.testnet", priorPaymentsToReceiver: 0 }, tenth, NOW);
  assert.ok(a.reasons.some((r) => r.code === "look_alike"));
});

test("block beats warn", () => {
  const a = assess({ ...base, createdAtMs: null, blocklisted: true, blockReports: [{ reporter: "x", reason: "r", evidence: "" }] }, tenth, NOW);
  assert.equal(a.verdict, "block");
});

test("edit distance", () => {
  assert.equal(editDistance("shop", "sh0p"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("", "ab"), 2);
});
