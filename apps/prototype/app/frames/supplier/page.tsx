import { BrowserFrame } from "@/components/BrowserFrame";
import { ThemeToggle } from "@/components/Chrome";
import { PhoneFrame } from "@/components/PhoneFrame";
import { SupplierLink } from "./SupplierLink";

export const metadata = { title: "S1 Supplier link · Waybill prototype" };

export default function SupplierFrame() {
  return (
    <div className="min-h-dvh sm:px-6 sm:py-8">
      <div className="mx-auto mb-6 hidden max-w-6xl items-center justify-between sm:flex">
        <p className="label">S1 · Supplier link, first view, before accepting · web and phone</p>
        <ThemeToggle />
      </div>

      <div className="mx-auto hidden max-w-6xl lg:block">
        <BrowserFrame url="waybill.demo/d/WB-0427" label="Web · opened from WeChat on a desktop">
          <SupplierLink initial="zh" />
        </BrowserFrame>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-10 lg:mt-14">
        <PhoneFrame label="Phone · English">
          <SupplierLink initial="en" />
        </PhoneFrame>
        <div className="hidden sm:block">
          <PhoneFrame label="Phone · 中文">
            <SupplierLink initial="zh" />
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
}
