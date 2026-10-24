import { ArbiterShell } from "@/components/AppShell";

export default function ArbiterLayout({ children }: { children: React.ReactNode }) {
  return <ArbiterShell>{children}</ArbiterShell>;
}
