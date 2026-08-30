-- The rule wildcard becomes "%", and "*" becomes an ordinary literal character.
--
-- Statement descriptions are full of asterisks: an order reference
-- ("AMAZON.COM*2A34B5C6"), a payment processor prefix ("SQ *JOES COFFEE"), or a
-- charge the card annotates ("COSTCO *ANNUAL RENEWAL*"). While "*" was the
-- wildcard there was no way to ask for the character a statement actually
-- prints, so a pattern was always broader than it looked: "AMAZON.COM*" meant
-- "starts with AMAZON.COM" and swept up "AMAZON.COM RETURN CREDIT" too.
--
-- "%" carries no meaning in card text, and already reads as a wildcard to anyone
-- who has written SQL LIKE. See compilePattern in src/lib/expense/rules.ts.

-- Every "*" in a stored pattern was a wildcard, so this translation is exact:
-- no existing rule changes which descriptions it matches.
--
-- The ESCAPE clause matters. In LIKE, "%" and "_" are the pattern language, so
-- the literal asterisk we're hunting for has to be wrapped in wildcards that
-- LIKE understands: '%*%' reads "any text, an asterisk, any text". No character
-- here needs escaping, but declaring ESCAPE '\' keeps the statement honest if
-- this ever grows a literal "%" or "_" to match.
UPDATE exp_post_import_rules
SET pattern = REPLACE(pattern, '*', '%')
WHERE pattern LIKE '%*%' ESCAPE '\';

-- Safe to re-run: after the first pass no pattern contains "*", so the WHERE
-- clause matches nothing. It is not idempotent in the strict sense — it can't
-- be, since the operation is a one-way translation of a character that is now
-- meaningful in the other direction — but re-running it cannot corrupt a row.
--
-- No index or trigger covers `pattern`, and nothing else in the schema stores a
-- glob, so this is the only table the change touches.
