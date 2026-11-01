import { describe, expect, it } from "vitest";
import { FakeRepository } from "./test-fakes";
import {
  DEFAULT_KEYWORD_LIMIT,
  KEYWORD_SCAN_LIMIT,
  findDocumentsForKeyword,
  rankDocumentKeywords,
} from "./keywords";

/**
 * A document plus, optionally, one file whose extracted text is `body`.
 *
 * Returns the document id so a test can assert which documents a keyword matched
 * without re-deriving ids from insertion order.
 */
function file(
  repo: FakeRepository,
  options: { title: string; description?: string; body?: string },
): number {
  const document = repo.createDocument({
    title: options.title,
    description: options.description ?? "",
    categories: [],
    tags: [],
    createdBy: 1,
  });

  if (options.body !== undefined) {
    const attachment = repo.addAttachment({
      documentId: document.id,
      fileName: `${options.title}.pdf`,
      originalName: `${options.title}.pdf`,
      relativePath: `doc_${document.id}/${options.title}.pdf`,
      mimeType: "application/pdf",
      byteSize: 1024,
      contentHash: `hash-${document.id}`,
    });
    repo.putAttachmentText({
      attachmentId: attachment.id,
      documentId: document.id,
      body: options.body,
      status: "extracted",
      source: "text-layer",
      pageCount: 1,
      charCount: options.body.length,
      elapsedMs: 10,
      contentHash: `hash-${document.id}`,
      error: "",
      ocrAttempted: false,
    });
  }

  return document.id;
}

describe("rankDocumentKeywords", () => {
  it("ranks by how many documents contain the word, not by total occurrences", () => {
    const repo = new FakeRepository();
    // `lease` is said many times but only by one document; `allstate` is said once
    // each by three. The document count is the default sort, so `allstate` wins —
    // this is the whole reason both figures are carried.
    file(repo, { title: "Lease", body: "lease lease lease lease lease allstate" });
    file(repo, { title: "Policy", body: "allstate" });
    file(repo, { title: "Renewal", body: "allstate" });

    const { keywords } = rankDocumentKeywords(repo);
    const allstate = keywords.find((k) => k.word === "allstate");
    const lease = keywords.find((k) => k.word === "lease");

    expect(keywords[0]?.word).toBe("allstate");
    expect(allstate).toEqual({ word: "allstate", documentCount: 3, occurrences: 3 });
    // Six: five in the body plus the title. A word used repeatedly in one document
    // still reports its true occurrence count — it just does not win the ranking.
    expect(lease).toEqual({ word: "lease", documentCount: 1, occurrences: 6 });
  });

  it("counts a word from the title and description, so an unindexed document ranks", () => {
    const repo = new FakeRepository();
    // No `body` at all: this document has never been indexed, which is exactly the
    // case the FTS vocabulary table could not see and why this tokenizes in TS.
    file(repo, { title: "Car Insurance", description: "Renewal paperwork" });

    const { keywords } = rankDocumentKeywords(repo);
    const words = keywords.map((k) => k.word);

    expect(words).toContain("insurance");
    expect(words).toContain("renewal");
    expect(words).toContain("paperwork");
  });

  it("counts a word in both a title and a body once per document", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Mortgage", body: "mortgage statement" });

    const mortgage = rankDocumentKeywords(repo).keywords.find((k) => k.word === "mortgage");

    // One document, two occurrences — the title's and the body's.
    expect(mortgage).toEqual({ word: "mortgage", documentCount: 1, occurrences: 2 });
  });

  it("drops stopwords, short words and digits", () => {
    const repo = new FakeRepository();
    file(repo, { title: "The Invoice", body: "the invoice was for 2024 and it is 12.50" });

    const words = rankDocumentKeywords(repo).keywords.map((k) => k.word);

    // Without this filter the top of every ranking is `the`/`and`/`was` — measured
    // against a real index, and the reason the raw FTS vocabulary was unusable here.
    expect(words).toContain("invoice");
    expect(words).not.toContain("the");
    expect(words).not.toContain("and");
    expect(words).not.toContain("was");
    expect(words).not.toContain("2024");
    expect(words).not.toContain("it");
  });

  it("honours extra excluded words on top of the shared list", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Statement", body: "huang household statement" });

    const words = rankDocumentKeywords(repo, { excludedWords: ["Huang", " HOUSEHOLD "] }).keywords.map(
      (k) => k.word,
    );

    // Normalized on the way in, so odd casing and spacing in a hand-edited list
    // still match — the failure this guards against is a row that looks right and
    // silently never matches.
    expect(words).not.toContain("huang");
    expect(words).not.toContain("household");
    expect(words).toContain("statement");
  });

  it("breaks ties alphabetically so the order is stable between renders", () => {
    const repo = new FakeRepository();
    file(repo, { title: "One", body: "zebra apple mango" });

    const words = rankDocumentKeywords(repo).keywords.map((k) => k.word);

    // All three have one document and one occurrence. Without the alphabetical
    // tiebreak the order would depend on Map insertion and the page would look as
    // though it were flickering between renders.
    expect(words).toEqual(["apple", "mango", "zebra"]);
  });

  it("reports the distinct word total separately from the limited list", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Words", body: "alpha bravo charlie delta echo" });

    const ranking = rankDocumentKeywords(repo, { limit: 2 });

    expect(ranking.keywords).toHaveLength(2);
    // The heading counts every word found, not the two that were returned — a list
    // saying "2 keywords" over a library of five would be wrong.
    expect(ranking.totalWords).toBe(5);
    expect(ranking.documentsScanned).toBe(1);
  });

  it("returns nothing for a non-positive limit rather than the whole library", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Lease", body: "lease" });

    expect(rankDocumentKeywords(repo, { limit: 0 }).keywords).toEqual([]);
    expect(rankDocumentKeywords(repo, { limit: -5 }).keywords).toEqual([]);
  });

  it("is empty and unflagged for a library with no documents", () => {
    const ranking = rankDocumentKeywords(new FakeRepository());

    expect(ranking).toEqual({
      keywords: [],
      totalWords: 0,
      documentsScanned: 0,
      scanLimited: false,
    });
  });

  it("does not flag a scan as limited when the library fits", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Lease", body: "lease" });

    expect(rankDocumentKeywords(repo).scanLimited).toBe(false);
    expect(DEFAULT_KEYWORD_LIMIT).toBeGreaterThan(0);
    expect(KEYWORD_SCAN_LIMIT).toBeGreaterThan(0);
  });

  it("ignores text rows that were looked at but yielded nothing", () => {
    const repo = new FakeRepository();
    const documentId = file(repo, { title: "Scan" });
    const attachment = repo.addAttachment({
      documentId,
      fileName: "scan.pdf",
      originalName: "scan.pdf",
      relativePath: `doc_${documentId}/scan.pdf`,
      mimeType: "application/pdf",
      byteSize: 2048,
      contentHash: "hash-scan",
    });
    // A `needs-ocr` row: the file was read and gave up nothing. Its body is empty by
    // definition, so counting it would be work that can contribute no words.
    repo.putAttachmentText({
      attachmentId: attachment.id,
      documentId,
      body: "",
      status: "needs-ocr",
      source: "text-layer",
      pageCount: 3,
      charCount: 0,
      elapsedMs: 200,
      contentHash: "hash-scan",
      error: "",
      ocrAttempted: true,
    });

    const words = rankDocumentKeywords(repo).keywords.map((k) => k.word);

    // The title still ranks — the document is not invisible just because its file
    // could not be read.
    expect(words).toEqual(["scan"]);
  });
});

describe("findDocumentsForKeyword", () => {
  it("finds documents matching on body text and on title alike", () => {
    const repo = new FakeRepository();
    const byBody = file(repo, { title: "Policy", body: "allstate renewal" });
    const byTitle = file(repo, { title: "Allstate letter" });
    file(repo, { title: "Unrelated", body: "something else entirely" });

    const found = findDocumentsForKeyword(repo, "allstate").map((d) => d.id);

    expect(found).toHaveLength(2);
    expect(found).toContain(byBody);
    expect(found).toContain(byTitle);
  });

  it("agrees with the count the ranking reported", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Lease one", body: "lease" });
    file(repo, { title: "Lease two" });
    file(repo, { title: "Other", body: "nothing relevant" });

    const ranked = rankDocumentKeywords(repo).keywords.find((k) => k.word === "lease");
    const found = findDocumentsForKeyword(repo, "lease");

    // The contract of this pair: the screen must never say a word appears in 2
    // documents and then list 1. That is why the lookup tokenizes on exactly the
    // rule that ranked it rather than calling the FTS search box.
    expect(found).toHaveLength(ranked!.documentCount);
  });

  it("matches whole tokens, not substrings", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Release notes", body: "released early" });
    const exact = file(repo, { title: "Lease", body: "lease" });

    const found = findDocumentsForKeyword(repo, "lease").map((d) => d.id);

    // `release` and `released` both contain "lease". A LIKE scan would return all
    // three documents and disagree with the ranking.
    expect(found).toEqual([exact]);
  });

  it("normalizes the word, so a hand-typed URL still matches", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Policy", body: "allstate" });

    expect(findDocumentsForKeyword(repo, "  ALLSTATE  ")).toHaveLength(1);
  });

  it("returns nothing for a word that could never have been ranked", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Policy", body: "allstate" });

    // Reached from a URL, so a hand-edited one shows no documents rather than
    // throwing: blank, below the length floor, and digits respectively.
    expect(findDocumentsForKeyword(repo, "")).toEqual([]);
    expect(findDocumentsForKeyword(repo, "an")).toEqual([]);
    expect(findDocumentsForKeyword(repo, "2024")).toEqual([]);
  });

  it("returns nothing for a word no document contains", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Policy", body: "allstate" });

    expect(findDocumentsForKeyword(repo, "mortgage")).toEqual([]);
  });

  it("does not list a document twice when it matches in both title and body", () => {
    const repo = new FakeRepository();
    file(repo, { title: "Mortgage", body: "mortgage statement" });

    expect(findDocumentsForKeyword(repo, "mortgage")).toHaveLength(1);
  });
});
