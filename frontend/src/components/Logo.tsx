export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";
  return (
    <div className="flex select-none items-baseline">
      <span className={`font-serif font-semibold tracking-tight text-cream ${text}`}>Link</span>
      <span className={`font-serif font-bold italic gold-gradient-text ${text}`}>ON</span>
    </div>
  );
}
