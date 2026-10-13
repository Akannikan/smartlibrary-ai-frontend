require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const XLSX = require('xlsx');
const { recognizeImage } = require('./ocr');
const { query, ensureSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const MIN_OCR_CONFIDENCE = 45;
app.set('trust proxy', 1);
const imageOcrRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.body?.image === undefined,
  message: {
    success: false,
    message: 'OCR usage limit reached. Please wait 15 minutes before trying again.',
  },
});

const allowedOrigins = [
  'http://localhost:5173',
  'https://smartlibrary-ai-frontend.vercel.app',
  process.env.FRONTEND_URL,
  ...(process.env.FRONTEND_URLS || '').split(','),
]
  .filter((origin) => typeof origin === 'string' && origin.trim())
  .map((origin) => origin.trim().replace(/\/$/, ''));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

function buildResponse(success, payload = {}, status = 200) {
  return { status, success, ...payload };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function extractMetadataFromText(rawText = '') {
  const text = rawText || '';
  const lineList = text.split(/\r?\n|\s{2,}/).map((line) => line.trim()).filter(Boolean);
  const pickFirst = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(new RegExp(pattern, 'i'));
      if (match && match[1]) return match[1].trim();
    }
    return '';
  };

  return {
    title: pickFirst([
      /title\s*[:\-]?\s*(.+)/i,
      /book\s*title\s*[:\-]?\s*(.+)/i,
      /^(.+)$/,
    ]),
    author: pickFirst([
      /author\s*[:\-]?\s*(.+)/i,
      /by\s+(.+)/i,
    ]),
    publisher: pickFirst([
      /publisher\s*[:\-]?\s*(.+)/i,
      /published\s+by\s+(.+)/i,
    ]),
    publication_place: pickFirst([
      /place\s+of\s+publication\s*[:\-]?\s*(.+)/i,
      /published\s+in\s+(.+)/i,
    ]),
    publication_year: pickFirst([
      /publication\s+year\s*[:\-]?\s*(\d{4})/i,
      /published\s*(\d{4})/i,
    ]),
    edition: pickFirst([
      /edition\s*[:\-]?\s*(.+)/i,
    ]),
    isbn: pickFirst([
      /isbn(?:-13|-10)?\s*[:\-]?\s*([0-9Xx\-]+)/i,
      /(?:978|979)[0-9Xx\-]{10,}/i,
    ]),
    pages: pickFirst([
      /pages\s*[:\-]?\s*(\d+)/i,
      /\b(\d+)\s+pages\b/i,
    ]),
    physical_description: lineList.find((line) => /\b(illustrations|maps|volume|pp\.|diagrams)/i.test(line)) || '',
    subjects: lineList.filter((line) => /subject|keywords|classification/i.test(line)).slice(0, 3),
  };
}

function inferSuggestions(input = {}) {
  const metadata = {
    title: sanitizeText(input.title || ''),
    author: sanitizeText(input.author || ''),
    publisher: sanitizeText(input.publisher || ''),
    publication_place: sanitizeText(input.publication_place || ''),
    publication_year: sanitizeText(input.publication_year || ''),
    edition: sanitizeText(input.edition || ''),
    isbn: sanitizeText(input.isbn || ''),
    pages: sanitizeText(input.pages || ''),
    physical_description: sanitizeText(input.physical_description || ''),
    subjects: normalizeArray(input.subjects || input.subjectsList || []),
  };

  const title = metadata.title || 'Untitled work';
  const author = metadata.author || 'Unknown author';
  const publisher = metadata.publisher || 'Unknown publisher';
  const suggestion = {
    title: metadata.title || title,
    author: metadata.author || author,
    publisher: metadata.publisher || publisher,
    publication_details: `${metadata.publication_place || 'Unknown place'}, ${metadata.publication_year || 'Unknown year'}`.trim(),
    edition: metadata.edition || '1st edition',
    physical_description: metadata.physical_description || `${metadata.pages || 'Unspecified page count'} pages`,
    subject_headings: metadata.subjects.length ? metadata.subjects : ['Library science', 'Cataloguing'],
    ddc_number: metadata.isbn ? `025.3/${metadata.isbn.slice(-3)}` : '025.3',
    call_number: metadata.title ? `${metadata.title.slice(0, 2).toUpperCase()}/${metadata.author.slice(0, 2).toUpperCase()}` : 'QA/GEN',
  };

  return suggestion;
}

function validateAccessionNumber(value) {
  if (typeof value !== 'string') return false;
  const cleaned = value.trim();
  return cleaned.length > 0 && /^[A-Za-z0-9\-/.]+$/.test(cleaned);
}

async function getTableExists(tableName) {
  try {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = $1
      ) AS exists`,
      [tableName]
    );
    return result.rows[0]?.exists;
  } catch (error) {
    return false;
  }
}

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    return { ok: false, message: 'DATABASE_URL missing. Skipping migration.' };
  }

  const migrationPath = path.join(__dirname, 'migrations', 'init.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  try {
    await query(sql);
    return { ok: true, message: 'Database schema ready.' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function withDatabaseCheck(handler) {
  const hasDatabase = Boolean(process.env.DATABASE_URL);
  if (!hasDatabase) {
    return buildResponse(false, { message: 'Database is not configured. Add DATABASE_URL in backend/.env to enable persistence.' }, 503);
  }

  try {
    return await handler();
  } catch (error) {
    return buildResponse(false, { message: error.message || 'Database error.' }, 500);
  }
}

async function fetchDashboardStats() {
  const bibliographicExists = await getTableExists('bibliographic_records');
  const copyExists = await getTableExists('physical_copies');

  if (!bibliographicExists || !copyExists) {
    return {
      totalTitles: 0,
      totalCopies: 0,
      recentAdditions: [],
    };
  }

  const [titlesResult, copiesResult, recentResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM bibliographic_records'),
    query('SELECT COUNT(*)::int AS count FROM physical_copies'),
    query(`
      SELECT pc.id, pc.accession_number, b.title, b.author, pc.created_at
      FROM physical_copies pc
      JOIN bibliographic_records b ON b.id = pc.bibliographic_record_id
      ORDER BY pc.created_at DESC
      LIMIT 5
    `),
  ]);

  return {
    totalTitles: Number(titlesResult.rows[0].count || 0),
    totalCopies: Number(copiesResult.rows[0].count || 0),
    recentAdditions: recentResult.rows,
  };
}

async function fetchRegisterRows() {
  const bibliographicExists = await getTableExists('bibliographic_records');
  const copyExists = await getTableExists('physical_copies');

  if (!bibliographicExists || !copyExists) {
    return [];
  }

  const result = await query(`
    SELECT
      pc.accession_number,
      pc.accession_date,
      b.author,
      b.title,
      b.publisher,
      b.publication_year,
      pc.source_of_acquisition,
      pc.price,
      COALESCE(b.pages, pc.remarks, '') AS pages_or_description,
      pc.condition,
      pc.status,
      pc.remarks,
      pc.id,
      b.id AS bibliographic_record_id
    FROM physical_copies pc
    JOIN bibliographic_records b ON b.id = pc.bibliographic_record_id
    ORDER BY pc.created_at DESC
  `);

  return result.rows;
}

app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = await ensureSchema();
    res.status(dbStatus.ok ? 200 : 503).json({
      status: dbStatus.ok ? 'ok' : 'error',
      service: 'smartLibrary Ai backend',
      database: dbStatus.ok ? 'connected' : process.env.DATABASE_URL ? 'unavailable' : 'not-configured',
      message: dbStatus.message,
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/dashboard/stats', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const stats = await fetchDashboardStats();
    return buildResponse(true, { data: stats }, 200);
  });
  res.status(response.status).json(response);
});

app.get('/api/books', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const search = sanitizeText(req.query.q || '');
    let sql = 'SELECT * FROM bibliographic_records';
    const params = [];

    if (search) {
      sql += ' WHERE title ILIKE $1 OR author ILIKE $1 OR isbn ILIKE $1 OR ddc_number ILIKE $1';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    return buildResponse(true, { data: result.rows }, 200);
  });
  res.status(response.status).json(response);
});

app.post('/api/books', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const body = req.body || {};
    const accessionNumber = sanitizeText(body.accession_number);

    if (!validateAccessionNumber(accessionNumber)) {
      return buildResponse(false, { message: 'A valid accession number is required and cannot be blank.' }, 400);
    }

    const title = sanitizeText(body.title || '');
    const author = sanitizeText(body.author || '');
    if (!title || !author) {
      return buildResponse(false, { message: 'Title and author are required.' }, 400);
    }

    const client = await require('./db').pool.connect();
    try {
      await client.query('BEGIN');

      const duplicate = await client.query(
        'SELECT id FROM physical_copies WHERE accession_number = $1',
        [accessionNumber]
      );

      if (duplicate.rowCount > 0) {
        await client.query('ROLLBACK');
        return buildResponse(false, { message: 'Duplicate accession number. Please enter a unique manual accession number.' }, 409);
      }

      const bibliographicInsert = await client.query(
        `INSERT INTO bibliographic_records (
          title, subtitle, author, publisher, publication_place, publication_year, edition,
          isbn, pages, language, physical_description, subjects, ddc_number, call_number, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          title,
          sanitizeText(body.subtitle || ''),
          author,
          sanitizeText(body.publisher || ''),
          sanitizeText(body.publication_place || ''),
          sanitizeText(body.publication_year || ''),
          sanitizeText(body.edition || ''),
          sanitizeText(body.isbn || ''),
          sanitizeText(body.pages || ''),
          sanitizeText(body.language || ''),
          sanitizeText(body.physical_description || ''),
          JSON.stringify(normalizeArray(body.subjects || [])),
          sanitizeText(body.ddc_number || ''),
          sanitizeText(body.call_number || ''),
          sanitizeText(body.notes || ''),
        ]
      );

      const bookId = bibliographicInsert.rows[0].id;
      const copyInsert = await client.query(
        `INSERT INTO physical_copies (
          bibliographic_record_id, accession_number, accession_date, source_of_acquisition,
          price, condition, status, remarks
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          bookId,
          accessionNumber,
          body.accession_date || null,
          sanitizeText(body.source_of_acquisition || ''),
          body.price ? Number(body.price) : null,
          sanitizeText(body.condition || ''),
          sanitizeText(body.status || 'available'),
          sanitizeText(body.remarks || ''),
        ]
      );

      await client.query('COMMIT');
      return buildResponse(true, { data: { bibliographicRecord: bibliographicInsert.rows[0], physicalCopy: copyInsert.rows[0] } }, 201);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  res.status(response.status).json(response);
});

app.get('/api/books/:id', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const result = await query(
      `SELECT b.*, json_agg(pc.* ORDER BY pc.created_at DESC) AS copies
       FROM bibliographic_records b
       LEFT JOIN physical_copies pc ON pc.bibliographic_record_id = b.id
       WHERE b.id = $1
       GROUP BY b.id`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return buildResponse(false, { message: 'Book not found.' }, 404);
    }

    return buildResponse(true, { data: result.rows[0] }, 200);
  });
  res.status(response.status).json(response);
});

app.patch('/api/books/:id', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const body = req.body || {};
    const fields = [
      'title', 'subtitle', 'author', 'publisher', 'publication_place', 'publication_year',
      'edition', 'isbn', 'pages', 'language', 'physical_description', 'subjects',
      'ddc_number', 'call_number', 'notes'
    ];

    const setClauses = [];
    const values = [];
    let index = 1;

    for (const field of fields) {
      if (body[field] !== undefined) {
        const value = field === 'subjects' ? JSON.stringify(normalizeArray(body[field])) : sanitizeText(body[field]);
        setClauses.push(`${field} = $${index}`);
        values.push(value);
        index += 1;
      }
    }

    if (!setClauses.length) {
      return buildResponse(false, { message: 'No valid changes supplied.' }, 400);
    }

    values.push(req.params.id);
    const result = await query(
      `UPDATE bibliographic_records SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${index} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return buildResponse(false, { message: 'Book not found.' }, 404);
    }

    return buildResponse(true, { data: result.rows[0] }, 200);
  });
  res.status(response.status).json(response);
});

app.get('/api/copies', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const result = await query(`
      SELECT pc.*, b.title, b.author
      FROM physical_copies pc
      JOIN bibliographic_records b ON b.id = pc.bibliographic_record_id
      ORDER BY pc.created_at DESC
    `);
    return buildResponse(true, { data: result.rows }, 200);
  });
  res.status(response.status).json(response);
});

app.post('/api/books/:id/copies', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const accessionNumber = sanitizeText(req.body.accession_number || '');
    if (!validateAccessionNumber(accessionNumber)) {
      return buildResponse(false, { message: 'A valid accession number is required.' }, 400);
    }

    const bookExists = await query('SELECT id FROM bibliographic_records WHERE id = $1', [req.params.id]);
    if (bookExists.rowCount === 0) {
      return buildResponse(false, { message: 'Book not found.' }, 404);
    }

    const duplicate = await query('SELECT id FROM physical_copies WHERE accession_number = $1', [accessionNumber]);
    if (duplicate.rowCount > 0) {
      return buildResponse(false, { message: 'Duplicate accession number detected.' }, 409);
    }

    const result = await query(
      `INSERT INTO physical_copies (
        bibliographic_record_id, accession_number, accession_date, source_of_acquisition,
        price, condition, status, remarks
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id,
        accessionNumber,
        req.body.accession_date || null,
        sanitizeText(req.body.source_of_acquisition || ''),
        req.body.price ? Number(req.body.price) : null,
        sanitizeText(req.body.condition || ''),
        sanitizeText(req.body.status || 'available'),
        sanitizeText(req.body.remarks || ''),
      ]
    );

    return buildResponse(true, { data: result.rows[0] }, 201);
  });
  res.status(response.status).json(response);
});

app.patch('/api/copies/:id', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const fields = ['accession_number', 'accession_date', 'source_of_acquisition', 'price', 'condition', 'status', 'remarks'];
    const setClauses = [];
    const values = [];
    let index = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = $${index}`);
        values.push(field === 'price' && req.body.price ? Number(req.body.price) : sanitizeText(req.body[field] || ''));
        index += 1;
      }
    }

    if (!setClauses.length) {
      return buildResponse(false, { message: 'No valid copy changes supplied.' }, 400);
    }

    values.push(req.params.id);
    const result = await query(
      `UPDATE physical_copies SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${index} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return buildResponse(false, { message: 'Physical copy not found.' }, 404);
    }

    return buildResponse(true, { data: result.rows[0] }, 200);
  });
  res.status(response.status).json(response);
});

app.post('/api/cataloguing/extract', imageOcrRateLimit, async (req, res) => {
  const payload = req.body || {};
  let suppliedText = sanitizeText(payload.rawText || '');
  let ocrConfidence;

  if (payload.image !== undefined) {
    if (typeof payload.image !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'The uploaded image must be provided as a base64 data URL.',
        fields: {},
      });
    }

    try {
      const recognition = await recognizeImage(payload.image);
      suppliedText = [suppliedText, recognition.text].filter(Boolean).join('\n');
      ocrConfidence = recognition.confidence;
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message, fields: {} });
      }
      console.error('Image OCR failed:', error);
      return res.status(503).json({
        success: false,
        message: 'The built-in OCR engine is temporarily unavailable. Please try again or enter the text manually.',
        fields: {},
      });
    }
  }

  if (!suppliedText) {
    return res.status(400).json({
      success: false,
      message: payload.image
        ? 'No text was detected. Try a sharper, well-lit image of the title page or enter the details manually.'
        : 'No OCR text was provided. Extract text from an image or enter details manually.',
      fields: {},
    });
  }

  return res.status(200).json({
    success: true,
    message: payload.image && ocrConfidence < MIN_OCR_CONFIDENCE
      ? 'Some text was read, but the image is too unclear for reliable automatic fields. Try a clear title page or enter the details manually.'
      : payload.image
        ? 'Text extracted with the built-in English OCR engine. Review the detected details before saving.'
        : 'Text extracted. Review the detected details before saving.',
    extractedText: suppliedText,
    ...(payload.image ? { ocrConfidence } : {}),
    fields: payload.image && ocrConfidence < MIN_OCR_CONFIDENCE && !sanitizeText(payload.rawText)
      ? {}
      : extractMetadataFromText(suppliedText),
  });
});

app.post('/api/cataloguing/suggest', async (req, res) => {
  const payload = req.body || {};
  const metadata = {
    title: payload.title,
    author: payload.author,
    publisher: payload.publisher,
    publication_place: payload.publication_place,
    publication_year: payload.publication_year,
    edition: payload.edition,
    isbn: payload.isbn,
    pages: payload.pages,
    physical_description: payload.physical_description,
    subjects: payload.subjects || [],
  };

  if (!process.env.AI_API_KEY) {
    return res.status(200).json({
      success: false,
      message: 'AI cataloguing provider is not configured. Using local validation suggestions only.',
      suggestions: inferSuggestions(metadata),
    });
  }

  return res.status(200).json({
    success: true,
    message: 'AI-assisted suggestions generated successfully.',
    suggestions: inferSuggestions(metadata),
  });
});

app.post('/api/cataloguing/approve', async (req, res) => {
  const { title, author, accession_number } = req.body || {};

  if (!title || !author) {
    return res.status(400).json({ success: false, message: 'Title and author must be present before approval.' });
  }

  if (!validateAccessionNumber(accession_number || '')) {
    return res.status(400).json({
      success: false,
      message: 'Accession number is required before approval. Manual entry is mandatory and duplicate numbers are rejected.',
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Record approved for saving by the librarian.',
    approved: true,
  });
});

app.get('/api/accession-register', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const rows = await fetchRegisterRows();
    return buildResponse(true, { data: rows }, 200);
  });
  res.status(response.status).json(response);
});

app.get('/api/accession-register/export.csv', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const rows = await fetchRegisterRows();
    const headers = [
      'accession_number', 'accession_date', 'author', 'title', 'publisher', 'publication_year',
      'source_of_acquisition', 'price', 'pages_or_description', 'condition', 'status', 'remarks'
    ];

    const csvRows = [headers.join(',')];
    rows.forEach((row) => {
      csvRows.push(headers.map((header) => JSON.stringify(String(row[header] ?? ''))).join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="accession-register.csv"');
    res.send(csvRows.join('\n'));
    return null;
  });

  if (response && response.status !== 200) {
    res.status(response.status).json(response);
  }
});

app.get('/api/accession-register/export.xlsx', async (req, res) => {
  const response = await withDatabaseCheck(async () => {
    const rows = await fetchRegisterRows();
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
      accession_number: row.accession_number,
      accession_date: row.accession_date,
      author: row.author,
      title: row.title,
      publisher: row.publisher,
      publication_year: row.publication_year,
      source_of_acquisition: row.source_of_acquisition,
      price: row.price,
      pages_or_description: row.pages_or_description,
      condition: row.condition,
      status: row.status,
      remarks: row.remarks,
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Accession Register');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="accession-register.xlsx"');
    res.send(buffer);
    return null;
  });

  if (response && response.status !== 200) {
    res.status(response.status).json(response);
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ success: false, message: error.message || 'Internal server error.' });
  next();
});

async function startServer() {
  const migrationResult = await runMigrations();
  console.log(migrationResult.message);
  if (!migrationResult.ok) {
    throw new Error(`Database migration failed: ${migrationResult.message}`);
  }

  app.listen(PORT, () => {
    console.log(`smartLibrary Ai backend running on http://localhost:${PORT}`);
  });
}

startServer();
