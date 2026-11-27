-- Clips: drawings. A drawing is an image row that also keeps the strokes it was
-- rasterised from, so it can be reopened on the drawing pad and edited.
--
-- One nullable column on the image table, and the same column on its recycle-bin
-- mirror (0161) so a binned drawing comes back editable rather than as a flat
-- picture. NULL means "an ordinary pasted image"; a JSON document means "a
-- drawing". See the .md log for why this is not a table of its own.

ALTER TABLE clp_clip_images ADD COLUMN drawing_json TEXT;

ALTER TABLE clp_recycled_clip_images ADD COLUMN drawing_json TEXT;
