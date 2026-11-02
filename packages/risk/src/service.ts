// Risk check: signals → assessment → signed verdict. Used by the HTTP server and the CLI.
import { collectSignals, type Signals, type Sources } from "./signals.js";
import { assess, type Reason } from "./score.js";
import { signVerdict, type SignedVerdict, type Verdict } from "./verdict.js";

export interface CheckRequest {
  receiver: string;
  amountYocto: string;
}

export interface CheckResult {
  receiver: string;
  amountYocto: string;
  verdict: Verdict;
  reasons: Reason[];
  signals: Signals;
  signed: SignedVerdict;
}

export function createRiskService(cfg: { sources: Sources; guard: string; agent: string; oracleKey: string }) {
  return async function check(req: CheckRequest): Promise<CheckResult> {
    if (!/^[a-z0-9._-]{2,64}$/.test(req.receiver)) throw new Error("invalid receiver account id");
    if (!/^[1-9][0-9]{0,38}$/.test(req.amountYocto)) throw new Error("amountYocto must be a positive integer string");

    const signals = await collectSignals(cfg.sources, req.receiver);
    const { verdict, reasons } = assess(signals, req.amountYocto);
    const signed = signVerdict(cfg.oracleKey, {
      guard: cfg.guard,
      agent: cfg.agent,
      receiver: req.receiver,
      amountYocto: req.amountYocto,
      verdict,
    });
    return { receiver: req.receiver, amountYocto: req.amountYocto, verdict, reasons, signals, signed };
  };
}
