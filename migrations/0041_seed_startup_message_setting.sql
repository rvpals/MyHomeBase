-- Blank by default: an empty value means "no message to show".
INSERT OR IGNORE INTO sys_app_settings (key, value, description)
VALUES (
  'STARTUP_MESSAGE',
  '',
  'If the value is not blank, display this message when the application home screen is reached.'
);
