-- A small icon per location category and tag, so a saved place's categories are
-- recognisable at a glance wherever they're listed.
--
-- Exactly the shape migration 0042 gave jrn_categories/jrn_tags, for the same
-- reasons: a BLOB with its mime type alongside, served by a dedicated route
-- rather than inlined as a base64 data URL, so the bytes never bloat a JSON
-- payload and the browser can cache them.
--
-- Reads of the category/tag lists must select columns explicitly to avoid
-- pulling the blob on every page load.
--
-- Both columns are nullable rather than defaulted: "no icon" is a real state,
-- and an empty blob is not a sensible stand-in for it.
ALTER TABLE jrn_location_categories ADD COLUMN icon_image BLOB;
ALTER TABLE jrn_location_categories ADD COLUMN icon_image_mime_type TEXT;

ALTER TABLE jrn_location_tags ADD COLUMN icon_image BLOB;
ALTER TABLE jrn_location_tags ADD COLUMN icon_image_mime_type TEXT;
