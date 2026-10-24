import { SupplierScreen } from "./SupplierScreen";

export const metadata = { title: "Deal link · Waybill prototype" };

export default async function SupplierDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierScreen id={decodeURIComponent(id).toUpperCase()} />;
}
