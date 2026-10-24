import { DealScreen } from "./DealScreen";

export const metadata = { title: "Deal · Waybill prototype" };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealScreen id={decodeURIComponent(id).toUpperCase()} />;
}
