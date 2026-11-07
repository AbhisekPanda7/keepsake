# Architecture

This document explains how the frontend is built and how it connects to the backend. It is for developers working on the code.

## Structure

```
frontend/src/
  app/                 Routes: / (library) and /albums/[id] (one album), fonts, styles
  components/
    AlbumView.jsx      One album's screen: wires data, controller, UI and scene
    Library/           AlbumLibrary, AlbumCard, BookCover (a book in CSS 3D)
    Album/             3D scene: AlbumScene, Room, CinemaPost, Effects, Book, Page, PageStack,
                       Cover, Spine, Ribbon
    Controls/          Toolbar, UploadButton, ConfirmationDialog, PhotoViewer,
                       PhotoArranger, AlbumEditor
    UI/                Header, ViewSettings, Notice, EmptyState, LoadingState, FlatAlbum
  hooks/
    useLibrary.js      The collection of albums for React
    useAlbum.js        One album's data and upload flow for React
    usePageTurn.js     Pointer events on the canvas, translated into book actions
    useViewMode.js     Chooses one-page or two-page binding from the screen
  lib/
    album/
      themes.js        Cover colours, materials and papers (pure data)
      pageModel.js     Which photograph is on which page (pure logic)
      reorder.js       Moving photographs within the order (pure logic)
      photoInfo.js     Wording for dates, captions and labels (pure logic)
      bookModel.js     Book dimensions and hinge positions (pure logic)
      leafDeform.js    Page-bending math (pure logic)
      turnController.js  All animation state (pure logic)
      surfaces.js      Draws paper, covers and wood on canvases, without Three.js
      proceduralTextures.js  Turns those canvases into GPU textures
      pageArtwork.js   Draws one page to a canvas
      pageTextureCache.js  Bounded cache of page textures
    ambient/
      cinema.js        The opening's timing and what the camera attends to (pure logic)
      quality.js       Quality levels and the saved view settings
      pointerField.js  The mouse or phone tilt, smoothed
    navigation/
      arrival.js       Lets a cover open by itself when reached from the library
    storage/
      indexedDB.js     Promise wrapper around IndexedDB, and schema upgrades
      migrations.js    What an upgrade changes (pure logic)
      albumStore.js    The persistence API the UI uses; picks one of the two below
      localStore.js    Albums kept in this browser (IndexedDB)
      remoteStore.js   Albums kept in an account on the server (REST)
      session.js       Who is signed in, and whether accounts are used at all
    images/
      resizeImage.js   Validates, resizes and encodes uploads
      exifDate.js      Reads capture dates from JPEG, PNG and WebP (pure logic)
frontend/scripts/
  e2e.mjs              Browser test suite, driving Chrome over the DevTools Protocol
```

The files marked as pure logic import neither React nor Three.js, which is why `npm test` can run them directly in Node.

## The library and the album

Each screen has a real URL, so refresh, bookmarks and the back button work: `/` is the library and `/albums/[id]` is an album. Going to another album remounts `AlbumView` from scratch, so nothing carries over between albums, and a 3D scene exists only while an album is open.

Books in the library are CSS 3D, not WebGL. A page can hold any number of them, whereas one WebGL scene per book would soon reach the browser's limit on 3D contexts. They use the same `drawCoverColour` as the 3D book, so a book looks the same in both places. `surfaces.js` has no Three.js dependency, which keeps the 3D engine out of the library's first load. The engine is then loaded in the background, ready for when a book is opened.

## Themes

An album stores three ids: `{ colour, material, paper }`. `normalizeTheme` replaces anything unknown with the default, so old or damaged data can't break a page. `resolveTheme` adds the looked-up details that rendering needs.

Changing an album's look gives `Book` a new React key, so the book is rebuilt. That's simpler than repainting every material, and the turn state survives because it lives in `TurnController`, outside the book.

## One page or two

The same printed pages can be bound in two ways, called the mode (`pageModel.js`):

| Mode | Used on | Leaf | What a spread shows |
| --- | --- | --- | --- |
| `spread` | Everything except portrait phones | Printed on both faces | A left and a right page |
| `single` | Portrait screens up to 640px wide | Printed on the front only, with a plain back | One right-hand page, framed by the camera |

Single mode doesn't scale or pan the two-page book. Each page gets its own leaf, so every swipe is a real page turn with the same bending as on desktop. The book sits half a page left of centre, with the spine at the screen's edge, and turned leaves go off-screen to the left.

A few things change to suit a finger on one page:

- The swipe direction picks the sheet, since there is only one side to press.
- A previous page starts off-screen, so it swings across quickly and then stays under the finger.
- A forward turn commits at a shorter drag, since a finger can only pull the edge about halfway through a turn.

`TurnController.setMode` switches binding without an animation and keeps the reader's page, so rotating a phone doesn't lose your place.

## Realism beyond the page shape

`createPaperMaterial` in `Page.jsx` extends standard PBR with two things thin paper needs:

- **Translucency.** Light hitting the far side of a sheet comes through it, warmed, with a ghost of the print on that side. This is strongest when a lifted page tilts away from the lamp.
- **Occlusion.** A turning sheet darkens the page beneath it as they get close, because it shuts out room light, which a shadow map can't represent.

`LAMP_POSITION` in `bookModel.js` must be used for both the light and this shader, so that they agree.

### The room

`components/Album/Room.jsx` holds what surrounds the book. All of it is CC0, from Poly Haven and ambientCG, and listed in `public/scene/CREDITS.md`. Nothing waits on these files: if one is slow or missing, the surroundings are simply plainer, and the album still works.

| Thing | How it works |
| --- | --- |
| Desk and wall | Scanned wood, darkened with a tint so that light has room to work |
| Objects on the desk | glTF models, stood on the desk and sized by `Prop`. Their materials are simplified by `plainMaterial` |
| Oil lamp | A shader flame facing the camera, and a flickering point light, turned almost off over open pages |
| Window light | A spot light projecting window panes, on the High level only, faded out as the book opens |
| Light beam | A soft cone that fades before it reaches the desk, since a cone's cut edge shows as a hard line |
| Reflections | A real room's HDR, seen only in foil, gilt, brass and varnish |

### Lit for mood, then for photographs

A closed book is lit dramatically, with little fill, cool shadows and a raking rim light. As it opens, `Lighting` blends to even, neutral light, because the photographs are now what matters. The tone curve is **Khronos PBR Neutral**, which leaves colours unchanged until they're close to white. The browser suite uploads a plain grey photograph and fails if it comes out tinted, or noticeably lighter or darker.

### The lens

`CinemaPost.jsx` draws the frame: depth of field, then restrained bloom, tone mapping, vignette and a trace of grain. **Depth of field switches off completely while a book lies open**, which guarantees that it can't soften a photograph.

### The opening scene

Coming from the library, the camera arrives, the cover lifts, the pages fan open lit from inside, and the camera rises over the first page. The timings are in `lib/ambient/cinema.js`, about 3.6 seconds in all. The cover moves on the same spring as when opened by hand, only slower. It can be skipped with the button or Escape, turned off under View, and doesn't play at all with reduced motion.

`PageFan` in `Effects.jsx` is what you see behind the cover: solid sheets with their own shader, which exist only during the opening.

### The enlarged photograph

`PhotoViewer` shows the real image, unfiltered, in the DOM. The camera moves in on the page behind it (`cinema.focus`), the room blurs and dims through the dialog's backdrop, and the photograph's own colours spread faintly behind it.

### Quality levels

`lib/ambient/quality.js` starts from what the browser reveals about the device, and `QualityGovernor` steps down if the frame rate stays under 24. A level picked by hand under View is never overridden.

| | High | Balanced | Light |
| --- | --- | --- | --- |
| Depth of field, bloom, grain | Yes | Yes, fewer samples | No |
| Window light | Yes | No | No |
| Objects on the desk | All | All | Three |
| Pixel ratio up to | 2 | 1.5 | 1.5 |

### Inside the book

`pageArtwork.js` sets each page as a fine photography book would: scanned cold-press paper (`paperToothCanvas`), a blind-pressed frame, then the print, caption, date and folio. The print's size follows from what's beneath it, and the group sits a little above the middle of the frame, so that a page with no caption or date still looks deliberate.

The paper's warmth is painted into the paper rather than coming from the light. That's what lets the light stay neutral for the photographs.

`PageStack` fans the fore-edge out by `1 - pose.closed`, so the layered gilt edges show on an open book while a shut one, including the library's, stays square.

### Dates

Only a date the camera recorded is ever shown (`capturedDate`). A file's modified date is usually the day it was copied or shared, so it's stored but never presented as the day a photo was taken.

### Uploads

`resizeImage.js` limits the longest side to 2400px, which is sharp on a large screen. To cope with whatever people upload from:

- HEIC falls through to `heic-to`, about 3 MB, loaded only when a browser can't read the file itself. Its dates are read by `fromHeif` in `exifDate.js`. It's LGPL-3.0, so keep it as an unmodified, separately loaded package.
- If `createImageBitmap` fails, an `<img>` is tried.
- If a phone runs out of memory, it retries at 1600px and then 1200px.
- A JPEG within the limit is kept byte for byte, unless it's over 6 MB.

Pages decode a photograph at no more than 1400px (`loadBitmap` in `Book.jsx`), so larger uploads don't slow page turning. The enlarged view shows the whole file.

### Keeping the first visit fast

These three rules come from a real problem: a first visit once froze the page for over a minute.

1. **Never set a canvas `filter` while drawing many strokes.** It applies to each stroke separately. Blurring hundreds of stitches this way on a 2048px cover was the main cause. Draw on a layer and filter once, as `drawCoverMaps` does.
2. **Use `surfaceMaterial()` for anything new.** Each different combination of texture maps is another shader to compile, which can be slow on Windows. Neutral textures stand in for unused maps, so nearly everything shares one shader.
3. **Avoid transmission materials.** Real glass makes three.js draw the whole scene again every frame. `plainMaterial` replaces it with a faint clear surface.

`ScenePreparation` in `AlbumScene.jsx` compiles shaders in the background before anything is drawn, and fades the canvas up once the book is really there. The opening's clock starts only then, so that none of it plays unseen.

### Other details

- A moving sheet ripples in proportion to its speed.
- The page block crowns and falls toward the fore-edge, and its edges are gilded.
- Covers use scanned leather, tinted to the theme. `drawCoverMaps` bakes its grain, stitches and raised foil into one normal map, since three.js can't combine a normal map with a bump map.
- Shadows redraw only when the book or lamp moves (see `Lighting`).
- After 20 seconds with no input, an open book stops being redrawn until the next touch, key or pointer movement.
- Reduced-motion settings turn off the continuous movement.
- The controls fade from an open book after 3.5 seconds without mouse movement. They stay put on touch screens.

A closed book can be turned over by dragging it (`lib/album/bookSpin.js`). Rotation is a quaternion, so it turns freely in every direction without the lock-up that separate angles suffer. The book's centre is raised by exactly how far its lowest corner reaches, so no corner can pass through the table. It stays where it's left, and `BookSpin.goHome` brings it back. `TurnController.whenOnTable` makes a cover wait until the book is back down before opening. The small library books turn in CSS instead.

Sound is currently switched off: `SOUND_ENABLED` in `lib/ambient/sound.js` is false, and `SoundToggle` isn't in the header. To restore it, set the flag to true and put the toggle back. Sounds are synthesised with the Web Audio API, so there are no audio files. `TurnController` names what happened through `controller.sound`, and `SoundBridge` in `AlbumScene.jsx` connects that and the speed-following rustle and whoosh. Nothing is created until the first click or key press, as browsers require.

The library's centrepiece, `ShowcaseScene`, is the same scene with the most recently changed album shut and turning. The page scrolls over it.
## How a page bends

A page is a grid of 24 × 8 segments whose vertices are recalculated on the CPU.

Displacing vertices directly makes paper visibly stretch, so each row of the grid is built by integration instead. `integrateRow` in `leafDeform.js` chooses a tangent angle θ at each step and walks outward from the spine:

```
x += cos(θ) · ds
z += sin(θ) · ds
```

This gives three properties without any extra work:

- **Paper can't stretch.** Every row keeps its exact length whatever θ does. A unit test checks this.
- **Pages stay attached.** Every row starts at the spine.
- **Pages can't pass through the stack.** θ is limited to the range between the two resting angles.

The angle at each point is a blend of these parts:

| Part | Effect |
| --- | --- |
| Turn progress `t` | Rotates the sheet from the right stack (0) to the left stack (1) |
| Curl | The outer part of the sheet leads the inner part. The sign reverses as a released page lands, because air holds the edge back |
| Skew | The held corner leads the opposite corner, producing a diagonal fold |
| Gutter | The sheet curves down into the spine at rest, on both sides |

The two printed faces are offset from this centre surface along its normal, which gives the page real thickness and correct lighting on its back.

### Following the pointer

`solveTurnForPointer` finds the progress `t` that places the grabbed point under the pointer, by bisection. It allows for perspective, since a raised page looks further from the centre of the book.

## Animation and rendering

`TurnController` holds all motion state outside React. Each frame it advances a critically damped spring, solved exactly so that it behaves the same at any frame rate. React subscribes only to a snapshot that changes on discrete events, such as a new spread, so a page turn causes no per-frame React renders.

The scene uses on-demand rendering, driven by `AliveLoop` while there's dust and flame to animate.

To keep costs independent of album size:

- Only the leaves around the current spread and any moving leaves exist as meshes. All others are part of two solid `PageStack` blocks.
- `PageTextureCache` holds the textures in use plus 8 recently used ones, and disposes of the rest.
- Each page is flattened into one canvas, so a page needs a single colour texture however much is on it.
- Vertices are rewritten only for a leaf whose shape changed.

## Storage

Metadata and image blobs are in separate IndexedDB object stores, so loading an album never reads image data. Blobs are read only when a page is drawn.

React state holds metadata only. Components call `albumStore.js` and never touch IndexedDB directly.

### Schema (version 2)

| Store | Key | Contents |
| --- | --- | --- |
| `albums` | `id` | `title`, `description`, `theme: { colour, material, paper }`, `createdAt`, `updatedAt` |
| `photos` | `id`, plus index `byAlbum` on `[albumId, order]` | `albumId`, `order`, `name`, `width`, `height`, `takenAt`, `takenAtSource`, `caption`, `addedAt` |
| `photoBlobs` | `id` (same as the photo's) | `blob` |

The `byAlbum` index keeps each album's order separate. Every operation that changes photographs goes through that index for one album, and **nothing may ever call `clear()` on a store**, because each store now holds every album's data.

Each change happens in a single transaction together with the album's `updatedAt`. Deleting or duplicating an album is therefore all-or-nothing, including a duplicate running out of disk space part way.

### Migration from version 1

Version 1 had one album, whose photographs already carried `albumId: 'default'`, and an album record only if its title had been changed. The upgrade (`migrations.js`, applied in `indexedDB.js`):

- Writes a complete album record for every stored record and every `albumId` a photograph refers to.
- Takes `createdAt` and `updatedAt` from the photographs' `addedAt` values.
- Keeps any title, and applies the default theme, which matches how version 1 looked.
- Doesn't rewrite or remove any photograph or image.

It runs inside IndexedDB's upgrade transaction, so a failure rolls the database back to version 1, untouched. `caption` is simply missing on old photographs, and code treats that as empty.

Adding a version 3 means raising `DB_VERSION` and adding an `oldVersion < 3` step. Old steps must stay, because a user may skip versions.

## Connecting the backend

The backend is in `backend/` (see its [README](../backend/README.md)). It uses Spring Boot 3, Java 17, Maven, PostgreSQL and Spring Security with JWT. Photographs go to Supabase Storage rather than the Azure Blob Storage first planned.

```
Frontend (Vercel) --REST--> Spring Boot (Render) --JPA--> PostgreSQL (Supabase)
                                  |
                                  +--> Supabase Storage (photographs)
```

The frontend uses it when `NEXT_PUBLIC_API_URL` is set at build time. `albumStore.js` then sends every call to `remoteStore.js` instead of `localStore.js`; both have the same functions, so no component knows which is in use. `components/Account/AccountGate.jsx` shows the sign-in screen until someone signs in. The token from the server is kept in localStorage and sent as a `Bearer` header. A 401 from any request signs the person out, which brings the sign-in screen back. Photographs already kept in a browser are not moved to an account.

Every photograph is downloaded with that header, so `getPhotoBlob` fetches it and shares a download already under way. The browser's cache serves later visits, since the server marks each image private and unchanging.

| Function | Endpoint |
| --- | --- |
| `listAlbums()` | `GET /api/albums` |
| `getAlbum(id)` | `GET /api/albums/{id}` |
| `createAlbum(fields)` | `POST /api/albums` |
| `saveAlbum(id, fields)` | `PATCH /api/albums/{id}` |
| `duplicateAlbum(id)` | `POST /api/albums/{id}/copies` |
| `deleteAlbum(id)` | `DELETE /api/albums/{id}` |
| `getPhotoBlob(id)` | `GET /api/photos/{id}/content` |
| `addPhoto(albumId, photo)` | `POST /api/albums/{id}/photos` |
| `updatePhotoCaption(id, caption)` | `PATCH /api/photos/{id}` |
| `deletePhoto(id)` | `DELETE /api/photos/{id}` |
| `clearAlbum(id)` | `DELETE /api/albums/{id}/photos` |
| `reorderPhotos(id, ids)` | `PUT /api/albums/{id}/photo-order` |

Failures surface as the same `StorageError` either way, with two additions: `auth` when the person must sign in again, and `unavailable` when the server can't be reached.

## Dependency note

`three` is pinned to 0.180.0. Later versions log a deprecation warning from inside `@react-three/fiber` (`THREE.Clock`) and remove the PCF soft shadow type. Check for those warnings before upgrading.
