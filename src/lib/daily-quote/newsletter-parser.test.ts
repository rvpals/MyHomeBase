import { describe, expect, it } from "vitest";
import { parseAttribution, parseThreeTwoOneNewsletter } from "./newsletter-parser";

// The real 30 July 2026 issue, pasted as-is — including the zero-width spaces
// (U+200B) that ride along from the email client. If the parser copes with this
// verbatim, it copes with a real paste.
const REAL_ISSUE = `Here are 3 ideas, 2 quotes, and 1 question to consider this week...


​

3 Ideas From Me
I.

"If you always want more, then you'll find the most you can have will always be too little."

​II.

"Large, sweeping changes often sound good in theory, but the faster you try to change your life, the more likely you are to backslide. Real change is inch by inch. Go out and win the next five minutes."

III.

"Whatever can be measured grabs our attention. How much money we make. How much weight we can lift. How many bedrooms are in the house.

And once we notice a number, it is natural to want to improve it. We find ourselves wondering how to make more money, lift more weight, add another bedroom. What is measurable becomes what is important. Not because it matters more, but because it is easier to see.

Sometimes a new perspective is helpful. Rather than asking, "How can I get more?" Try asking, "What is an inspiring way to live?"


​

2 Quotes From Others
I.

The 4th Earl of Chesterfield, Philip Dormer Stanhope, on focus:

"There is time enough for everything, in the course of the day, if you do but one thing at once; but there is not time enough in the year, if you will do two things at a time."

Source: Letter to his son. Letter IX (April 14, 1747).​​

​II.

Investor Charlie Munger on hardship and perseverance:

"Assume life will be really tough, and then ask if you can handle it. If the answer is yes, you've won."

"Life is very likely to provide terrible blows, unfair blows. Some people recover, and others don't. And there I think the attitude of Epictetus helps guide one to the right reaction. He thought that every mischance in life, however bad, created an opportunity to behave well. He believed every mischance provided an opportunity to learn something useful. And one's duty was not to become immersed in self-pity, but to utilize each terrible blow in a constructive fashion."

Source: The first quote is unsourced. The second is from the USC Gould School of Law Commencement Address (May 13, 2007)


​

1 Question For You
Greet each morning with a sense of hope.

What grand future are you building?

Want to share this issue of 3-2-1? Just copy and paste this link: https://jamesclear.com/3-2-1/july-30-2026

​

Until next week,

James Clear`;

describe("parseAttribution", () => {
  it("splits a plain 'Name on topic:' line", () => {
    expect(parseAttribution("Investor Charlie Munger on hardship and perseverance:")).toEqual({
      author: "Investor Charlie Munger",
      topic: "hardship and perseverance",
    });
  });

  it("handles a name containing commas, with a comma before 'on'", () => {
    expect(parseAttribution("The 4th Earl of Chesterfield, Philip Dormer Stanhope, on focus:")).toEqual({
      author: "The 4th Earl of Chesterfield, Philip Dormer Stanhope",
      topic: "focus",
    });
  });

  it("returns the whole line as the author when there is no topic", () => {
    expect(parseAttribution("Marcus Aurelius:")).toEqual({ author: "Marcus Aurelius", topic: "" });
  });
});

describe("parseThreeTwoOneNewsletter", () => {
  const result = parseThreeTwoOneNewsletter(REAL_ISSUE);

  it("finds all three section headings", () => {
    expect(result.sectionsFound).toEqual([
      "3 Ideas From Me",
      "2 Quotes From Others",
      "1 Question For You",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("extracts 3 ideas, 3 quotes (Munger splits in two) and 1 question", () => {
    const bySection = (section: string) => result.candidates.filter((c) => c.section === section);
    expect(bySection("Ideas")).toHaveLength(3);
    expect(bySection("Quotes")).toHaveLength(3);
    expect(bySection("Question")).toHaveLength(1);
  });

  it("credits the ideas to the newsletter's author and strips the outer quotes", () => {
    const [first] = result.candidates;
    expect(first.author).toBe("James Clear");
    expect(first.quote).toBe(
      "If you always want more, then you'll find the most you can have will always be too little.",
    );
  });

  it("keeps a multi-paragraph idea whole, including its internal quotations", () => {
    const measured = result.candidates.find((c) => c.quote.startsWith("Whatever can be measured"));
    expect(measured).toBeDefined();
    // The nested quotes must survive — this is what naive quote-pair matching breaks.
    expect(measured!.quote).toContain('"How can I get more?"');
    expect(measured!.quote).toContain('"What is an inspiring way to live?"');
    // All three paragraphs are present.
    expect(measured!.quote).toContain("And once we notice a number");
    expect(measured!.quote).toContain("Sometimes a new perspective is helpful");
  });

  it("parses the attribution and source for the Chesterfield quote", () => {
    const chesterfield = result.candidates.find((c) => c.quote.startsWith("There is time enough"));
    expect(chesterfield).toMatchObject({
      author: "The 4th Earl of Chesterfield, Philip Dormer Stanhope",
      topic: "focus",
      source: "Letter to his son. Letter IX (April 14, 1747).",
      section: "Quotes",
    });
  });

  it("splits Munger's two paragraphs into separate candidates sharing one source", () => {
    const munger = result.candidates.filter((c) => c.author === "Investor Charlie Munger");
    expect(munger).toHaveLength(2);
    expect(munger[0].quote).toBe(
      "Assume life will be really tough, and then ask if you can handle it. If the answer is yes, you've won.",
    );
    expect(munger[1].quote).toContain("Life is very likely to provide terrible blows");
    expect(munger[0].source).toContain("USC Gould School of Law");
    expect(munger[1].source).toBe(munger[0].source);
  });

  it("takes the question itself, not its lead-in line", () => {
    const question = result.candidates.find((c) => c.section === "Question");
    expect(question?.quote).toBe("What grand future are you building?");
  });

  it("ignores the preamble, the share link, and the sign-off", () => {
    const text = result.candidates.map((c) => c.quote).join(" ");
    expect(text).not.toContain("Here are 3 ideas");
    expect(text).not.toContain("jamesclear.com");
    expect(text).not.toContain("Until next week");
  });
});

describe("parseThreeTwoOneNewsletter — unhappy paths", () => {
  it("warns rather than throwing on unrelated text", () => {
    const result = parseThreeTwoOneNewsletter("Dear friend,\n\nHope you are well.\n");
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings).toContain("No quotes could be extracted from this text.");
  });

  it("reports which expected section is missing", () => {
    const result = parseThreeTwoOneNewsletter('3 Ideas From Me\nI.\n\n"Just the one idea."\n');
    expect(result.candidates).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("Quotes"))).toBe(true);
  });

  it("handles straight quotes as well as curly ones", () => {
    const result = parseThreeTwoOneNewsletter('3 Ideas From Me\nI.\n\n"Straight quoted idea."\n');
    expect(result.candidates[0].quote).toBe("Straight quoted idea.");
  });
});
