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

Render's free plan sleeps after 15 minutes without visitors, and the first request then takes up to a minute. The sign-in screen says so while it waits.

Keep `STORAGE_TYPE=supabase` on Render. Its free disk is wiped on every restart, which would lose every photograph.

## API

Everything except registering, signing in and the health check needs an `Authorization: Bearer <token>` header. Dates are milliseconds since 1970, as in the frontend. Errors are always `{ "code", "message" }`.

| Method and path | Purpose | Matches in `albumStore.js` |
| --- | --- | --- |
| `POST /api/auth/register` | Create an account: `email`, `password`, optional `displayName` | |
| `POST /api/auth/login` | Sign in: `email`, `password` | |
| `GET /api/auth/me` | The signed-in account | |
| `GET /api/albums` | All your albums, with photo counts | `listAlbums` |
| `POST /api/albums` | New album: `title`, `description`, `theme` | `createAlbum` |
| `GET /api/albums/{id}` | One album with its ordered photographs | `getAlbum` |
| `PATCH /api/albums/{id}` | Change `title`, `description` or `theme` | `saveAlbum` |
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
