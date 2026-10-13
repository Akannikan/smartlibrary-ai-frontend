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
- **Add Book** (`/add-book`) enters bibliographic and copy information. A title-page image can be OCRed by the English Tesseract model running on the Express backend. Staff review the results and always assign the accession number themselves.
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
| `VITE_API_URL` | Frontend / local only | Optional API origin; Vite's proxy works by default. |
| `AI_API_KEY` | Backend | Not needed for the MVP. The current Suggest feature uses local heuristics. |

Environment templates are in `backend/.env.example` and `frontend/.env.example`. Never commit `.env` files or secrets.

## OCR and privacy

PNG, JPEG, and WebP images up to 7 MB are sent to the Express backend and processed with the bundled English Tesseract.js model. The backend does not write the uploaded image to disk or save it to the database. OCR is self-hosted and requires no paid API, external OCR provider, or API key. The public endpoint is limited to 10 image requests per IP per 15 minutes to protect the server from excessive CPU use.

OCR reads visible text; it does not guarantee correct catalogue data. Image clarity, skew, print quality, page layout, and language affect accuracy. Staff should review every extracted value. The parser does not assign accession numbers or invent details that are not visible.

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

Backend OCR tests use a generated sample image and the bundled model; they do not call paid services. Frontend tests cover OCR text-to-field parsing. GitHub Actions runs both test suites and the frontend build on pushes and pull requests to `main`.

## Deployment

### Render backend

Deploy using [render.yaml](./render.yaml), or create a Node web service with `backend` as its root directory:

- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` to the PostgreSQL connection string in Render's private environment settings.
- The blueprint sets `FRONTEND_URL` for CORS and uses `/api/health` as the health check.
- No OCR API key or OCR-provider secret is needed.

### Vercel frontend

Import the repository with `frontend` as its root directory. Use `npm run build` and `dist` as the output directory. [vercel.json](./frontend/vercel.json) forwards `/api/*` to the Render service and routes frontend paths to the React app. Update its Render destination if your backend's hostname differs.

## MVP limitations

- There is no login or role-based access control; do not expose sensitive production library records without adding authentication.
- Suggest uses deterministic local heuristics, not generative AI.
- OCR results need human review and can be poor for blurred, skewed, decorative, or low-contrast images.
- Book covers often omit publication details; photograph the inside title/imprint page for best results.
