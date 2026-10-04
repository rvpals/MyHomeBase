import { describe, expect, it } from "vitest";
import {
  buildReceiptPath,
  receiptExtension,
  receiptMimeTypeFor,
  sanitizeNameSegment,
  withCollisionSuffix,
} from "./receipt-path";

describe("buildReceiptPath", () => {
  it("files under the year, named date_payee_amount_id", () => {
    expect(
      buildReceiptPath({ id: 17, entryDate: "2026-10-03", payee: "CVS", amountCents: 4250, mimeType: "image/jpeg" }),
    ).toBe("2026/2026-10-03_CVS_$42.50_17.jpg");
  });

  it("puts a $ in front of the amount", () => {
    const built = buildReceiptPath({
      id: 1,
      entryDate: "2026-01-02",
      payee: "Rite Aid",
      amountCents: 500,
      mimeType: "image/png",
    });
    expect(built).toBe("2026/2026-01-02_Rite-Aid_$5.00_1.png");
  });

  it("uses the expense's own year, and a PDF extension for a PDF", () => {
    expect(
      buildReceiptPath({ id: 3, entryDate: "2024-01-15", payee: "Dr. Lee", amountCents: 12000, mimeType: "application/pdf" }),
    ).toBe("2024/2024-01-15_Dr.-Lee_$120.00_3.pdf");
  });
});

describe("sanitizeNameSegment", () => {
  it("drops characters a filesystem forbids and hyphenates spaces", () => {
    expect(sanitizeNameSegment('Bob\'s <Pharmacy>: "Main/St"')).toBe("Bob's-PharmacyMainSt");
  });

  it("trims trailing dots, which Windows silently strips", () => {
    expect(sanitizeNameSegment("Acme Inc.")).toBe("Acme-Inc");
  });

  it("caps the length", () => {
    expect(sanitizeNameSegment("x".repeat(100))).toHaveLength(40);
  });

  it("never returns empty", () => {
    expect(sanitizeNameSegment("???")).toBe("unknown");
    expect(sanitizeNameSegment("   ")).toBe("unknown");
  });
});

describe("withCollisionSuffix", () => {
  it("leaves the first candidate unchanged", () => {
    expect(withCollisionSuffix("2026/a_17.jpg", 1)).toBe("2026/a_17.jpg");
  });

  it("inserts the number before the extension", () => {
    expect(withCollisionSuffix("2026/a_17.jpg", 2)).toBe("2026/a_17-2.jpg");
  });

  it("appends when there is no extension, ignoring a dot in the folder", () => {
    expect(withCollisionSuffix("v1.0/name", 3)).toBe("v1.0/name-3");
  });
});

describe("receipt extensions and types", () => {
  it("round-trips every allowed type", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]) {
      expect(receiptMimeTypeFor(`x.${receiptExtension(mime)}`)).toBe(mime);
    }
  });

  it("reads .jpeg and upper case", () => {
    expect(receiptMimeTypeFor("A.JPEG")).toBe("image/jpeg");
  });

  it("refuses an unknown type", () => {
    expect(() => receiptExtension("image/svg+xml")).toThrow();
    expect(receiptMimeTypeFor("x.svg")).toBeUndefined();
  });
});
