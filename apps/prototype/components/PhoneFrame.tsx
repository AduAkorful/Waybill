/** Shows a phone-width screen inside a desktop page; on a real phone the frame disappears. */
export function PhoneFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <figure className="mx-auto w-full max-w-[400px]">
      <div className="relative overflow-hidden bg-paper sm:h-[844px] sm:rounded-[44px] sm:border-[10px] sm:border-[#141518] sm:shadow-[0_30px_60px_-30px_rgb(0_0_0/0.5)]">
        <div className="h-full overflow-y-auto">{children}</div>
      </div>
      {label ? <figcaption className="label mt-3 hidden text-center sm:block">{label}</figcaption> : null}
    </figure>
  );
}
