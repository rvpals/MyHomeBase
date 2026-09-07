import { describe, expect, it } from "vitest";
import { SONGFACTS_EMPTY_HTML, SONGFACTS_HONESTY_HTML } from "./songfacts.fixture";
import { parseSongfacts, parseSongfactsSubject } from "./songfacts-parse";

// Tested against markup captured from the live site (see songfacts.fixture.ts). A
// scrape is only as trustworthy as its fixture: asserting against hand-written HTML
// would prove the regexes are self-consistent while saying nothing about whether they
// work on songfacts.com.

describe("parseSongfacts", () => {
  const facts = parseSongfacts(SONGFACTS_HONESTY_HTML);

  it("finds every fact in the list", () => {
    expect(facts).toHaveLength(6);
  });

  it("keeps the facts in page order", () => {
    expect(facts[0]).toMatch(/^This song makes the case that truth/);
    expect(facts[2]).toMatch(/^Beyonc/);
  });

  it("strips the markup but keeps the words", () => {
    // The album title is <b>52nd Street</b> in the source.
    expect(facts[0]).toContain("52nd Street");
    expect(facts[0]).not.toContain("<b>");
    expect(facts.join("\n")).not.toMatch(/<[a-z]/i);
  });

  it("turns a <br><br> into a paragraph break", () => {
    expect(facts[0]).toContain("\n\n");
    expect(facts[0]).toMatch(/have truth\.\n\nIt was the third single/);
  });

  it("preserves accented characters as themselves", () => {
    expect(facts[2]).toContain("Beyoncé");
  });

  it("leaves no stray entities or collapsed-away spacing", () => {
    for (const fact of facts) {
      expect(fact).not.toMatch(/&(?:amp|lt|gt|quot|nbsp|#\d+);/);
      expect(fact).toBe(fact.trim());
      expect(fact).not.toMatch(/\n{3,}/);
    }
  });

  it("returns [] for a page carrying no facts list", () => {
    // A real outcome, not an error -- a Songfacts URL can exist for a song nobody has
    // written about yet, and the client treats [] as a miss.
    expect(parseSongfacts(SONGFACTS_EMPTY_HTML)).toEqual([]);
  });

  it("returns [] rather than throwing on markup that is nothing like a page", () => {
    expect(parseSongfacts("")).toEqual([]);
    expect(parseSongfacts("<html><body>404</body></html>")).toEqual([]);
  });

  it("does not carry script bodies into the text", () => {
    const withScript = String.raw`<ul class="songfacts-results"><li><div class="inner">Real fact.<script>var x = 1;</script></div></li></ul>`;
    expect(parseSongfacts(withScript)).toEqual(["Real fact."]);
  });
});

describe("parseSongfactsSubject", () => {
  it("reads the song and artist out of the JSON-LD block", () => {
    // Read so the player can show what was matched -- our URL is a guess, and a
    // mistagged file can land on a real page for a different song.
    const subject = parseSongfactsSubject(
      String.raw`<script type='application/ld+json'>
        {"@type":"Article","about":{"@type":"MusicRecording","name":"Honesty",
        "byArtist":{"@type":"MusicGroup","name":"Billy Joel"}}}
      </script>`,
    );
    expect(subject).toEqual({ title: "Honesty", artist: "Billy Joel" });
  });

  it("returns undefined when there is no JSON-LD", () => {
    expect(parseSongfactsSubject("<html></html>")).toBeUndefined();
  });

  it("returns undefined for malformed JSON rather than throwing", () => {
    // Must not lose a page whose facts parsed perfectly well.
    expect(
      parseSongfactsSubject(`<script type='application/ld+json'>{ oops </script>`),
    ).toBeUndefined();
  });

  it("returns undefined when the block carries no song name", () => {
    expect(
      parseSongfactsSubject(`<script type='application/ld+json'>{"@type":"Article"}</script>`),
    ).toBeUndefined();
  });
});

describe("entity decoding", () => {
  // The JSON-LD block HTML-escapes accents even though the fact bodies do not, so a
  // real page yields "Beyonc&eacute;" here. Found by running the client against the
  // live site, not by reading the markup.
  it("decodes named accents in the JSON-LD subject", () => {
    const subject = parseSongfactsSubject(
      `<script type='application/ld+json'>{"about":{"name":"Halo","byArtist":{"name":"Beyonc&eacute;"}}}</script>`,
    );
    expect(subject).toEqual({ title: "Halo", artist: "Beyoncé" });
  });

  it("decodes numeric entities, decimal and hex alike", () => {
    const subject = parseSongfactsSubject(
      `<script type='application/ld+json'>{"about":{"name":"Don&#8217;t Stop","byArtist":{"name":"Bj&#xF6;rk"}}}</script>`,
    );
    expect(subject).toEqual({ title: "Don’t Stop", artist: "Björk" });
  });

  it("decodes &amp; without double-decoding an escaped entity", () => {
    // "&amp;lt;" must end up as the literal text "&lt;", never as a "<" tag.
    expect(parseSongfacts(`<ul class="songfacts-results"><li>Rock &amp; roll</li></ul>`)).toEqual([
      "Rock & roll",
    ]);
    expect(parseSongfacts(`<ul class="songfacts-results"><li>&amp;lt;b&amp;gt;</li></ul>`)).toEqual([
      "&lt;b&gt;",
    ]);
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(
      parseSongfacts(`<ul class="songfacts-results"><li>a &zzzz; b</li></ul>`),
    ).toEqual(["a &zzzz; b"]);
  });
});
