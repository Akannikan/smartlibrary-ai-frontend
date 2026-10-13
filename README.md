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
- `frontend/vercel.json` proxies `/api/*` requests to the Render service and rewrites frontend routes to `index.html`. No production `VITE_API_URL` is required.

## Deploy to Render

- Create a Web Service from the same GitHub repository, or use the included `render.yaml` Blueprint.
- Set the root directory to `backend`.
- The Blueprint uses Render's free plan; the service may sleep after inactivity and take a short time to wake.
- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` to the Neon connection string in Render's private environment settings. The Blueprint configures `FRONTEND_URL` for the Vercel production origin. Add `AI_API_KEY` only if using an external AI suggestions provider; image OCR is local and needs no key.
- The Render health check uses `/api/health`. The service fails startup if `DATABASE_URL` is missing or the migration cannot be applied.

## CORS and API configuration

In local development, Vite proxies `/api/*` to `http://localhost:5000`. In production, Vercel proxies those requests to `https://smartlibrary-ai-frontend-1.onrender.com`.

## Publish and connect the services

1. Create a GitHub repository, then from the project root push the files to it. Do not add `.env` files; only the `.env.example` templates belong in Git.
2. Deploy the backend from the Render Blueprint or create a Web Service with `backend` as its root directory. Set `DATABASE_URL` privately in Render and confirm `https://smartlibrary-ai-frontend-1.onrender.com/api/health` returns `"database": "connected"`.
3. Import the same repository into Vercel with `frontend` as its root directory and deploy. The API rewrite is already configured for the Render service URL.
4. If Render assigned a different service URL, update the `/api/:path*` destination in `frontend/vercel.json` to that URL and redeploy the frontend.
5. Open the Vercel site and test creating a book with a manually entered accession number. Confirm it appears in the catalogue and accession register. Never use or expose a generated number as the accession number.

The project folder needs to be a Git repository before using Git push. If `git status` says it is not a Git repository, initialize it with `git init` before adding the GitHub remote.

## AI / OCR providers

Image OCR uses Tesseract.js locally in the browser with the English language model copied into the frontend's static assets during dev/build; uploaded images are not sent to an OCR provider. No OCR API key or separate Tesseract installation is required, and the model is served by the site rather than a third-party CDN.

`AI_API_KEY` is optional and only controls AI cataloguing suggestions. Without it, the app uses its built-in local suggestions.

## Troubleshooting

- If the frontend cannot reach the backend, confirm `VITE_API_URL`.
- If the backend cannot connect to PostgreSQL, verify `DATABASE_URL` and Neon connectivity.
- If the health endpoint fails, ensure the backend is started and the `PORT` entry matches the frontend environment.
