# Keepsake

A digital photo album that behaves like a physical one. Photographs are printed onto paper pages inside a leather-bound 3D book, and you turn the pages by hand with a mouse or finger.

**Live site:** https://keepsake4u.vercel.app. People create an account, and their albums open on any phone or computer.

## How it fits together

```
Phone or computer
   |
   v
Website            Vercel     https://keepsake4u.vercel.app        (frontend/, Next.js)
   |  REST requests, signed in with a token
   v
API                Render     https://keepsake-backend-b2yj.onrender.com   (backend/, Spring Boot)
   |                          region: Singapore
   +--> Database   Supabase   PostgreSQL, schema "keepsake"        (accounts, albums, photo details)
   +--> Photos     Supabase   Storage bucket "photos", private      (the image files)
```

All four parts run on free plans. GitHub (`AbhisekPanda7/keepsake`) holds the code; Vercel and Render rebuild automatically when `main` changes.
## Repository layout

| Folder | Purpose |
| --- | --- |
| `frontend/` | The Next.js website, deployed on Vercel. |
| `backend/` | The Spring Boot API for accounts, albums and photographs, deployed on Render with its database and images on Supabase. See [backend/README.md](backend/README.md). |
| `docs/` | Project documentation. |

The frontend and backend are independent applications, each with its own dependencies and tooling.

## Running the frontend

Requires Node.js 20.9 or newer.

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Creates a production build |
| `npm start` | Serves the production build |
| `npm test` | Runs the unit tests for the page model, page-turn logic, reordering and EXIF reading |
| `npm run test:e2e` | Runs the app in Chrome with real input, on a throwaway profile. Needs `npm run dev` running in another terminal, without `NEXT_PUBLIC_API_URL` |
| `npm run test:e2e:account` | Checks signing in and albums kept on the server. Needs the local backend and an account build on port 3001; see the top of `scripts/e2e-account.mjs` |

### Where albums are kept

With `NEXT_PUBLIC_API_URL` set (see [.env.example](frontend/.env.example)), people sign in and their albums are kept in their account on the server, so they can open them on any device. Without it, there are no accounts and albums stay in the browser, in IndexedDB.

## Using the album

The site opens on your library, where every album lies on the table as a book. A new account starts with one empty album, *Our Memories*, in Individual.

| In the library | How |
| --- | --- |
| Make an album | **New album**: choose its collection, a title, a few words, cover colour, cover material and paper |
| Switch between collections | **Individual** and **Couple** in the top right corner. New albums are Individual unless you choose Couple |
| Open an album | Click or tap its book |
| Turn a book over | Drag it in any direction. It stays where you leave it, until you click **Set it down** or open it |
| Move an album to the other collection | The **⋯** button, then **Move to Couple** or **Move to Individual**. Nothing else about it changes |
| Rename, customise, duplicate or delete | The **⋯** button beside the album's title |
| Forgotten your password | **Forgot Password?** on the sign-in screen. The email has a link that works once, for 30 minutes |

| In an album | How |
| --- | --- |
| Return to the library | **Library** at the top left, or the browser's back button |
| Open the book | Click the cover or **Open album** |
| Turn a page | Drag a page corner, click a page edge, or press the `←` `→` keys. On a portrait phone, swipe |
| See a photograph larger | Click or tap it |
| Add photographs | **Add photographs**, or drop files anywhere on the page |
| Rearrange photographs | **Arrange**, then drag. On a touch screen, press and hold first |
| Add or edit a caption | **Add caption** in the page margin, or in the enlarged view. It saves as you leave the field |
| Change the title or look | **Details** |
| Remove a photograph | **Remove** in the page margin, or from the enlarged view on a phone |
| Close the book | **Close**, or turn back past the first page |

Portrait phones show one page at a time, and every other screen shows a two-page spread. Rotating a phone keeps your place.

Captions use the capture date from a photograph's EXIF data where it has one, and otherwise the file's modified date. The enlarged view says which of the two it is.

Without a server, photographs and albums are stored only in your browser, using IndexedDB, and clearing site data for this site deletes them. With one, they're in your account, and **Sign out** is at the top right.

Deleting an album or removing a photograph always asks first. On the server, deleted albums and photographs are hidden rather than erased; see the backend's design notes.

## Deployment

### What is set where

| Service | Setting | Value |
| --- | --- | --- |
| Vercel | Root Directory | `frontend` |
| Vercel | `NEXT_PUBLIC_API_URL` | `https://keepsake-backend-b2yj.onrender.com` |
| Render | Blueprint | reads `render.yaml`: Docker, Free, Singapore, health check `/actuator/health` |
| Render | `DATABASE_URL` | `jdbc:postgresql://aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require` (the session pooler) |
| Render | `DATABASE_USERNAME` | `postgres.<project ref>` |
| Render | `DATABASE_PASSWORD` | the Supabase database password (secret) |
| Render | `SUPABASE_URL` | `https://<project ref>.supabase.co` |
| Render | `SUPABASE_SERVICE_KEY` | the Supabase service key (secret, never in the website) |
| Render | `CORS_ALLOWED_ORIGINS` | `https://keepsake4u.vercel.app` |
| Render | `JWT_SECRET`, `STORAGE_TYPE`, `SUPABASE_BUCKET` | set by `render.yaml` |
| Render | `APP_URL` | `https://keepsake4u.vercel.app`, which reset links open (**not set yet**) |
| Render | `MAIL_TYPE`, `MAIL_FROM`, `BREVO_API_KEY` | `brevo`, the verified sender address, and the Brevo API key (secret) (**not set yet**) |
| Supabase | Storage bucket | `photos`, private |

Secrets live only in Render's settings. They are never committed.

### Changing things later

- **A new website address** (another Vercel domain, or your own): add it to `CORS_ALLOWED_ORIGINS` on Render, comma-separated with no spaces or trailing slash. Without it, sign-in fails from that address.
- **A new backend address:** change `NEXT_PUBLIC_API_URL` on Vercel and redeploy, since it's built into the site.
- **Code changes:** push to `main`. Vercel and Render both redeploy by themselves.

### Free plan behaviour

- **Render** sleeps after 15 minutes without visitors. The next visit waits about a minute while it wakes; the sign-in screen says so. It has 750 free hours a month, enough for one service all month.
- **Supabase** may pause a free project after a week with no activity. Open the dashboard and click **Restore**; nothing is lost.
- **Vercel Hobby** is for personal, non-commercial use.

### Still to do

**Password reset emails.** The feature is built but not deployed, and no email service is set up yet. Until `MAIL_TYPE` is set on Render, **Forgot Password?** answers as usual but sends nothing. To turn it on, follow step 5 under Deploy in the [backend README](backend/README.md), then set `APP_URL` on Render. Sending through Brevo has only been tested against a stand-in server, so send yourself a reset email once it's live.

Supabase retires its legacy API keys in early 2027. The backend now accepts the new **Secret key** (`sb_secret_...`) as well as the legacy `service_role` key; that change still needs pushing. After it's deployed, replace `SUPABASE_SERVICE_KEY` on Render with the Secret key from Supabase, under **Project Settings → API Keys → Secret keys**.

## Checking the data

- **Accounts, albums and photo details:** Supabase → **Table Editor** → change the schema from `public` to **`keepsake`**. The tables are `users`, `albums`, `photos` and `password_reset_tokens`. Passwords and reset codes are stored only as hashes. Each album's `category` is `INDIVIDUAL` or `COUPLE`.
- **The images:** Supabase → **Storage** → `photos`. Folders go *user id → album id → photo id*.
- **Deleted items:** rows with a time in `deleted_at` were deleted in the app. They are hidden from the person but kept, with their images. If someone asks for their data to be erased, delete their rows and their folder in Storage.
- **Errors and requests:** Render → keepsake-backend → **Logs**.

As the owner you can see everyone's photos. Look only when you need to.

## What has been built

- **The album:** a 3D book on a lamp-lit desk, with pages that bend and turn by hand, a library of albums, an opening scene, captions, rearranging, cover and paper choices, and quality settings that adapt to the device.
- **Uploads from phones and laptops:** photos up to 2400 pixels on the long side, iPhone HEIC photos converted automatically, and capture dates read from the camera's EXIF data, never guessed.
- **Accounts:** sign up, sign in and sign out. Albums are kept on the server, so the same albums open on every device.
- **Safe deleting:** removing a photo, clearing an album and deleting an album all ask *Are you sure?* first. On the server they are hidden, not erased.
- **Recovering the 3D view:** if the graphics card drops the page's 3D context, the scene rebuilds itself.
- **Forgotten passwords:** a reset link by email. It works once and lasts 30 minutes, the database keeps only a hash of it, and using it signs you out everywhere. The answer is the same whether or not the email has an account.
- **A presentation-album interior:** a gilt-tooled leather lining inside each cover with a camera crest on the front, a title page with a gilt border, blossoms, a heart divider and a "Since" plaque dated from the earliest photograph, gilt borders on every page, and a visible ribbon bookmark. The gilding follows the cover's metal, so silver-tooled covers have silver pages.
- **The desk:** a brass candelabra with five lit candles beside the open book, and the pocket watch laid face up.
- **Individual and Couple collections:** the library is split into two shelves of the same kind of album. New albums are Individual unless you choose otherwise, existing albums became Individual, and an album can be moved without changing anything else about it.
- **Deployment:** GitHub, Supabase, Render and Vercel, all on free plans.

## Testing

| What | Command | Covers |
| --- | --- | --- |
| Backend | `cd backend`, then `mvnw.cmd test` | 87 tests against a real, throwaway PostgreSQL: accounts, password reset, albums, collections, photos, deleting, upgrading old data, storage keys, email, security |
| Frontend logic | `cd frontend`, then `npm test` | 76 unit tests |
| The album in Chrome | `npm run test:e2e` | 261 checks with real mouse and touch input, on desktop and phone sizes, including the two collections |
| Accounts in Chrome | `npm run test:e2e:account` | 80 checks against a local backend: sign-up, the starter album, uploads, reload, captions, order, deleting, collections, forgotten password, sign-out, phone size |

To run the backend on your computer without installing a database: `cd backend`, then `mvnw.cmd spring-boot:test-run`. It starts on http://localhost:8081. Reset emails aren't sent from there: each is written to `backend/data/outbox`, link included.

## Documentation

- [Architecture](docs/architecture.md): how the code is organised, how the page bending works, and how the frontend talks to the backend.
- [Backend](backend/README.md): the API, running it locally, deploying, and design notes.