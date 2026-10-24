"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TxFlow } from "@/components/TxFlow";
import { inspector } from "@/demo/deal";
import { act, useDemo } from "@/demo/store";

export default function AttestorProfileEdit() {
  const { profile } = useDemo();
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(profile), [profile]);
  const changed = form.name !== profile.name || form.city !== profile.city || form.agentId !== profile.agentId;
  const valid = form.name.trim().length >= 2 && form.city.trim().length >= 2 && /^\d*$/.test(form.agentId);

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <p className="label">{inspector.name}</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Your profile</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-graphite">
        Buyers see this when choosing an inspector. Your record beside it is built only from deal outcomes; you can't edit those.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded-md border border-rule bg-sheet p-5">
          {(
            [
              ["name", "Business name", "Shown on every deal you confirm"],
              ["city", "City", "Where you inspect"],
              ["agentId", "Arc identity number (optional)", "Links your profile to the shared identity registry. Leave empty if you don't have one."],
            ] as const
          ).map(([k, label, hint]) => (
            <label key={k} className="block">
              <span className="label block">{label}</span>
              <input
                value={form[k]}
                onChange={(e) => {
                  setSaved(false);
                  setForm({ ...form, [k]: e.target.value });
                }}
                className={`mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[14.5px] outline-none focus:border-held ${k === "agentId" ? "mono" : ""}`}
              />
              <span className="mt-1 block text-[12px] text-graphite">{hint}</span>
            </label>
          ))}
          {!valid ? <p className="text-[12.5px] text-hold">Name and city need at least two characters; the identity number is digits only.</p> : null}
          {saved ? <p className="text-[13px] font-semibold text-released">Saved to the registry.</p> : null}
          {changed && valid ? (
            saving ? (
              <TxFlow
                confirmLabel="Save profile"
                steps={[{ label: "Save", wallet: { action: "AttestorRegistry.setProfile(name, city, agentId)", to: "AttestorRegistry · demo", note: "Changes only your own profile. Holds no funds." } }]}
                onCancel={() => setSaving(false)}
                onDone={() => {
                  act.setProfile(form);
                  setSaving(false);
                  setSaved(true);
                }}
              />
            ) : (
              <button onClick={() => setSaving(true)} className="rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-paper">
                Save profile
              </button>
            )
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-md border border-rule p-4 text-[13.5px]">
            <p className="label">Tier</p>
            <p className="mt-1 font-semibold">Registered</p>
            <p className="mt-1 text-graphite">Verified comes with a partner business check. Bonded comes in a later phase.</p>
          </div>
          <div className="rounded-md border border-dashed border-rule p-4 text-[13.5px]">
            <p className="label">Bond · later phase</p>
            <p className="mt-1 text-graphite">Post a USDC bond to qualify for larger deals. Held in a separate vault; it can never reach deal money.</p>
          </div>
          <Link href="/attestors/pearlgate" className="block text-[13.5px] font-semibold text-held underline decoration-held/30 underline-offset-4">
            See your public profile →
          </Link>
        </aside>
      </div>
    </main>
  );
}
