import { notFound } from 'next/navigation'

/** Any address under /app that no page owns ends in the app's own 404, inside the signed-in shell. */
export default function Unknown() {
  notFound()
}
