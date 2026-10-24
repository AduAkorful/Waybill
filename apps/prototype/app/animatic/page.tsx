import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { AnimaticClient } from "./AnimaticClient";

export const metadata = { title: "Animatic · Waybill prototype" };

export default async function AnimaticPage({ searchParams }: { searchParams: Promise<{ flow?: string }> }) {
  const { flow } = await searchParams;
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
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
              <a href="/motion" className="hover:text-ink">
                Motion
              </a>
              <a href="/animatic" className="font-semibold text-ink">
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
      <main className="mx-auto max-w-7xl px-4 pt-8 pb-16 md:px-8">
        <h1 className="text-[30px] font-semibold tracking-tight">Animatic</h1>
        <p className="mt-2 mb-6 max-w-2xl text-[14.5px] text-graphite">
          Each storyboard flow at real speed, built from the real components. For judging rhythm: what moves, in what order, for how long.
          Beats that wait for a person hold longer. Scrub, jump to a beat, halve the speed, or preview reduced motion.
        </p>
        <AnimaticClient initialFlow={flow} />
      </main>
    </div>
  );
}
