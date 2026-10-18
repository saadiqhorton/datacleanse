export function cn(...classes: unknown[]) {
  return classes.filter((c): c is string => typeof c === "string" && c !== "").join(" ");
}
