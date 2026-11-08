# Keepsake backend

The REST API for accounts, albums and photographs: Spring Boot 3, Java 17, Maven and PostgreSQL. It's written to run on Render, with its database and images on Supabase.

The frontend uses it when `NEXT_PUBLIC_API_URL` is set: people sign in, and their albums are kept here. See `frontend/src/lib/storage/remoteStore.js`.

## Test it

You only need Java 17 or newer. Maven downloads itself through the wrapper, and the tests start their own throwaway PostgreSQL, so they need no database, password or Docker.

```bash
./mvnw test        # Windows: mvnw.cmd test
```

## Run it on your computer

The quickest way needs nothing installed but Java. It starts its own PostgreSQL alongside, and keeps the data in `./data`, so albums survive a restart:

```bash
mvnw.cmd spring-boot:test-run
```

The API is then on http://localhost:8081. Point the frontend at it with `NEXT_PUBLIC_API_URL=http://localhost:8081` in `frontend/.env.local`. Stop it with Ctrl+C, and delete `./data` to start again from nothing.

Password reset emails aren't sent from your computer. Each one is written as a text file in `./data/outbox`, with the reset link in it.

To use your own PostgreSQL instead:

1. Create a database in your local PostgreSQL:

   ```sql
   CREATE DATABASE keepsake;
   ```

2. Set the required values, in PowerShell:

   ```powershell
   $env:DATABASE_PASSWORD = "your postgres password"
   $env:JWT_SECRET = "any random text of at least 32 characters"
   ```

3. Start it:

   ```bash
   mvnw.cmd spring-boot:run
   ```

It starts on http://localhost:8080. Tables are created automatically on first start, in a schema called `keepsake`. Photographs are saved in `./data/photos`.

## Deploy

1. **Supabase:**
   - Create a project.
   - Under Storage, create a private bucket called `photos`.
   - Note the session pooler connection string and the service key.
2. **Render:**
   - Connect the Git repository as a Blueprint, which reads `render.yaml`.
   - Fill in the values it asks for. They're described in [.env.example](.env.example).
3. **Vercel:**
   - Import the repository, with `frontend` as the root directory.
   - Under Environment Variables, set `NEXT_PUBLIC_API_URL` to your Render address, such as `https://keepsake-backend.onrender.com`, with no slash at the end. Redeploy after changing it, since it's built into the site.
4. **Back on Render:** set `CORS_ALLOWED_ORIGINS` to your Vercel address, such as `https://keepsake.vercel.app`. Add any custom domain too, separated by commas.
5. **Password reset emails (Brevo, free):**
   - Create a Brevo account. Under **Senders, Domains & Dedicated IPs → Senders**, add and verify the address emails should come from.
   - Under **SMTP & API → API keys**, create an API key.
   - On Render, set `MAIL_TYPE=brevo`, `MAIL_FROM` to the verified address, `BREVO_API_KEY` to the key, and `APP_URL` to your Vercel address.

   Until this is done, `MAIL_TYPE` is `none`: the Forgot Password screen still answers, but no email is sent, and the log says so.

Render's free plan sleeps after 15 minutes without visitors, and the first request then takes up to a minute. The sign-in screen says so while it waits.

Keep `STORAGE_TYPE=supabase` on Render. Its free disk is wiped on every restart, which would lose every photograph.

## API

Everything except registering, signing in, the three password-reset requests and the health check needs an `Authorization: Bearer <token>` header. Dates are milliseconds since 1970, as in the frontend. Errors are always `{ "code", "message" }`.

| Method and path | Purpose | Matches in `albumStore.js` |
| --- | --- | --- |
| `POST /api/auth/register` | Create an account: `email`, `password`, optional `displayName` | |
| `POST /api/auth/login` | Sign in: `email`, `password` | |
| `GET /api/auth/me` | The signed-in account | |
| `POST /api/auth/password-reset` | Ask for a reset link: `email`. Always `202` with the same message | `requestPasswordReset` |
| `POST /api/auth/password-reset/check` | Whether a link still works: `token`. Gives `expiresAt` | `checkPasswordReset` |
| `POST /api/auth/password-reset/confirm` | Set the new password: `token`, `password`, `confirmPassword` | `confirmPasswordReset` |
| `GET /api/albums` | All your albums, with photo counts. Optional `?category=INDIVIDUAL` or `COUPLE` | `listAlbums` |
| `POST /api/albums` | New album: `title`, `description`, `theme`, `category` (`INDIVIDUAL` if left out) | `createAlbum` |
| `GET /api/albums/{id}` | One album with its ordered photographs | `getAlbum` |
| `PATCH /api/albums/{id}` | Change `title`, `description`, `theme` or `category` | `saveAlbum` |
| `DELETE /api/albums/{id}` | Delete an album and its photographs | `deleteAlbum` |
| `POST /api/albums/{id}/copies` | Duplicate an album | `duplicateAlbum` |
| `POST /api/albums/{id}/photos` | Upload, as multipart: `file`, `name`, `width`, `height`, optional `takenAt`, `takenAtSource` | `addPhoto` |
| `DELETE /api/albums/{id}/photos` | Empty an album | `clearAlbum` |
| `PUT /api/albums/{id}/photo-order` | Reorder: `ids` | `reorderPhotos` |
| `GET /api/photos/{id}/content` | The image itself | `getPhotoBlob` |
| `PATCH /api/photos/{id}` | Set the `caption` | `updatePhotoCaption` |
| `DELETE /api/photos/{id}` | Remove a photograph | `deletePhoto` |
| `GET /actuator/health` | Health check for Render | |

## Design notes

- **Separate schema.** Tables are in `keepsake`, not `public`, because Supabase publishes `public` through its web API.
- **Someone else's data looks missing.** Every query includes the owner, and the answer is the same 404 as for something that doesn't exist.
- **Images and details can't be saved together.** So an image is stored before its database row and removed if that fails. A failed clean-up can leave an unused file, but a photograph can never point at a missing image.
- **Deleting hides; it doesn't erase.** The three `DELETE` requests set `deleted_at` on the album or photographs (migration `V2`). From then on every request treats them as missing, but the rows and stored images stay. Deleted photographs don't count towards the storage limit. Nothing removes them later, so tell users in your privacy policy, and erase them yourself (rows in `keepsake.albums` and `keepsake.photos` with `deleted_at` set, and those photographs' images in storage) when someone asks for their data to be deleted.
- **Storage limit.** Each account gets 200 MB by default, so that one account can't fill a small free storage plan.
- **Login attempts.** Limits are held in memory, which suits one server. Running several would need them moved somewhere shared.
- **Forgotten passwords** (migration `V3`).
  - **One answer.** Asking for a link always gets the same `202` and message, whether or not the email has an account. The email is sent in the background, so the time taken doesn't give it away either.
  - **The code.** Each link carries 32 random bytes. The table `password_reset_tokens` keeps only their SHA-256 hash, the account, and when the link was made, expires (30 minutes by default) and was used.
  - **One use.** Using a link marks it used. Asking again retires every earlier link, so only the newest works.
  - **Kept out of logs.** The code is in the part of the link after `#`, which browsers never send to a server. The page then removes it from the address bar. The API takes it in a request body, never in a URL, and nothing logs it.
  - **Limits.** Three emails per address per 30 minutes; beyond that the request is quietly ignored. Ten requests per network address per 15 minutes, then `429`. Twenty wrong codes per network address per 15 minutes, then `429`.
  - **A stronger password.** At least 8 characters, mixing letters with numbers, spaces or symbols, and not a well-known one. Signing up still only asks for 8 characters.
  - **Signed out everywhere.** Each account has a `session_version`, and every sign-in token carries it as the `sv` claim. A reset raises it, so every earlier token stops working. Tokens from before this change carry none, which counts as 0, so nobody was signed out by the upgrade. The version is remembered for a minute per server, and a reset clears it at once.
  - **Sending.** Mail goes through Brevo's HTTPS API, because Render's free plan blocks outgoing SMTP ports. The sender is chosen with `MAIL_TYPE`: `brevo`, `none` or `outbox`. `outbox` writes each email to a folder; the local backend uses it, writing to `data/outbox`.
- **Individual and Couple** (migration `V4`).
  - **Shelf, not kind.** Each album has a `category` column, `INDIVIDUAL` or `COUPLE`, with a database check that it's one of the two. Both are the same album, with the same endpoints.
  - **Existing albums.** The migration adds the column with the default `INDIVIDUAL`, so every existing album became Individual without its row being rewritten.
  - **Moving.** Changing only `category` leaves `updatedAt` alone, so moving an album doesn't count as editing it. Everything else stays as it was: the id, photographs, captions, order and cover.
  - **Copies.** A duplicate keeps its original's category.
- **A starter album.** Registering creates the account and an empty *Our Memories* album (Individual, default cover) in one transaction, so the library opens on a book. It's an ordinary album: deleting it doesn't bring it back. Turn it off with `STARTER_ALBUM=false`. Existing accounts aren't given one.
