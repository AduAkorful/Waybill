import { redirect } from "next/navigation";

// The buyer's Attestors tab is the same public directory: reputation is built from public outcomes.
export default function Attestors() {
  redirect("/attestors");
}
