import type { WalletDealsRead } from '@/data/wallet-deals'

/** Says why the deal list is not on screen. Nothing is shown in its place. */
export function ReadStatus({ read }: { read: WalletDealsRead }) {
  if (read.status === 'ready') return null
  const text =
    read.status === 'loading'
      ? 'Loading your deals…'
      : read.status === 'unconfigured'
        ? 'Your deals cannot be listed: this site has no Waybill API address configured.'
        : `Your deals could not be loaded: ${read.message}`
  return (
    <main className="mx-auto max-w-xl px-4 py-10 md:px-8">
      <p role={read.status === 'loading' ? 'status' : 'alert'} className="text-[14px] text-graphite">
        {text}
      </p>
    </main>
  )
}
