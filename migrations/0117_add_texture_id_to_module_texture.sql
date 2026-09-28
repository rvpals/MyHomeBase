-- Lets a module point at a picture already in the app texture library, instead
-- of uploading one of its own or inheriting the app-wide background.
--
-- WHY A POINTER AND NOT A SECOND COPY OF THE BYTES. The library
-- (sys_dashboard_textures, 0113) already holds up to 20 pictures, each tuned
-- with its own opacity/mode/blur. A module choosing "Linen" wants *that*
-- picture, as tuned -- so it stores the id. Copying the BLOB per module would
-- multiply 4 MB by nine modules for pictures the admin already uploaded once,
-- and re-tuning Linen would then leave every module holding a stale copy.
--
-- WHY AN EXPLICIT MODE COLUMN. There are four states, and three of them are
-- "no bytes in this row":
--
--   'inherit'  -- draw the app-wide texture (the default, and the common case)
--   'library'  -- draw sys_dashboard_textures.id = texture_id
--   'own'      -- draw this row's own `image` BLOB (what the Music Library does)
--   'none'     -- draw nothing, even when an app-wide texture is set
--
-- Inferring that from which nullable columns happen to be populated is exactly
-- the ambiguity 0064's log warns about for its own image/mime pair: 'inherit'
-- and 'none' would be indistinguishable, since both store no image and no id,
-- yet they must render differently. 'none' is the whole reason a dense module
-- can opt OUT of a background every other screen has.
--
-- WHY NO FOREIGN KEY ON texture_id. This database does not run with foreign
-- keys on -- no other table declares one -- so an FK here would read like a
-- guarantee while enforcing nothing (the same call 0113 made for
-- selected_texture_id). The resolver treats an id that no longer exists as
-- 'inherit' rather than trusting the column, so deleting a library picture a
-- module was using degrades to the app background instead of a broken URL.
ALTER TABLE sys_module_texture ADD COLUMN texture_id INTEGER;

ALTER TABLE sys_module_texture
  ADD COLUMN texture_mode TEXT NOT NULL DEFAULT 'inherit'
  CHECK (texture_mode IN ('inherit', 'library', 'own', 'none'));

-- Every module that already has its own uploaded picture keeps drawing it.
--
-- Without this the DEFAULT above would put the Music Library on 'inherit' and
-- its background -- uploaded deliberately, from its own configuration screen --
-- would silently be replaced by the app-wide one. The bytes would still be in
-- the row, which makes it the worst kind of regression: nothing is lost, so
-- nothing looks wrong until somebody notices the wrong picture.
--
-- Guarded on `image IS NOT NULL`: a row carrying only display knobs (0064
-- allows one -- an admin who tuned the sliders then removed the picture) is not
-- a module with a texture, and must stay on 'inherit'.
UPDATE sys_module_texture SET texture_mode = 'own' WHERE image IS NOT NULL;

-- Everything else lands on 'inherit', which is byte-for-byte how it renders
-- today: migration 0116 ships with the app-wide flag off, so an install that has
-- not ticked it sees no change at all, and one that has sees the background it
-- asked for.
