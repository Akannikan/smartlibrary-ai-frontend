CREATE TABLE IF NOT EXISTS bibliographic_records (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  publisher TEXT,
  publication_place TEXT,
  publication_year TEXT,
  edition TEXT,
  isbn TEXT,
  pages TEXT,
  language TEXT,
  physical_description TEXT,
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  ddc_number TEXT,
  ddc_justification TEXT,
  ddc_verification_status TEXT NOT NULL DEFAULT 'pending',
  call_number TEXT,
  bibliographic_source TEXT,
  source_record_id TEXT,
  source_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS physical_copies (
  id SERIAL PRIMARY KEY,
  bibliographic_record_id INTEGER NOT NULL REFERENCES bibliographic_records(id) ON DELETE CASCADE,
  accession_number TEXT NOT NULL UNIQUE,
  accession_date DATE,
  source_of_acquisition TEXT,
  price NUMERIC(10,2),
  condition TEXT,
  status TEXT DEFAULT 'available',
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bibliographic_records
  ADD COLUMN IF NOT EXISTS ddc_justification TEXT,
  ADD COLUMN IF NOT EXISTS ddc_verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bibliographic_source TEXT,
  ADD COLUMN IF NOT EXISTS source_record_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_bibliographic_records_title ON bibliographic_records (title);
CREATE INDEX IF NOT EXISTS idx_bibliographic_records_author ON bibliographic_records (author);
CREATE INDEX IF NOT EXISTS idx_bibliographic_records_isbn ON bibliographic_records (isbn);
CREATE INDEX IF NOT EXISTS idx_physical_copies_accession_number ON physical_copies (accession_number);
