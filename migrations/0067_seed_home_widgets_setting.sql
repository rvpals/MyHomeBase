INSERT OR IGNORE INTO sys_app_settings (key, value, description)
VALUES (
  'home_widgets',
  'carousel,dailyQuote,todayInHistory,randomPhoto,stockGlance',
  'Which home screen cards are drawn and in what order. A "-" prefix hides one.'
);
