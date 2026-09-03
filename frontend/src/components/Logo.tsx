const HEIGHTS: Record<"sm" | "md" | "lg", string> = {
  sm: "h-7",
  md: "h-9",
  lg: "h-12",
};

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <img
      src="/logos/linkon-logo.png"
      alt="Link ON"
      draggable={false}
      className={`${HEIGHTS[size]} w-auto select-none object-contain`}
    />
  );
}
