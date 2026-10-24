import { Skeleton } from '@/ui/Skeleton'

/**
 * The dispute room is a dynamic route. Without a loading boundary a click on "Open dispute room" waits, with no
 * feedback, for the server round trip (slow behind a tunnel) and can look as if the link did nothing; it also means
 * the route cannot be prefetched. This boundary makes the click switch at once and lets Next prefetch the room.
 */
export default function Loading() {
  return <Skeleton label="Opening the dispute room…" />
}
