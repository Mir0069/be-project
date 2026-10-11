# smartmfgAI Everywhere Frontend

React + TypeScript + Vite frontend for smartmfgAI Everywhere.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node.js)
- smartmfgAI Everywhere Backend running locally (see `../GFS-backend/README.md`)

## Installation

1. **Clone the repository** (if you haven't already):

   ```bash
   git clone <repo-url>
   cd smartmfgai-frontend
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   Create a `.env` file in this directory:

   ```env
   VITE_API_BASE_URL=http://localhost:3000/api/v1
   ```

   | Variable | Required | Default | Description |
   |---|---|---|---|
   | `VITE_API_BASE_URL` | No | `http://localhost:3000/api/v1` | Backend API base URL |

## Running the App

**Development server** (with hot module replacement):

```bash
npm run dev
```

The app will be available at [http://localhost:5173](http://localhost:5173).

**Build for production:**

```bash
npm run build
```

**Preview the production build:**

```bash
npm run preview
```

## Linting

```bash
npm run lint
```

## Tech Stack

- [React 19](https://react.dev/) — UI framework
- [TypeScript](https://www.typescriptlang.org/) — type safety
- [Vite](https://vite.dev/) — build tool
- [TailwindCSS 4](https://tailwindcss.com/) — styling
- [React Router 7](https://reactrouter.com/) — routing
- [TanStack Query](https://tanstack.com/query) — server state management
- [TanStack Form](https://tanstack.com/form) — form handling
- [Zod](https://zod.dev/) — schema validation
- [Axios](https://axios-http.com/) — HTTP client
