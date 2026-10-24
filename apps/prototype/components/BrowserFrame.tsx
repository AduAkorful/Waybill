/** Shows a web page at desktop width inside a plain browser window, for frames that compare web and phone. */
export function BrowserFrame({ url, children, label }: { url: string; children: React.ReactNode; label?: string }) {
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-xl border border-rule bg-paper shadow-[0_30px_60px_-30px_rgb(0_0_0/0.45)]">
        <div className="flex items-center gap-3 border-b border-rule bg-sheet px-3 py-2" aria-hidden>
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rule" />
            <span className="h-2.5 w-2.5 rounded-full bg-rule" />
            <span className="h-2.5 w-2.5 rounded-full bg-rule" />
          </span>
          <span className="mono flex-1 truncate rounded-md bg-paper px-3 py-1 text-[11.5px] text-graphite">{url}</span>
        </div>
        <div className="h-[760px] overflow-y-auto">{children}</div>
      </div>
      {label ? <figcaption className="label mt-3 text-center">{label}</figcaption> : null}
    </figure>
  );
}
