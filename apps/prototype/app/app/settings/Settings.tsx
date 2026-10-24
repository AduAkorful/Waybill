"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usdc } from "@/demo/format";
import { act, useDemo, type BuyerSettings } from "@/demo/store";
import { opsBase } from "@/demo/ops";

const field = "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[14px] outline-none focus:border-ink";

export function Settings() {
  const { settings } = useDemo();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = (patch: Partial<BuyerSettings>) => {
    act.setSettings(patch);
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const emailOk = /^\S+@\S+\.\S+$/.test(settings.email);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="label">Settings</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Your account</h1>
        </div>
        <p aria-live="polite" className="text-[12.5px] text-released">
          {saved ? "Saved ✓" : ""}
        </p>
      </div>
      <p className="mt-2 text-[14px] text-graphite">These are preferences kept by Waybill. None of them can move money or change a deal's terms.</p>

      <Group title="You" note="Shown to suppliers and attestors on your deals.">
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Your name">
            <input className={field} value={settings.name} onChange={(e) => set({ name: e.target.value })} />
          </L>
          <L label="Company">
            <input className={field} value={settings.org} onChange={(e) => set({ org: e.target.value })} />
          </L>
          <L label="City">
            <input className={field} value={settings.city} onChange={(e) => set({ city: e.target.value })} />
          </L>
          <L label="Email for notifications">
            <input className={field} type="email" value={settings.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={!emailOk} />
            {!emailOk ? <span className="mt-1 block text-[12px] text-hold">Enter a full email address, or you won't hear when a deal needs you.</span> : null}
          </L>
        </div>
      </Group>

      <Group title="Wallet and network" note="Waybill never holds your keys. Every payment is signed in your wallet.">
        <dl className="divide-y divide-rule rounded-md border border-rule bg-sheet text-[14px]">
          <Row k="Connected wallet" v={<span className="mono">0x91c2…7d04</span>} />
          <Row k="Sign-in" v="Email code, with an embedded wallet" />
          <Row k="Network" v={<span>Arc Testnet <span className="mono text-[12px] text-graphite">· chain 5042002</span></span>} />
          <Row k="USDC in this wallet" v={<span className="mono">1,284.50</span>} />
        </dl>
        <p className="mt-2 text-[12.5px] text-graphite">If your wallet is on another network, Waybill asks you to switch to Arc before any payment. Nothing is sent on the wrong network.</p>
        <div className="mt-3 flex gap-3 text-[13px]">
          <Link href="/signin" className="rounded-md border border-rule px-3.5 py-2 font-semibold hover:bg-sheet">
            Disconnect and sign out
          </Link>
        </div>
      </Group>

      <Group title="Notifications" note="Sent to your email. Waybill also always emails you when money is about to move or a dispute is filed on your deal.">
        <Toggle label="A deal needs me" hint="To fund, to review evidence, or to take a refund." on={settings.notify.needsYou} set={(v) => set({ notify: { ...settings.notify, needsYou: v } })} />
        <Toggle label="A review window is about to end" hint="Six hours before money releases unless you object." on={settings.notify.windowEnding} set={(v) => set({ notify: { ...settings.notify, windowEnding: v } })} />
        <Toggle label="Every movement" hint="Each acceptance, signature and payment, as it happens." on={settings.notify.everyMovement} set={(v) => set({ notify: { ...settings.notify, everyMovement: v } })} />
        <Toggle label="Weekly summary" hint="One email on Monday: what is held, paid and coming up." on={settings.notify.weekly} set={(v) => set({ notify: { ...settings.notify, weekly: v } })} />
      </Group>

      <Group title="Display">
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Language">
            <Segmented value={settings.language} onChange={(v) => set({ language: v })} options={[["en", "English"], ["zh", "中文"]]} />
            <span className="mt-1 block text-[12px] text-graphite">Your supplier chooses their own language on their link.</span>
          </L>
          <L label="Local-currency estimate">
            <Segmented value={settings.estimate} onChange={(v) => set({ estimate: v })} options={[["GHS", "Show GH₵"], ["none", "Hide"]]} />
            <span className="mt-1 block text-[12px] text-graphite">Always labelled an estimate. Deals are in USDC.</span>
          </L>
        </div>
      </Group>

      <Group title="Public deal pages" note="Anyone with a deal's link can see amounts, parts and dates. Wallet addresses on the explorer are public either way.">
        <Toggle label="Show names by default on new deals" hint="Off keeps buyer, supplier and goods hidden. You can change it on each deal." on={settings.publicNamesByDefault} set={(v) => set({ publicNamesByDefault: v })} />
      </Group>

      <Group title="Early-access limits" note="Fixed while Waybill is new. They protect everyone and can't be raised from here.">
        <dl className="divide-y divide-rule rounded-md border border-rule bg-sheet text-[14px]">
          <Row k="Largest single deal" v={<span className="mono">{usdc(opsBase.caps.perDealUsdc)} USDC</span>} />
          <Row k="Most locked across all deals" v={<span className="mono">{usdc(opsBase.caps.totalLockedUsdc)} USDC</span>} />
        </dl>
      </Group>

      <Group title="Your records">
        <p className="text-[14px]">Every settled deal has a printable record you can save as a PDF.</p>
        <Link href="/print/WB-0388" target="_blank" className="mt-2 inline-block text-[13.5px] font-semibold text-held underline decoration-held/30 underline-offset-4">
          Open an example record ↗
        </Link>
      </Group>
    </main>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
      {note ? <p className="mt-0.5 text-[13px] text-graphite">{note}</p> : null}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
      <dt className="text-graphite">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

function Toggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-rule py-3 last:border-b-0">
      <div>
        <p className="text-[14px] font-semibold">{label}</p>
        <p className="text-[12.5px] text-graphite">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => set(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-held" : "bg-rule"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-sheet shadow transition-transform ${on ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`rounded px-3.5 py-1.5 text-[13px] font-semibold ${value === v ? "bg-ink text-paper" : "text-graphite hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
