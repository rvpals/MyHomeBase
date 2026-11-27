// The image the dependency test OCRs: two lines of black text on white, 640x150 PNG.
//
// Embedded rather than drawn at run time, so the Tesseract check depends on nothing but
// Tesseract -- drawing text on the NAS would need fonts the box may not have, and a
// fonts problem would then read as an OCR failure. Rendered once on the dev box with
// @napi-rs/canvas (bold 40px Arial), quantised to 4 greys by sharp: 2286 bytes.
// Read back at 96% confidence by tesseract.js 7.0.0 when it was made.

/** The words the check expects to find, case-insensitively. */
export const OCR_SAMPLE_WORDS = ["HOME", "BASE", "OCR", "Quick", "brown", "fox", "2026"] as const;

/** The sample as base64, split into lines to keep the file diffable. */
export const OCR_SAMPLE_PNG_BASE64 = [
  "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",
].join("");
