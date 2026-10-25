# Sultan Yakhni Pulao Feedback

Customer feedback form (English and Urdu) and an admin portal for Sultan Yakhni Pulao.
Every response is saved in PostgreSQL. Managers sign in to see ratings by branch, follow
up on complaints, and export everything to Excel.

| Page | URL |
|---|---|
| Customer form (share this, or print it as a QR code) | `https://your-domain/` |
| Admin portal | `https://your-domain/admin` |

## The form

1. **Visit:** branch and order type (dine-in, takeaway or delivery). Tapping the order
   type moves straight to the next page.
2. **Review:** six required questions for that order type, then the customer's name
   (required) and mobile number (optional, checked if given).
3. **Optional:** more about the food, the visit or delivery, and the customer. **Send now**
   on step 2 skips this page. Customers who want offers must give a mobile number.

After sending, the customer sees a reference code (like `SYP-261025-HQG5V`) they can
quote if they call.

### Branch links for QR codes

Add `#<branch id>` to the form link to preselect a branch:

| Branch | Link ending |
|---|---|
| SYP Paka Garah, Kashmir Rd. | `#paka-garah` |
| SYP Kashmir Park | `#kashmir-park` |
| SYP Daska | `#daska` |
| SYP Akbarabad | `#akbarabad` |
| Sultan Johar Town | `#johar-town` |

### Changing questions, options or branches

Edit `app/static/questions.json` and redeploy. The form draws its questions from that
file and the server checks every submission against it, so the two never disagree.

- Rename any label freely. Never reuse an option's `value` for a different meaning:
  old responses keep the stored value.
- A new branch needs an `id` (lowercase letters, digits and dashes) and a `name`.
- What counts as **needs attention** (food rated 1–2 stars, very late delivery, missing
  items, rude rider and so on) is listed in `ATTENTION_RULES` in `app/catalogue.py`.

## Admin portal

- **Overview:** responses, average food rating, how many would come back, and open
  complaints; charts for food ratings and order types; a table comparing branches;
  averages for every star question; and the answers to any single question.
- **Responses:** search by reference, name, phone or comment; filter by status,
  complaints or offer sign-ups; open a response to see every answer, call or WhatsApp
  the customer, set its status (new, reviewed, actioned, archived) and leave a team note.
- **Export to Excel:** the responses matching the current filters, plus a summary sheet.

The date range, branch and order type at the top apply to every number on the page.

### Admin sign-in

On first start the app creates one admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD`
(default **admin / 1234**). The portal shows a warning until that password is changed.
Use **Change password** straight after your first sign-in: the portal shows customers'
phone numbers.

## Deploy on Vercel

1. On [vercel.com](https://vercel.com): **Add New → Project**, import
   `Sultan_Yakhni_Pulao_Feedback` from GitHub. Leave the framework as detected (FastAPI).
   Under **Environment Variables** add `ADMIN_PASSWORD` (the first admin password) and
   `APP_TIMEZONE` = `Asia/Karachi`, then **Deploy**. Until a database is connected, every
   page says the app is not set up yet.
2. In the project: **Storage → Create Database → Neon (Postgres)**, region **Singapore**
   (the app runs in Vercel's Singapore region, see `vercel.json`), and connect it to the
   project. This adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. **Deployments → ⋯ → Redeploy**. Tables and the first admin are created on the first
   request. `SECRET_KEY` is optional (see `.env.example`).

Every push to `main` redeploys automatically.

## Run on your computer

Needs Python 3.11+ and a PostgreSQL 13+ database.

```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn app.main:app --env-file .env --port 8010
```

Edit `.env` first: set `DATABASE_URL` and `COOKIE_SECURE=false` for local http. Then open
http://localhost:8010 (form) and http://localhost:8010/admin (portal).

On Windows with Python 3.14, the compiled part of the database driver (psycopg-binary
3.3.6) crashed the server in testing as soon as a request used the database. Setting
`PSYCOPG_IMPL=python` and putting a folder containing `libpq.dll` on `PATH` avoids it.
This does not affect Vercel, which runs Linux.

## Tests

```bash
set TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/sultan_test
.venv\Scripts\pip install pytest httpx
.venv\Scripts\python -m pytest
```

The test database is wiped at the start of every run. Never point it at real data.

## Security

- Passwords hashed with bcrypt; an address is locked out for 15 minutes after 5 failed
  sign-ins.
- Session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`; admin changes from other
  sites are refused.
- All SQL is parameterised. Submissions are checked against `questions.json` and by
  database constraints.
- Typed text is written to Excel as text, so a response cannot plant a formula.
- Strict Content-Security-Policy on every page. Customer IP addresses are stored only as
  a keyed hash. Submissions are limited to 30 per address per 10 minutes (a branch's
  guest Wi-Fi puts many customers behind one address), with a hidden spam-trap field.
