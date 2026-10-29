# smartLibrary AI

smartLibrary AI is a small-library catalogue MVP. Staff can create book records, record physical copies under manually assigned accession numbers, search the catalogue, maintain the accession register, and export register data.

## Walkthrough

```text
Browser (React + Vite)
  ├── local /api/* ──────> Express on localhost:5000
  └── production /api/* ─> Vercel rewrite ─> Express on Render
                                               └── PostgreSQL on Neon
```

- **Dashboard** (`/`) shows the number of titles and copies plus recent additions.
- **Add Book** (`/add-book`) captures or uploads a book image, uses English OCR, and searches Open Library by ISBN, title and author. Confident online matches automatically fill available bibliographic details, including page count, and a short book summary; ISBNs are normalized and checksum-validated. Publication place, year and edition remain optional when unavailable, and staff can record binding (hardcover or paperback) and other physical details.
- **Catalogue** (`/catalogue`) searches for and lists records and copies.
- **Book Details** (`/books/:id`) shows and edits a record.
- **Accession Register** (`/accession-register`) lists physical copies and provides CSV and Excel exports.
- **Express API** ([server.js](./backend/server.js)) handles catalogue, copy, OCR, and export requests.
- **PostgreSQL** ([init.sql](./backend/migrations/init.sql)) stores bibliographic records separately from copies, allowing a title to have multiple separately accessioned copies.

## Project structure

```text
.
├── .github/workflows/ci.yml
├── backend/
│   ├── migrations/init.sql
│   ├── .env.example
│   ├── bookLookup.js
│   ├── bookLookup.test.js
│   ├── db.js
│   ├── ocr.js
│   ├── ocr.test.js
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── src/pages/
│   ├── src/services/
│   ├── .env.example
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
├── .nvmrc
├── render.yaml
└── README.md
```

## Requirements

- Node.js 20 or newer and npm.
- PostgreSQL for saved library records. Neon PostgreSQL is used in the hosted setup.
- **No Google Cloud account, OCR API key, separate Tesseract installation, or OCR usage fee is needed.** The backend ships with the English Tesseract model.

## Run locally on Windows

1. Create a PostgreSQL database and copy its connection string.
2. In PowerShell, install and configure the backend:

   ```powershell
   Set-Location backend
   npm ci
   Copy-Item .env.example .env
   ```

   Put the PostgreSQL connection string in `backend/.env` as `DATABASE_URL`.

3. Start the backend; on first startup it applies `backend/migrations/init.sql`:

   ```powershell
   npm start
   ```

   Check `http://localhost:5000/api/health`; the database status should be `connected`.

4. In a second PowerShell terminal, install and start the frontend:

   ```powershell
   Set-Location frontend
   npm ci
   Copy-Item .env.example .env
   npm run dev
   ```

5. Open `http://localhost:5173`. Vite forwards `/api/*` requests to the local backend. You can use OCR without any extra credentials; saved book records still require a configured database.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend / Render | PostgreSQL connection string; required by the server. |
| `PORT` | Backend / Render | HTTP port; defaults to `5000` locally. Render supplies it in production. |
| `FRONTEND_URL` | Backend / Render | Frontend origin allowed by backend CORS. |
| `VITE_API_URL` | Frontend / Vercel | Backend origin, for example `https://your-service.onrender.com`. Leave blank locally to use Vite's proxy. |
| `VITE_OCR_API_URL` | Frontend | Optional separate backend origin for OCR and catalogue lookup; defaults to `VITE_API_URL`. |
| `AI_API_KEY` | Backend | Not needed for the MVP. Subjects and class suggestions use the public Open Library catalogue. |

Environment templates are in `backend/.env.example` and `frontend/.env.example`. Never commit `.env` files or secrets.

## OCR and privacy

PNG, JPEG, and WebP images up to 7 MB can be selected from a device or captured with the browser camera. Images are compressed in the browser and sent directly to the Express backend to avoid proxy upload limits. The bundled English Tesseract.js model reads the image locally on the backend; the image is not stored or sent to Open Library. OCR returns after a clear first recognition pass and runs additional passes only when the image is difficult to read. SmartLibrary searches Open Library with the detected ISBN, title and author, including separate title and author searches and a full-text fallback when the first pass cannot confirm a match. Matching tolerates minor OCR title errors when the author also confirms the result, while uncertain results remain available for staff to select. Confident matches automatically populate the available title, author, edition, publisher, publication, ISBN, page, language, subject and classification fields. A short summary is added to Notes when Open Library provides a work description or first sentence. This supports a broad range of books, but no public catalogue contains every book or edition; details unavailable online remain editable for manual entry. When a verified Dewey number is unavailable, a broad DDC class may be suggested from the returned subject headings; review it and the locally formatted call number before saving. No paid AI key is required. The OCR endpoint is limited to 10 image requests per IP per 15 minutes.

OCR reads visible text; it does not guarantee correct catalogue data. If the cover text is unclear, the page offers likely Open Library matches to choose from rather than guessing the book. A straight, well-lit image helps; a title page or ISBN can improve matching when the cover is hard to read. Catalogue and OCR details, including the generated Notes summary, are editable; enter copy details such as accession number, price and condition manually. Staff should review all results.

## Test and build

From the project root, run these commands in PowerShell:

```powershell
Push-Location backend
npm ci
npm test
Pop-Location

Push-Location frontend
npm ci
npm test
npm run build
Pop-Location
```

Backend tests cover OCR image recognition and matching the public catalogue response; lookup tests use fixture data and do not call external services. Frontend tests cover OCR text-to-field parsing. GitHub Actions runs both test suites and the frontend build on pushes and pull requests to `main`.

## Deployment

### Render backend

Deploy using [render.yaml](./render.yaml), or create a Node web service with `backend` as its root directory:

- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` to the PostgreSQL connection string in Render's private environment settings.
- The blueprint sets `FRONTEND_URL` for CORS and uses `/api/health` as the health check.
- No OCR API key or OCR-provider secret is needed.

### Vercel frontend

Import the repository with `frontend` as its root directory. Use `npm run build` and `dist` as the output directory. In Vercel project settings, set `VITE_API_URL` to the actual Render backend origin and redeploy. The Vercel rewrite only serves React routes; API calls use this environment variable directly. Set `VITE_OCR_API_URL` only when OCR/catalogue lookup uses a different backend origin.

## MVP limitations

- There is no login or role-based access control; do not expose sensitive production library records without adding authentication.
- Catalogue matches and subject-based DDC suggestions are not a substitute for a librarian's classification review.
- OCR results need human review and can be poor for blurred, skewed, decorative, or low-contrast images.
- Book covers often omit publication details; photograph the inside title/imprint page for best results.
