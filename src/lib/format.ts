const LOWER_WORDS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do"]);

/** Normaliza nombres a Capital Letter: "CAROLINA MELANIE" -> "Carolina Melanie" */
export function toTitleCase(input?: string | null): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-AR")
    .split(" ")
    .map((word, index) =>
      index > 0 && LOWER_WORDS.has(word)
        ? word
        : word
            .split("-")
            .map((part) => (part ? part.charAt(0).toLocaleUpperCase("es-AR") + part.slice(1) : part))
            .join("-")
    )
    .join(" ");
}
