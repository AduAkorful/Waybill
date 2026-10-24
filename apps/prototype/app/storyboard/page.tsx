import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { Sketch } from "@/components/Sketch";
import { flows } from "@/demo/storyboard";

export const metadata = { title: "Storyboards · Waybill prototype" };

export default function Storyboard() {
  const beats = flows.reduce((n, f) => n + f.beats.length, 0);
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-6">
            <a href="/prototype">
              <Wordmark />
            </a>
            <nav className="hidden gap-4 text-[13px] text-graphite md:flex" aria-label="Prototype">
              <a href="/prototype" className="hover:text-ink">
                Frames
              </a>
              <a href="/storyboard" className="font-semibold text-ink">
                Storyboards
              </a>
              <a href="/motion" className="hover:text-ink">
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

      <main className="mx-auto max-w-7xl px-4 pt-10 pb-20 md:px-8">
        <h1 className="text-[30px] font-semibold tracking-tight">Storyboards</h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-graphite">
          {flows.length} flows, {beats} beats. Each beat says what's on screen when it ends, how it moves, for how long, and why. Dashed arrows
          mean movement. “Held” waits for the person. The animatic plays these same beats.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Flows">
          {flows.map((f, i) => (
            <a key={f.id} href={`#${f.id}`} className="rounded-full border border-rule px-3 py-1 text-[12.5px] hover:bg-sheet">
              <span className="mono mr-1.5 text-graphite">{i + 1}</span>
              {f.name}
            </a>
          ))}
        </nav>

        {flows.map((f, fi) => (
          <section key={f.id} id={f.id} className="mt-14 scroll-mt-20">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/80 pb-2">
              <h2 className="text-[20px] font-semibold">
                <span className="mono mr-2 text-[14px] text-graphite">{fi + 1}</span>
                {f.name}
              </h2>
              <a href={`/animatic?flow=${f.id}`} className="text-[13px] text-held underline decoration-held/30 underline-offset-4">
                Play in animatic →
              </a>
            </div>
            <p className="mt-2 max-w-3xl text-[14px] text-graphite">{f.intent}</p>
            <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {f.beats.map((b, i) => (
                <li key={b.title} className="flex flex-col rounded-md border border-rule bg-sheet p-3">
                  <Sketch shapes={b.shapes} label={`Sketch: ${b.title}`} />
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="label">
                      {i + 1} · {b.screen}
                    </span>
                    <span className={`mono text-[11.5px] ${b.ms ? "text-held" : "text-graphite"}`}>{b.ms ? `${b.ms} ms` : "held"}</span>
                  </div>
                  <h3 className="mt-1 text-[14.5px] leading-snug font-semibold">{b.title}</h3>
                  <dl className="mt-2 space-y-2 text-[12.5px] leading-snug">
                    <div>
                      <dt className="label">On screen</dt>
                      <dd>{b.onScreen}</dd>
                    </div>
                    <div>
                      <dt className="label">Motion</dt>
                      <dd>{b.motion}</dd>
                    </div>
                    <div>
                      <dt className="label">Why</dt>
                      <dd className="text-graphite">{b.why}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
    </div>
  );
}
