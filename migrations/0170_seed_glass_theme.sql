-- Seeds the "Glass" built-in color theme. See migrations/0170_seed_glass_theme.md.
-- OR IGNORE: safe to re-run, and never overwrites an admin's edit of an existing row.
INSERT OR IGNORE INTO sys_color_themes
  (id, name, description, paper, paper_raised, ink, line, muted, muted_inverse,
   brass, brass_dark, brass_soft, font_display, font_body, font_mono, is_builtin, sort_order)
VALUES
  ('glass', 'Glass', 'Translucent surfaces, soft luminous edges and ambient color orbs.',
   '#0F1117', '#1E222E', '#E1E4ED', '#2A2E3A', '#8B90A5', '#5A5F73',
   '#6C8AFF', '#4A6AE0', '#1B2342', 'inter', 'inter', 'jetbrains-mono', 1, 90);
