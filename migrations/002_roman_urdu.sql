-- The form can now be filled in Roman Urdu as well as English and Urdu script.
ALTER TABLE responses DROP CONSTRAINT responses_language_check;
ALTER TABLE responses ADD CONSTRAINT responses_language_check CHECK (language IN ('en', 'ur', 'roman'));
