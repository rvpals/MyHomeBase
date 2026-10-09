import { z } from "zod";

/**
 * The upper bound on a single slice, in source pixels.
 *
 * Not a guess at what artwork looks like — it is the point past which the
 * *card* breaks. The four insets become the card's border widths, so a 600px
 * slice on a 400px-wide card leaves negative room for content and the browser
 * silently collapses the centre. 256 is comfortably above any plausible frame
 * (the ornate ones run 60-120px) and far below the first size that can do that
 * on a phone.
 *
 * Restated here as well as in the table's CHECK on purpose, the same split
 * migration 0130 documents: the CHECK is the last line of defence and reports a
 * SQLite error, while this reports a sentence the admin screen can show. The
 * CLI reaches the same use-case without passing through the form.
 */
export const MAX_CARD_FRAME_SLICE = 256;

const sliceSchema = z
  .number({ message: "Give each edge a number of pixels." })
  .int("Slices are whole pixels.")
  .min(0, "A slice cannot be negative.")
  .max(MAX_CARD_FRAME_SLICE, `Keep each slice under ${MAX_CARD_FRAME_SLICE}px.`);

export const cardFrameInsetsSchema = z.object({
  top: sliceSchema,
  right: sliceSchema,
  bottom: sliceSchema,
  left: sliceSchema,
});

export const cardFrameSettingsSchema = z.object({
  insets: cardFrameInsetsSchema,
  // 0..1, matching the table's CHECK so the two cannot disagree about what a
  // valid opacity is. Dims the centre fill only — see `CardFrame.fillOpacity`.
  fillOpacity: z
    .number({ message: "Give the background an opacity." })
    .min(0, "Opacity runs from 0 to 1.")
    .max(1, "Opacity runs from 0 to 1."),
  fill: z.enum(["stretch", "repeat", "round"], {
    message: "Choose how the edges run: stretch, repeat or round.",
  }),
  centerFill: z.boolean({ message: "Say whether the centre paints as the background." }),
});

export type CardFrameSettingsInput = z.infer<typeof cardFrameSettingsSchema>;

/**
 * 40 characters, as `dashboardTextureNameSchema` uses — what a gallery tile's
 * caption shows without truncating. The column itself is unbounded TEXT; this
 * is a presentation bound, not a storage one.
 */
export const cardFrameNameSchema = z
  .string()
  .trim()
  .min(1, "Give the frame a name.")
  .max(40, "Keep the name under 40 characters.");
