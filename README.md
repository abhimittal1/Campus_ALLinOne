# Face Attendance System

A face-recognition attendance system. FastAPI backend (SQLite) + React frontend. Supports fire/smoke detection, an AI chatbot (JIIT Buddy), and camera-based student registration.

---

## Prerequisites

| Tool | Min Version |
|------|-------------|
| Python | 3.11 |
| Node.js | 18 |
| npm | 9 |

No external database server required — SQLite file is created automatically.

---

## Setup

### 1 — Environment file

```powershell
copy .env.example .env
```

Open `.env` and set:
- `SECRET_KEY` — any long random string (`python -c "import secrets; print(secrets.token_hex(32))"`)
- `OPENAI_API_KEY` — your OpenAI key (required for the chatbot only)
- `CAMERA_URL` — your IP Webcam stream URL (e.g. `http://192.168.x.x:8080/video`)

Everything else can stay at defaults for local development.

### 2 — Backend

```powershell
# From the project root
python -m venv .venv
.venv\Scripts\Activate.ps1

pip install -r backend/requirements.txt

# Run from the PROJECT ROOT (not from inside backend/)
uvicorn backend.main:app --reload
```

API: **http://localhost:8000** | Docs: **http://localhost:8000/docs**

### 3 — Frontend

```powershell
# In a separate terminal, from the project root
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Default Login

On first run the backend auto-creates an admin account:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin12345` |

Change these in `.env` (`DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`) before deploying.

---

## Camera Scripts

These are standalone scripts run directly on the machine with camera access.

**Register a student** (captures face embedding from IP cam):
```powershell
pip install -r requirements.txt   # root-level requirements, one-time
python register_student.py
```
Press `SPACE` to capture a sample, `Q` to abort.

**Fire/smoke detection** (standalone, uses YOLO weights):
```powershell
python fire_alert_camera.py --source 0            # webcam
python fire_alert_camera.py --source http://...   # IP cam URL
```

> **YOLO weights:** Place your trained model at `best weights of training YOLO v8/best (1).pt`. The file is excluded from git — provide your own.

---

## Chatbot (JIIT Buddy) — Rebuild Vector Store

Only needed if you want to re-crawl or reset the knowledge base:

```powershell
python data/scraper/jiit_crawler.py --max-pages 300 --output data/scraped/jiit_pages.json
python data/scraper/ingest.py --input data/scraped/jiit_pages.json --reset
```

Use `RAG_EMBED_MODEL` in `.env` if you want to swap to another local embedding model.

---

## Student Photos

Student profile photos are stored in `backend/uploads/students/`.

- **Via the web UI:** In the Students page, click **+ Add Student** and optionally attach a photo. After a student exists, admins can click **Upload Photo** on any row to update their picture.
- Photos are served at `/uploads/students/<filename>` by the backend and are proxied automatically in the Vite dev server.

---

## Camera Scripts (standalone)

These scripts run on a device with access to the IP camera (e.g. a Raspberry Pi or a laptop on the same network). They do **not** require the web backend to be running.

### Register a student's face

```powershell
# From the project root, with the venv active
python register_student.py
```

Edit the `IP_CAM_URL` variable at the top of `register_student.py` to match your camera's stream URL.

The script captures 5 face frames, computes a FaceNet embedding, and saves it to the `students` table in the SQLite database (if `DATABASE_URL` is set to the same file).

---

## Project Structure

```
connecting_phone/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── database.py          # SQLAlchemy engine & session (SQLite)
│   ├── requirements.txt     # Python dependencies
│   ├── uploads/
│   │   └── students/        # Uploaded student photos
│   ├── core/
│   │   ├── config.py        # Settings (reads backend/.env)
│   │   ├── deps.py          # FastAPI dependencies (DB session, auth)
│   │   └── security.py      # JWT + password hashing
│   ├── models/              # SQLAlchemy ORM models
│   ├── routers/             # API route handlers
│   └── schemas/             # Pydantic request/response schemas
├── frontend/
│   ├── src/
│   │   ├── pages/           # React page components
│   │   ├── api/             # Axios API helpers
│   │   ├── components/      # Reusable UI components
│   │   └── context/         # Auth context
│   └── vite.config.js       # Dev server + proxy config
├── register_student.py      # Camera-side face enrollment script
├── requirements.txt         # Python deps for the camera scripts
└── .env.example             # Template for backend/.env
```

---

## Environment Variables

All variables are read from `backend/.env`. See `.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./attendance.db` | SQLAlchemy connection string |
| `SECRET_KEY` | *(must be set)* | JWT signing secret |
| `ALGORITHM` | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Token lifetime |
| `CAMERA_URL` | `http://10.72.193.71:8080/video` | Default IP camera stream |
| `BACKEND_CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |

---

## Troubleshooting

**`ModuleNotFoundError: No module named 'backend'`**  
Run `uvicorn` from the project root, not from inside `backend/`.

**`SECRET_KEY` validation error on startup**  
Create `backend/.env` from `.env.example` and set a `SECRET_KEY`.

**Photos not loading in the browser**  
The Vite dev proxy forwards `/uploads/*` to the FastAPI server. Make sure the backend is running on port 8000.
