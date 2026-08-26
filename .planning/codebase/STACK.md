# Technology Stack

**Analysis Date:** 2026-08-26

## Languages

**Primary:**
- TypeScript ~5.8.2 - Full codebase (frontend, backend, configuration)
- JSX/TSX - React components and UI
- JavaScript - Configuration files

**Secondary:**
- Plain text extraction - Resume/document processing

## Runtime

**Environment:**
- Node.js (version not pinned in package.json, inferred from usage of ES2022 and modern APIs)

**Package Manager:**
- npm - Lockfile: `package-lock.json` (not visible, assumed present)

## Frameworks

**Core:**
- React 19.0.1 - Frontend UI framework
- Express 4.21.2 - Backend HTTP server
- Vite 6.2.3 - Build tool and dev server

**Styling:**
- Tailwind CSS 4.1.14 - Utility-first CSS framework
- @tailwindcss/vite 4.1.14 - Vite integration for Tailwind

**React Plugins:**
- @vitejs/plugin-react 5.0.4 - Vite React support

**Build Tools:**
- esbuild 0.25.0 - Fast TypeScript/JavaScript bundler
- tsx 4.21.0 - TypeScript executor for Node.js scripts

**Testing:**
- Not detected (no jest, vitest, or similar in dependencies)

## Key Dependencies

**Critical:**
- @anthropic-ai/sdk 0.120.0 - Claude API client for Anthropic models
- @google/genai 2.4.0 - Google Gemini API client
- openai 7.5.0 - OpenAI API client (GPT models)

**Infrastructure:**
- express 4.21.2 - HTTP request handling
- dotenv 17.2.3 - Environment variable loading

**Document Processing:**
- mammoth 1.12.1 - Extract text from DOCX files
- unpdf 1.8.1 - Extract text from PDF files (bundles PDF.js)
- jspdf 4.2.1 - Generate PDF documents
- docx 9.7.1 - Generate DOCX documents

**UI Components:**
- lucide-react 0.546.0 - Icon library

**Utilities:**
- react-dom 19.0.1 - React DOM rendering

## Configuration

**Environment:**
- Loaded via `dotenv` from `.env` file at application startup (`server.ts` line 10)
- `.env.example` exists but contains example values only
- Key configuration: `FAST_DETECT_GPT_URL` (optional, for local AI detection model)

**Build:**
- `vite.config.ts` - Vite build configuration with React plugin and Tailwind integration
- `tsconfig.json` - TypeScript compiler configuration targeting ES2022, module resolution: bundler
- Path alias: `@/*` resolves to project root (`./*`)

**TypeScript:**
- `target: ES2022` - Modern JavaScript features
- `module: ESNext` - ES modules
- `jsx: react-jsx` - React 17+ JSX transform
- `allowJs: true` - Mixed TypeScript/JavaScript
- `noEmit: true` - Only type checking, no output

## Platform Requirements

**Development:**
- Node.js (modern version supporting ES2022)
- npm for package management
- 5MB file upload limit for resume processing

**Production:**
- Node.js runtime for server
- Port 3000 (hardcoded in `server.ts` line 337)
- Deployment target: Traditional Node.js hosting (not serverless-first)
- Vite-built static assets in `dist/` directory
- Node CJS server bundle from esbuild (`dist/server.cjs`)

## Build Process

**Development:**
```bash
npm run dev          # Runs tsx on server.ts with Vite dev server
```

**Production:**
```bash
npm run build        # Vite builds React app + esbuild bundles Node server
npm run start        # Runs compiled CJS server
npm run clean        # Removes dist/
npm run lint         # tsc type checking
```

**Build Output:**
- React/Vite app: `dist/` (static assets, `index.html`)
- Server: `dist/server.cjs` (bundled Node server with external dependencies)
- Sourcemaps generated for debugging

## Version & Metadata

- Name: career-copilot
- Version: 0.0.0 (development)
- Type: module (ESM)
- Private: true

---

*Stack analysis: 2026-08-26*
