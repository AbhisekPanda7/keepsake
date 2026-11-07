# Keepsake

A digital photo album that behaves like a physical one. Photographs are printed onto paper pages inside a leather-bound 3D book, and you turn the pages by hand with a mouse or finger.

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

The site opens on your library, where every album lies on the table as a book.

| In the library | How |
| --- | --- |
| Make an album | **New album**: choose a title, a few words, cover colour, cover material and paper |
| Open an album | Click or tap its book |
| Turn a book over | Drag it in any direction. It stays where you leave it, until you click **Set it down** or open it |
| Rename, customise, duplicate or delete | The **⋯** button beside the album's title |

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

## Documentation

- [Architecture](docs/architecture.md): how the code is organised, how the page bending works, and how the backend will connect.
