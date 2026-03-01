/**
 * Strip characters that could break prompt structure when injected into system prompt.
 * Removes: control chars, newlines, markdown headers, XML-like tags, null bytes,
 * zero-width chars, directional overrides, and triple backticks.
 */
export function sanitizeForPrompt(text: string): string {
  return text
    .normalize("NFKC") // canonicalize homoglyphs (fullwidth, math variants, ligatures)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // control chars (keep \n \r \t)
    .replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g, "") // zero-width/invisible chars
    .replace(/[\uFE00-\uFE0F]/g, "") // variation selectors (emoji smuggling)
    .replace(/[\u{E0000}-\u{E007F}]/gu, "") // Unicode Tag Block (invisible instruction injection)
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "") // extended variation selectors
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "") // directional overrides
    .replace(/[\r\n\u2028\u2029]+/g, " ") // all line breaks → space (including Unicode LS/PS)
    .replace(/#{1,6}\s/g, "") // markdown headers
    .replace(/<\/?[a-zA-Z_][^>]*>/g, "") // XML/HTML tags
    .replace(/`{3,}/g, "`") // triple+ backticks → single (prevent code block injection)
    .trim()
    .slice(0, 128); // hard length cap for names
}

/**
 * Sanitize multi-line context (RAG results, knowledge chunks) for system prompt injection.
 * Less aggressive than sanitizeForPrompt - preserves line breaks and doesn't truncate.
 * Removes: control chars, zero-width chars, directional overrides, XML tags, triple backticks.
 */
export function sanitizeForContext(text: string): string {
  return text
    .normalize("NFKC") // canonicalize homoglyphs (fullwidth, math variants, ligatures)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // control chars (keep \n \r \t)
    .replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g, "") // zero-width/invisible chars
    .replace(/[\uFE00-\uFE0F]/g, "") // variation selectors (emoji smuggling)
    .replace(/[\u{E0000}-\u{E007F}]/gu, "") // Unicode Tag Block (invisible instruction injection)
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "") // extended variation selectors
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "") // directional overrides
    .replace(/[\u2028\u2029]/g, "\n") // Unicode line/paragraph separators → standard newline
    .replace(/<\/?[a-zA-Z_][^>]*>/g, "") // XML/HTML tags
    .replace(/`{3,}/g, "``") // triple+ backticks → double (prevent code block escape)
    .trim();
}
