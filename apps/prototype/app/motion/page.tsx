import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { PRINCIPLES, REDUCED } from "@/components/motion";
import { Durations, EasePlayground, Staggers } from "./EasePlayground";

export const metadata = { title: "Motion system · Waybill prototype" };

export default function MotionPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-6">
            <a href="/prototype">
              <Wordmark />
            </a>
            <nav className="hidden gap-4 text-[13px] text-graphite md:flex" aria-label="Prototype">
              <a href="/prototype" className="hover:text-ink">
                Frames
              </a>
              <a href="/storyboard" className="hover:text-ink">
                Storyboards
              </a>
              <a href="/motion" className="font-semibold text-ink">
                Motion
              </a>
              <a href="/animatic" className="hover:text-ink">
                Animatic
              </a>
            </nav>
          </div>
          <div className="flex gap-2">
            <DemoMark />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-10 pb-20 md:px-8">
        <h1 className="text-[30px] font-semibold tracking-tight">Motion system</h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-graphite">
          The tokens every screen uses, taken from what repeats across the storyboards. Source: <span className="mono">components/motion.ts</span>;
          the cubic eases are mirrored as CSS variables.
        </p>

        <section className="mt-10">
          <h2 className="label">Principles</h2>
          <ol className="mt-3 grid gap-x-10 gap-y-3 md:grid-cols-2">
            {PRINCIPLES.map((p, i) => (
              <li key={p} className="flex gap-3 border-t border-ink/80 pt-3 text-[14.5px]">
                <span className="mono text-[12px] text-graphite">{i + 1}</span>
                {p}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="label mb-4">Durations</h2>
            <Durations />
          </div>
          <div>
            <h2 className="label mb-4">Staggers</h2>
            <Staggers />
            <p className="mt-6 text-[13px] leading-relaxed text-graphite">
              Workbench changes stay between <span className="mono">tick</span> and <span className="mono">base</span>. Only signature beats use{" "}
              <span className="mono">deliberate</span>, and only the stub tear uses <span className="mono">cinematic</span>.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="label mb-2">Eases</h2>
          <EasePlayground />
        </section>

        <section className="mt-12">
          <h2 className="label mb-3">Reduced motion</h2>
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-ink/80">
                <th className="py-2 font-semibold">Motion</th>
                <th className="py-2 font-semibold">Becomes</th>
              </tr>
            </thead>
            <tbody>
              {REDUCED.map((r) => (
                <tr key={r.motion} className="border-b border-rule">
                  <td className="py-2.5 pr-6">{r.motion}</td>
                  <td className="py-2.5 text-graphite">{r.becomes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
