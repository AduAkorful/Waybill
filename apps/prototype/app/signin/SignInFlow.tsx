"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { buyer, inspector } from "@/demo/deal";
import { needsBuyer } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { useDemo } from "@/demo/store";

type Step = "start" | "code" | "wallet" | "network" | "roles";
type Role = "buyer" | "attestor" | "arbiter";

const routes: Record<Role, string> = { buyer: "/app", attestor: "/attest", arbiter: "/arbiter" };
const wallets = ["Browser wallet", "WalletConnect", "Coinbase Wallet"];

export function SignInFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const { deals } = useDemo();
  const as = params.get("as") as Role | "supplier" | null;
  const invite = params.get("invite")?.toUpperCase() ?? null;
  const inv = invite ? deals[invite] : undefined;

  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState(as === "attestor" ? "lin.mei@pearlgate.demo" : "ama@owusu-electronics.demo");
  const [emailErr, setEmailErr] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [codeErr, setCodeErr] = useState("");
  const [wait, setWait] = useState(30);
  const [identity, setIdentity] = useState("");
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step !== "code" || wait <= 0) return;
    const h = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(h);
  }, [step, wait]);

  // Where this person goes, from the link they followed
  const go = (role?: Role) => {
    if (inv && as === "attestor") return router.push(`/attest/invite/${inv.id}`);
    if (as === "supplier" && invite) return router.push(`/d/${invite}`);
    router.push(routes[role ?? (as === "attestor" || as === "arbiter" ? as : "buyer")]);
  };
  const arrive = (id: string) => {
    setIdentity(id);
    if (as === "buyer" || as === "attestor" || as === "arbiter" || as === "supplier") go();
    else setStep("roles");
  };

  const sendCode = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setEmailErr("That doesn't look like an email address.");
    setEmailErr("");
    setCodeErr("");
    setDigits(Array(6).fill(""));
    setWait(30);
    setStep("code");
    setTimeout(() => boxes.current[0]?.focus(), 50);
  };

  const setDigit = (i: number, v: string) => {
    const only = v.replace(/\D/g, "");
    if (only.length > 1) {
      // A pasted code fills every box
      const next = only.slice(0, 6).split("");
      setDigits([...next, ...Array(6 - next.length).fill("")]);
      boxes.current[Math.min(next.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = only;
    setDigits(next);
    setCodeErr("");
    if (only && i < 5) boxes.current[i + 1]?.focus();
  };

  const verify = () => {
    const code = digits.join("");
    if (code.length < 6) return setCodeErr("Enter all six digits.");
    if (code === "000000") return setCodeErr("That code didn't match. Check the latest email, or send a new one.");
    arrive(email.trim());
  };

  const counts = {
    buyer: Object.values(deals).filter((d) => needsBuyer(d)).length,
    buyerTotal: Object.values(deals).length,
    attestor: Object.values(deals).filter((d) =>
      d.tranches.some((t) => t.confirmedBy.startsWith(inspector.name) && ((d.state === "funded" && (t.state === "waiting" || t.state === "overdue")) || (d.state === "proposed" && d.acceptances.some((a) => a.role === "Inspector" && !a.done)))),
    ).length,
    arbiter: Object.values(deals).reduce((n, d) => n + Object.values(d.disputes ?? {}).filter((r) => !r.decision && !r.withdrawn && r.responseClosed).length, 0),
  };

  const heading =
    step === "roles"
      ? "How are you using Waybill today?"
      : step === "code"
        ? "Enter the code we sent"
        : step === "wallet"
          ? "Connect a wallet"
          : step === "network"
            ? "Switch to Arc"
            : as === "attestor"
              ? "Sign in to confirm goods"
              : as === "buyer"
                ? "Sign in to start a deal"
                : "Sign in to Waybill";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      {/* Context: why you're here */}
      <aside className="relative hidden overflow-hidden border-r border-rule bg-sheet lg:block">
        <div className="flex h-full flex-col justify-between p-10">
          <Link href="/">
            <Wordmark />
          </Link>
          {inv ? (
            <div>
              <p className="label">You were invited to</p>
              <p className="mono mt-3 text-[15px]">{inv.id}</p>
              <p className="condensed mt-2 text-[64px] leading-[0.9] font-extrabold tracking-tight">
                {inv.origin.code} → {inv.destination.code}
              </p>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-graphite">
                {inv.buyer.name} is buying {inv.goods.toLowerCase()} from {inv.supplier.org}.{" "}
                {inv.state === "funded" || inv.state === "settled" ? `${usdc(inv.funded)} USDC is locked in escrow.` : `${usdc(inv.funded)} USDC will be locked once everyone accepts.`} You were named to confirm the{" "}
                {inv.tranches.find((t) => t.confirmedBy.startsWith(inspector.name))?.short.toLowerCase() ?? "goods"}.
              </p>
            </div>
          ) : (
            <div>
              <p className="label">Waybill</p>
              <p className="mt-3 max-w-md text-[34px] leading-[1.08] font-semibold tracking-tight">
                Pay a deposit. Release the rest when <span className="marked">someone you trust</span> confirms the goods.
              </p>
              <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-graphite">One sign-in for every role. Your role is set per deal, so you can be a buyer on one and an inspector on another.</p>
            </div>
          )}
          <p className="text-[12px] text-graphite">Waybill never asks for your seed phrase or private key.</p>
        </div>
      </aside>

      <main className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 md:px-8">
          <Link href="/" className="lg:invisible">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <DemoMark />
            <ThemeToggle />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-16">
          {inv ? (
            <p className="mb-6 rounded-md border border-rule bg-sheet p-3 text-[13px] leading-snug lg:hidden">
              <span className="mono">{inv.id}</span> · {inv.buyer.name} invited you to confirm the {inv.tranches.find((t) => t.confirmedBy.startsWith(inspector.name))?.short.toLowerCase()}.
            </p>
          ) : null}

          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{heading}</h1>

          {step === "start" ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">
                {as === "attestor" ? "Use the email the invitation was sent to." : "Use your work email. We'll send a six-digit code; there's no password."}
              </p>
              <label className="label mt-8 block" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailErr("");
                }}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                aria-invalid={!!emailErr}
                aria-describedby={emailErr ? "email-err" : undefined}
                className={`mt-1.5 w-full rounded-md border bg-sheet px-3.5 py-3 text-[15px] outline-none focus:border-held ${emailErr ? "border-hold" : "border-rule"}`}
              />
              {emailErr ? (
                <p id="email-err" role="alert" className="mt-1.5 text-[12.5px] text-hold">
                  {emailErr}
                </p>
              ) : null}
              <button onClick={sendCode} className="mt-4 w-full rounded-md bg-ink py-3 text-[15px] font-semibold text-paper">
                Send code
              </button>
              <div className="my-6 flex items-center gap-3 text-[12px] text-graphite">
                <span className="h-px flex-1 bg-rule" /> or <span className="h-px flex-1 bg-rule" />
              </div>
              <button onClick={() => setStep("wallet")} className="w-full rounded-md border border-rule py-3 text-[14.5px] font-semibold hover:bg-sheet">
                Connect your own wallet
              </button>
              <p className="mt-6 text-[12.5px] leading-relaxed text-graphite">
                Signing in with email creates a wallet for you. You can export its key at any time from Settings. Your signature is only used when you choose to sign.
              </p>
              {as === "supplier" || !as ? (
                <p className="mt-4 text-[12.5px] text-graphite">
                  Suppliers don't need an account.{" "}
                  <Link href="/d/WB-0419" className="font-semibold text-ink underline decoration-rule underline-offset-2">
                    Open your deal link
                  </Link>
                  .
                </p>
              ) : null}
            </>
          ) : null}

          {step === "code" ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">
                Sent to <span className="font-semibold text-ink">{email}</span>.{" "}
                <button onClick={() => setStep("start")} className="underline decoration-rule underline-offset-2">
                  Change
                </button>
              </p>
              <div className="mt-6 flex gap-2" role="group" aria-label="Six-digit code">
                {digits.map((v, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      boxes.current[i] = el;
                    }}
                    value={v}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={`Digit ${i + 1}`}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                      if (e.key === "Enter") verify();
                    }}
                    className={`mono h-14 w-full min-w-0 rounded-md border bg-sheet text-center text-[22px] outline-none focus:border-held ${codeErr ? "border-hold" : "border-rule"}`}
                  />
                ))}
              </div>
              {codeErr ? (
                <p role="alert" className="mt-2 text-[12.5px] text-hold">
                  {codeErr}
                </p>
              ) : null}
              <button onClick={verify} className="mt-4 w-full rounded-md bg-ink py-3 text-[15px] font-semibold text-paper">
                Continue
              </button>
              <div className="mt-4 flex items-center justify-between text-[12.5px] text-graphite">
                {wait > 0 ? (
                  <span>Send a new code in {wait} s</span>
                ) : (
                  <button onClick={() => setWait(30)} className="font-semibold text-ink underline decoration-rule underline-offset-2">
                    Send a new code
                  </button>
                )}
                <button onClick={() => setDigits("482913".split(""))} className="rounded border border-dashed border-graphite/50 px-2 py-0.5 text-[11.5px]">
                  Demo: fill 482 913
                </button>
              </div>
            </>
          ) : null}

          {step === "wallet" ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">Pick the wallet you already use. Waybill never sees your keys.</p>
              <ul className="mt-6 space-y-2">
                {wallets.map((w) => (
                  <li key={w}>
                    <button onClick={() => setStep("network")} className="flex w-full items-center justify-between rounded-md border border-rule bg-sheet px-4 py-3.5 text-left text-[14.5px] font-semibold hover:border-ink">
                      {w}
                      <span className="text-graphite">→</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button onClick={() => setStep("start")} className="mt-4 text-[13px] text-graphite underline">
                Back
              </button>
            </>
          ) : null}

          {step === "network" ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">Your wallet is on another network. Deals run on Arc, so we'll ask it to switch. Nothing is sent and nothing is spent.</p>
              <button onClick={() => arrive("0x46…D0F1")} className="mt-6 w-full rounded-md bg-held py-3 text-[15px] font-semibold text-sheet">
                Switch to Arc
              </button>
              <button onClick={() => setStep("wallet")} className="mt-3 text-[13px] text-graphite underline">
                Choose another wallet
              </button>
            </>
          ) : null}

          {step === "roles" ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">
                Signed in as <span className="mono">{identity}</span>. Roles are set per deal, so you may have more than one.
              </p>
              <ul className="mt-6 space-y-2.5">
                {(
                  [
                    ["buyer", "Buyer", `${buyer.org}`, `${counts.buyerTotal} deals · ${counts.buyer} need you`],
                    ["attestor", "Attestor", `${inspector.org}`, counts.attestor ? `${counts.attestor} to accept or sign` : "Nothing waiting"],
                    ["arbiter", "Arbiter", "Waybill Arbitration Desk", counts.arbiter ? `${counts.arbiter} ready for a decision` : "No disputes waiting"],
                  ] as [Role, string, string, string][]
                ).map(([r, name, org, note]) => (
                  <li key={r}>
                    <button onClick={() => go(r)} className="w-full rounded-md border border-rule bg-sheet px-4 py-3.5 text-left hover:border-ink">
                      <span className="flex items-baseline justify-between">
                        <span className="text-[15px] font-semibold">{name}</span>
                        <span className="text-graphite">→</span>
                      </span>
                      <span className="block text-[12.5px] text-graphite">{org}</span>
                      <span className="mt-1 block text-[12.5px]">{note}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-[12px] text-graphite">Demo: pages don't enforce sign-in, and the three roles share one demo account.</p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
