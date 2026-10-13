# smartLibrary Ai

smartLibrary Ai is an MVP for AI-assisted library cataloguing, review, and accession tracking. It includes a React + Vite frontend and an Express + PostgreSQL backend for cataloguing records, OCR workflow, AI suggestions, and accession register management.

## Tech stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, Express, PostgreSQL (Neon), pg
- Data export: XLSX

## Folder structure

```text
smartLibrary-Ai/
├── backend/
│   ├── migrations/
│   ├── .env.example
│   ├── db.js
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.js
│   └── vercel.json
├── .gitignore
├── README.md
└── render.yaml
```

## Prerequisites

- Node.js 18+
- npm
- A Neon PostgreSQL connection string

## Frontend install

```bash
cd frontend
npm install
cp .env.example .env
```

Update `VITE_API_URL` to point to the backend, for example:

```env
VITE_API_URL=http://localhost:5000
```

## Backend install

```bash
cd backend
npm install
cp .env.example .env
```

Set the backend environment values before starting the API:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>
FRONTEND_URL=http://localhost:5173
AI_API_KEY=
OCR_API_KEY=
```

## Create and migrate the Neon database

1. Create a Neon project and copy the connection string.
2. Set `DATABASE_URL` in `backend/.env`.
3. Run the app once to trigger the migration SQL in `backend/migrations/init.sql`.

```bash
cd backend
npm start
```

## Run locally

Frontend:

```bash
cd frontend
npm run dev
```

Backend:

```bash
cd backend
npm start
```

## GitHub workflow

```bash
git init
git add .
git commit -m "Initial smartLibrary Ai MVP"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Deploy to Vercel

- Import the GitHub repository in Vercel.
- Set the root directory to `frontend`.
- Build command: `npm run build`
- Output directory: `dist`
- Add `VITE_API_URL` as an environment variable for Production (and Preview if needed), with the Render backend base URL, for example `https://smartlibrary-ai-api.onrender.com` (no trailing slash).
- The `frontend/vercel.json` rewrite supports React Router page refreshes and direct links.

## Deploy to Render

- Create a Web Service from the same GitHub repository, or use the included `render.yaml` Blueprint.
- Set the root directory to `backend`.
- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` to the Neon connection string, `FRONTEND_URL` to the exact Vercel production origin (for example `https://smartlibrary-ai.vercel.app`), and optional `FRONTEND_URLS` to comma-separated Vercel preview origins when needed. Add AI/OCR keys only when using those providers.
- The Render health check uses `/api/health`. The service fails startup if `DATABASE_URL` is missing or the migration cannot be applied.

## CORS and API configuration

The backend accepts requests from `http://localhost:5173`, `FRONTEND_URL`, and any comma-separated origins in `FRONTEND_URLS`. Set the frontend's `VITE_API_URL` to the Render service base URL. Since Vite embeds this variable at build time, redeploy the frontend after changing it.

## Publish and connect the services

1. Create a GitHub repository, then from the project root push the files to it. Do not add `.env` files; only the `.env.example` templates belong in Git.
2. Import that repository into Render and configure the backend environment values above. Wait for the deployment and confirm `https://<render-service>.onrender.com/api/health` returns `"database": "connected"`.
3. Import the same repository into Vercel with `frontend` as its root directory. Configure `VITE_API_URL` with the exact Render service base URL and deploy.
4. Copy the Vercel production domain into Render's `FRONTEND_URL`, save, and redeploy the backend if the environment was added after its first deployment.
5. Open the Vercel site and test creating a book with a manually entered accession number. Confirm it appears in the catalogue and accession register. Never use or expose a generated number as the accession number.

The project folder needs to be a Git repository before using Git push. If `git status` says it is not a Git repository, initialize it with `git init` before adding the GitHub remote.

## AI / OCR providers

Image OCR uses Tesseract.js locally in the browser with the bundled English language model; uploaded images are not sent to an OCR provider. No OCR API key or separate Tesseract installation is required. OCR model and worker assets are served with the frontend, so the first model load does not require a third-party CDN.

`AI_API_KEY` is optional and only controls AI cataloguing suggestions. Without it, the app uses its built-in local suggestions.

## Troubleshooting

- If the frontend cannot reach the backend, confirm `VITE_API_URL`.
- If the backend cannot connect to PostgreSQL, verify `DATABASE_URL` and Neon connectivity.
- If the health endpoint fails, ensure the backend is started and the `PORT` entry matches the frontend environment.
