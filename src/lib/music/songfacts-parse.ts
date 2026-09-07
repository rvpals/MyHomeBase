// Turning a Songfacts HTML page into a list of facts.
//
// Kept apart from songfacts-client.ts, and pure, for one reason: this is a SCRAPE.
// Songfacts publishes no API, so the only contract we have is the shape of their
// markup, and that shape can change without warning. Isolating the parse means a
// break is one function to fix, provable against a saved fixture with no network.
//
// Deliberately no HTML parser dependency (cheerio/jsdom). The facts live in one
// predictable block, nothing here builds a DOM or executes anything, and the output is
// plain text that React escapes on render -- so a few scoped regexes are the honest
// simple version rather than a new dependency in package.json.

/** The block Songfacts wraps its facts list in, and one fact inside it. */
const FACTS_LIST = /<ul[^>]*class="[^"]*songfacts-results[^"]*"[^>]*>([\s\S]*?)<\/ul>/i;
const FACT_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi;

/**
 * The facts on a Songfacts page, in the order they appear, as plain text.
 *
 * Returns `[]` for a page that has no facts list -- a real outcome, not an error: a
 * Songfacts URL can exist for a song nobody has written about yet.
 */
export function parseSongfacts(html: string): string[] {
  const list = FACTS_LIST.exec(html);
  if (list === null) return [];

  const facts: string[] = [];
  // `matchAll` over a fresh regex rather than reusing FACT_ITEM's lastIndex, which a
  // `g` flag makes stateful across calls.
  for (const item of list[1].matchAll(new RegExp(FACT_ITEM.source, "gi"))) {
    const text = htmlToText(item[1]);
    if (text !== "") facts.push(text);
  }
  return facts;
}

/**
 * The song title and artist the page claims, from its JSON-LD block.
 *
 * Worth reading because our URL is a *guess*: slugging "Honesty" + "Billy Joel" lands
 * on a page, but slugging a mistagged file can land on a different song entirely. The
 * player shows this back as "matched X by Y" so a wrong hit is visible rather than
 * silently presented as this song's story.
 *
 * Read from JSON-LD specifically -- it is structured data Songfacts maintains for
 * search engines, which makes it the most stable thing on the page.
 */
export function parseSongfactsSubject(
  html: string,
): { title: string; artist: string } | undefined {
  const block = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/i.exec(
    html,
  );
  if (block === null) return undefined;

  try {
    const data = JSON.parse(block[1]) as {
      about?: { name?: unknown; byArtist?: { name?: unknown } };
    };
    const title = data.about?.name;
    const artist = data.about?.byArtist?.name;
    if (typeof title !== "string" || title === "") return undefined;
    // Entity-decoded, unlike the JSON's own escaping: Songfacts HTML-escapes accented
    // characters inside this block, so `Beyoncé` arrives as `Beyonc&eacute;` and would
    // be displayed literally in the player's "matched" line.
    return {
      title: decodeEntities(title),
      artist: typeof artist === "string" ? decodeEntities(artist) : "",
    };
  } catch {
    // Malformed JSON-LD is not a reason to throw away a page whose facts parsed fine.
    return undefined;
  }
}

/**
 * One fact's markup reduced to readable text.
 *
 * `<br><br>` becomes a blank line because Songfacts uses it as a paragraph break and
 * those breaks carry the structure of a long fact. Everything else -- <b>, <i>, links
 * to other pages -- is dropped to text, since the panel renders plain prose.
 */
function htmlToText(fragment: string): string {
  return decodeEntities(
    fragment
      // Paragraph breaks first, before <br> tags are stripped as generic markup.
      .replace(/(?:<br\s*\/?>\s*){2,}/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Anything script-like would never render, but strip it with its content rather
      // than leaving the body behind as text.
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, ""),
  )
    // Collapse the runs of spaces and tabs that indented markup leaves behind, without
    // touching the newlines just established.
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The entities that actually appear in this content.
 *
 * Not a full HTML entity table, but not a token gesture either. Two sources need
 * covering and they behave differently: the fact bodies arrive as UTF-8, so accents
 * are already themselves, while the JSON-LD block HTML-escapes them -- `Beyoncé`
 * comes through as `Beyonc&eacute;`. Hence the named-accent pass.
 *
 * Numeric entities are decoded generically, which covers the long tail (`&#8217;` for
 * a curly apostrophe is common in this content) without enumerating names.
 *
 * `&amp;` is deliberately LAST so `&amp;lt;` cannot be double-decoded into a tag.
 */
function decodeEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&reg;/gi, "®")
      // A letter plus its accent name -- &eacute;, &uuml;, &ntilde; and friends. Built
      // from Unicode's own ordering rather than a hand-written table.
      .replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|ring|cedil|slash);/g, (whole, letter, accent) => {
        const decoded = NAMED_ACCENTS[`${letter}${accent}`];
        return decoded ?? whole;
      })
      // &#233; and &#x2019; alike. Anything out of range is left as written rather
      // than becoming a replacement character.
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
        const point = code.toLowerCase().startsWith("x")
          ? Number.parseInt(code.slice(1), 16)
          : Number.parseInt(code, 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : whole;
      })
      .replace(/&amp;/gi, "&")
  );
}

/**
 * `eacute` -> `é`, for every letter/accent pair Latin-1 defines.
 *
 * Generated rather than typed out: composing the base letter with the combining mark
 * and normalising is what Unicode says the precomposed character is, so this cannot
 * drift out of step with itself the way a hand-maintained table does.
 */
const NAMED_ACCENTS: Record<string, string> = (() => {
  const marks: Record<string, string> = {
    acute: "\u0301",
    grave: "\u0300",
    circ: "\u0302",
    uml: "\u0308",
    tilde: "\u0303",
    ring: "\u030a",
    cedil: "\u0327",
  };
  const table: Record<string, string> = { oslash: "ø", Oslash: "Ø" };

  for (const letter of "aeiouynAEIOUYN") {
    for (const [accent, mark] of Object.entries(marks)) {
      table[`${letter}${accent}`] = `${letter}${mark}`.normalize("NFC");
    }
  }
  return table;
})();
