import Link from "next/link";

/** A screen from a later batch: says which batch and what it will hold, never a 404. */
export function Placeholder({ code, name, batch, holds, back = "/app" }: { code: string; name: string; batch: string; holds: string[]; back?: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <p className="label">
        {code} · coming in batch {batch}
      </p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 text-[14.5px] text-graphite">This screen is part of a later prototype batch. It will hold:</p>
      <ul className="mt-4 space-y-2 border-l-2 border-dashed border-rule pl-4 text-[14px]">
        {holds.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <Link href={back} className="mt-8 inline-block text-[14px] font-semibold text-held underline decoration-held/30 underline-offset-4">
        ← Back
      </Link>
    </main>
  );
}
