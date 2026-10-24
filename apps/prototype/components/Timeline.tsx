import type { TimelineEvent } from "@/demo/deal";

const dot: Record<NonNullable<TimelineEvent["tone"]>, string> = {
  held: "bg-held",
  released: "bg-released",
  refunded: "bg-refunded",
  hold: "bg-hold",
  neutral: "bg-graphite/60",
};

/**
 * One ordered thread per deal, the same for every role. A single rail with dots: past events are typed,
 * upcoming ones pencilled. Proof is a quiet link, not a hash in every row.
 */
export function Timeline({ events, nowLabel }: { events: TimelineEvent[]; nowLabel?: string }) {
  let lastDay = "";
  const firstUpcoming = events.findIndex((e) => e.upcoming);
  return (
    <ol className="relative">
      <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-rule" />
      {events.map((e, i) => {
        const dayHeader = e.day !== lastDay;
        lastDay = e.day;
        return (
          <li key={i} data-event={i} className="relative">
            {i === firstUpcoming && nowLabel ? (
              <div className="relative my-3 flex items-center gap-2 pl-5" aria-label="Now">
                <span aria-hidden className="absolute left-0 h-[11px] w-[11px] rounded-full border-2 border-held bg-paper" />
                <span className="label text-held">Now · {nowLabel}</span>
                <span className="h-px flex-1 bg-held/40" />
              </div>
            ) : null}
            {dayHeader ? <p className="label mt-4 mb-1 pl-5 first:mt-0">{e.day}</p> : null}
            <div className={`relative py-1.5 pl-5 ${e.upcoming ? "text-graphite" : ""}`}>
              <span
                aria-hidden
                className={`absolute top-[11px] left-[2px] h-[7px] w-[7px] rounded-full ${e.upcoming ? "border border-graphite/60 bg-paper" : dot[e.tone ?? "neutral"]}`}
              />
              <p className="text-[13px] leading-snug">
                <span className="mono mr-1.5 text-[11px] text-graphite">{e.at}</span>
                <span className="font-semibold">{e.actor}</span> <span>{joinText(e.text)}</span>
                {e.proof ? (
                  <a href={`/explorer/${e.proof}`} target="_blank" rel="noreferrer" title={e.proof} className="ml-1.5 text-[11.5px] whitespace-nowrap text-graphite underline decoration-rule underline-offset-2 hover:text-ink">
                    proof ↗
                  </a>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Events that start with what the actor did read as one sentence ("Lin Mei signed…"); anything else
// (names, deadlines) keeps its capital and gets a separator, so a name is never lowercased.
const VERBS = /^(Created|Accepted|Locked|Paid|Signed|Approved|Disputed|Withdrew|Responded|Took|Proposed|Cancelled)\b/;

function joinText(s: string) {
  return VERBS.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : `· ${s}`;
}
