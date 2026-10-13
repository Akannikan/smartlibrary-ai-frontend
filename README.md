# smartLibrary AI

smartLibrary AI is an MVP for managing a small library catalogue and its physical copies. Staff can enter book details, use OCR to read a title-page image, review the extracted data, assign a manual accession number, and manage the catalogue and accession register.

## How the MVP fits together

```text
Browser (React + Vite)
  ├── /api/* in development ──> Express API (localhost:5000)
  └── /api/* in production ───> Vercel rewrite ──> Express API on Render
                                                   ├── PostgreSQL (Neon)
                                                   └── Google Cloud Vision OCR
```

- **Dashboard** (`/`) shows catalogue totals and recent additions.
- **Add Book** (`/add-book`) captures bibliographic and physical-copy details. An uploaded title-page image is sent to the backend for Google Cloud Vision document OCR. Detected text is parsed into fields for staff to review. Accession numbers are always entered by staff.
- **Catalogue** (`/catalogue`) searches and lists book records and copies.
- **Book details** (`/books/:id`) displays and edits a catalogue record.
- **Accession Register** (`/accession-register`) lists physical copies and supports CSV/XLSX export.
- **Express API** validates requests, runs database operations, provides OCR text to the frontend, and serves the health endpoint.
- **PostgreSQL** stores bibliographic records separately from physical copies; one title may have multiple copies with different accession numbers.
- **Google Cloud Vision** reads image text. It does not create reliable bibliographic metadata by itself; staff must review OCR results and supply details that are not printed on the page.

## Project layout

```text
.
├── backend/
│   ├── migrations/init.sql       # PostgreSQL schema
│   ├── .env.example              # Backend environment template
│   ├── db.js                     # PostgreSQL connection and health check
│   ├── ocr.js                    # Validates images and calls Cloud Vision
│   ├── ocr.test.js               # Mocked OCR-provider tests; no paid calls
│   ├── server.js                 # Express API routes and startup
│   └── package.json
├── frontend/
│   ├── src/pages/                # Dashboard, add-book, catalogue, details, register
│   ├── src/services/             # API client and metadata parser
│   ├── .env.example              # Vite environment template
│   ├── vercel.json               # Production API and SPA rewrites
│   ├── vite.config.js            # Development API proxy
│   └── package.json
├── .github/workflows/ci.yml      # Backend tests and frontend tests/build
├── .gitignore
├── render.yaml                   # Render backend service blueprint
└── README.md
```

## Requirements

- Node.js 20 or newer and npm.
- PostgreSQL for saved catalogue data. A hosted Neon database works for deployment.
- A Google Cloud project with the Cloud Vision API enabled and billing configured to use image OCR. The API key is optional for local text-only extraction, but required to extract text from images.

## Run locally

1. Create a PostgreSQL database and copy its connection string.
2. In one PowerShell terminal, install and configure the backend:

   ```powershell
   cd backend
   npm ci
   Copy-Item .env.example .env
   ```

   Set `DATABASE_URL` in `backend/.env`. For local image OCR, also set `GOOGLE_CLOUD_VISION_API_KEY`. The key belongs only in the backend environment; do not put it in a `VITE_*` variable or commit it.

3. Start the backend. On its first start it applies `backend/migrations/init.sql`:

   ```powershell
   npm start
   ```

   Confirm `http://localhost:5000/api/health` reports `"database":"connected"`.

4. In a second PowerShell terminal, install and start the frontend:

   ```powershell
   cd frontend
   npm ci
   Copy-Item .env.example .env
   npm run dev
   ```

5. Open `http://localhost:5173`. Vite proxies `/api/*` to the local Express server. Without the Vision API key, manually entered OCR text can still be parsed, but image OCR will report that the service is not configured.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend / Render | PostgreSQL connection string. Required to start the backend. |
| `PORT` | Backend / Render | HTTP port; Render provides this automatically. Defaults to `5000` locally. |
| `FRONTEND_URL` | Backend / Render | Allowed production frontend origin for CORS. |
| `GOOGLE_CLOUD_VISION_API_KEY` | Backend / Render | Private Vision API key used for image OCR. |
| `VITE_API_URL` | Frontend / local only | Optional API origin for local development. Vite's proxy works by default. |
| `AI_API_KEY` | Backend | Reserved for a future external cataloguing provider; the current Suggest endpoint uses local heuristics and does not call an AI provider. |

The `.env.example` files contain templates only. Never commit `.env` files, database URLs, or provider keys.

## OCR data handling and cost

The Add Book page accepts PNG, JPEG, and WebP images up to 7 MB. The image is sent to the Express backend and forwarded to Google's Cloud Vision `DOCUMENT_TEXT_DETECTION` endpoint. SmartLibrary does not write the uploaded image to disk or store it in its database; Google processes the image under its Cloud Vision terms and may charge for usage. Image OCR is rate-limited to 10 requests per client IP per 15 minutes. Only enable the Vision API and configure its key if you accept these terms and costs.

Cloud Vision returns recognized text, not a guaranteed correct catalogue record. The frontend parser extracts fields it can recognize, leaves undetected fields unchanged, and never fills the accession number. Review all extracted values before saving.

## Tests and production build

From the project root:

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

Backend OCR tests mock Google responses and do not use an API key or incur Vision API charges. Frontend tests cover the text-to-metadata parser.

## Deployment

### Backend on Render

Deploy the repository using `render.yaml` (or create a Node web service with `backend` as the root directory). The service needs `DATABASE_URL`, `FRONTEND_URL`, and the private `GOOGLE_CLOUD_VISION_API_KEY` for image OCR. Set the key in Render's Environment settings and restrict it to the Cloud Vision API in Google Cloud. Do not put it in this repository. The service's health-check path is `/api/health`.

### Frontend on Vercel

Import the repository with `frontend` as the root directory. Use `npm run build` and `dist` as the output directory. `frontend/vercel.json` proxies `/api/*` to the Render service and rewrites frontend routes to `index.html`. If Render assigns a different service URL, update the API rewrite before deploying.

## Current MVP limitations

- There is no login or role-based access control. Restrict access appropriately before using the app with sensitive or production library data.
- The Suggest button currently produces deterministic local heuristics, not generated AI cataloguing recommendations.
- OCR quality depends on image quality and print layout; results always require human review.
- Cloud Vision billing/quota configuration is managed in Google Cloud, not in the application.
