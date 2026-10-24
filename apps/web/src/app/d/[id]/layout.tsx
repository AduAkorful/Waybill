import { Noto_Sans_SC } from 'next/font/google'

// Chinese glyphs ship as many small slices; only the supplier page offers Chinese, so only it pays for them.
const notoSc = Noto_Sans_SC({ weight: ['400', '500', '700'], variable: '--font-noto-sc', preload: false })

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  // The font stack is set here because the variable exists only inside this element, not on <body>.
  return (
    <div className={notoSc.variable} style={{ fontFamily: 'var(--font-archivo), var(--font-noto-sc), system-ui, sans-serif' }}>
      {children}
    </div>
  )
}
