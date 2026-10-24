/** A long explanation: always shown on wide screens, folded under "What this does" on phones so the controls stay in view. */
export function Why({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="mt-1 hidden max-w-2xl text-[13px] leading-relaxed md:block">{children}</p>
      <details className="mt-1 md:hidden">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] underline">What this does</summary>
        <p className="text-[13px] leading-relaxed">{children}</p>
      </details>
    </>
  )
}
