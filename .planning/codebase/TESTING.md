# Testing Patterns

**Analysis Date:** 2026-08-26

## Current Testing Status

**No test framework is currently installed or configured in this project.**

This codebase has:
- No Jest, Vitest, Playwright, or other testing libraries installed
- No test files (`.test.ts`, `.test.tsx`, `.spec.ts`)
- No test configuration files (jest.config.js, vitest.config.ts, etc.)
- Only TypeScript compilation for type checking

## Quality Validation

**Current Approach:**
- TypeScript strict type checking: `npm run lint` runs `tsc --noEmit`
- Type safety as the primary quality mechanism
- No runtime testing or integration testing

**Code Quality Tools:**
```bash
npm run lint              # TypeScript type checking only
npm run build            # Vite build (catches compilation errors)
npm run dev              # Development server with hot reload
```

## Recommended Testing Strategy

While no tests currently exist, the following patterns should be used if tests are added:

### Test Framework Choice

**For frontend (React components):**
- **Recommended:** Vitest (fast, modern, ESM-native) with `@testing-library/react`
- Alternative: Jest with `@testing-library/react`

**For backend (Express endpoints):**
- **Recommended:** Vitest or Node's native test runner
- Alternative: Jest with supertest for HTTP testing

**For E2E:**
- Playwright or Cypress (when user interaction testing is needed)

### Recommended File Structure

```
src/
├── components/
│   ├── ApiKeySetup.tsx
│   ├── ApiKeySetup.test.tsx      ← Test co-located with component
│   ├── ToolSection.tsx
│   └── ToolSection.test.tsx
├── lib/
│   ├── download.ts
│   ├── download.test.ts          ← Test co-located with utility
│   ├── renderMarkdown.tsx
│   └── renderMarkdown.test.tsx
└── sections/
    ├── AiDetection.tsx
    └── AiDetection.test.tsx
```

**Pattern:** Tests co-located with implementation (same directory, `.test.tsx` suffix)

### Test Naming Convention

**Suite:**
```typescript
describe("ComponentName or UtilityName", () => {
  // Tests here
});
```

**Test cases:**
```typescript
it("should [do something specific]", () => {
  // Arrange, Act, Assert
});

it("should handle [edge case]", () => {
  // Arrange, Act, Assert
});
```

**Naming pattern:** Use "should" + action description

### Component Testing Pattern

**Example pattern for `ApiKeySetup.test.tsx`:**

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeySetup } from "./ApiKeySetup";

describe("ApiKeySetup", () => {
  it("should render the key input field", () => {
    render(
      <ApiKeySetup
        apiKey=""
        onApiKeyChange={() => {}}
        providerInfo={null}
        isVerifying={false}
        verifyError=""
      />
    );
    
    const input = screen.getByPlaceholderText(/AIza|sk-/);
    expect(input).toBeInTheDocument();
  });

  it("should call onApiKeyChange when user types", async () => {
    const handleChange = vi.fn();
    const { getByPlaceholderText } = render(
      <ApiKeySetup
        apiKey=""
        onApiKeyChange={handleChange}
        providerInfo={null}
        isVerifying={false}
        verifyError=""
      />
    );

    const input = getByPlaceholderText(/AIza|sk-/);
    await userEvent.type(input, "test-key");
    
    expect(handleChange).toHaveBeenCalledWith("test-key");
  });

  it("should show connected state when providerInfo is present", () => {
    const mockProvider = {
      provider: "google" as const,
      providerLabel: "Google Gemini",
      model: "gemini-2.0-flash",
    };
    
    render(
      <ApiKeySetup
        apiKey="AIza..."
        onApiKeyChange={() => {}}
        providerInfo={mockProvider}
        isVerifying={false}
        verifyError=""
      />
    );

    expect(screen.getByText(/Connected to/)).toBeInTheDocument();
  });

  it("should display verification error message", () => {
    const errorMsg = "Invalid API key";
    render(
      <ApiKeySetup
        apiKey="invalid"
        onApiKeyChange={() => {}}
        providerInfo={null}
        isVerifying={false}
        verifyError={errorMsg}
      />
    );

    expect(screen.getByText(errorMsg)).toBeInTheDocument();
  });
});
```

### Utility Function Testing Pattern

**Example pattern for `download.test.ts`:**

```typescript
import { downloadBlob, downloadText } from "./download";
import { vi } from "vitest";

describe("download utilities", () => {
  beforeEach(() => {
    // Mock DOM methods
    vi.spyOn(document, "createElement");
    vi.spyOn(document.body, "appendChild");
    vi.spyOn(document.body, "removeChild");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create and trigger a download for blob", () => {
    const blob = new Blob(["test content"], { type: "text/plain" });
    downloadBlob("test.txt", blob);

    expect(document.createElement).toHaveBeenCalledWith("a");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("should revoke the object URL after download", async () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    downloadBlob("test.txt", blob);

    await vi.waitFor(
      () => {
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
      },
      { timeout: 1500 }
    );
  });

  it("should create text blob and trigger download", () => {
    downloadText("resume.txt", "My resume content");

    expect(document.createElement).toHaveBeenCalledWith("a");
  });
});
```

### API Endpoint Testing Pattern

**Example pattern for `server.test.ts` (if tests were added):**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { startServer } from "./server"; // Refactored to export app

describe("POST /api/resume/extract", () => {
  let app: Express.Application;

  beforeAll(() => {
    // Start server or get app instance
  });

  it("should extract text from PDF file", async () => {
    const response = await request(app)
      .post("/api/resume/extract")
      .send({
        fileName: "resume.pdf",
        dataBase64: "JVBERi0xLjQ...", // minimal PDF base64
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("text");
    expect(response.body).toHaveProperty("chars");
  });

  it("should reject files over 5MB", async () => {
    const largeData = "a".repeat(6 * 1024 * 1024); // 6MB

    const response = await request(app)
      .post("/api/resume/extract")
      .send({
        fileName: "huge.pdf",
        dataBase64: Buffer.from(largeData).toString("base64"),
      });

    expect(response.status).toBe(413);
    expect(response.body.error).toContain("5MB");
  });

  it("should return 422 for files with no extractable text", async () => {
    const response = await request(app)
      .post("/api/resume/extract")
      .send({
        fileName: "blank.pdf",
        dataBase64: "empty", // Won't produce readable text
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("no text could be read");
  });
});
```

## Areas Requiring Testing

### High Priority

**Component behavior:**
- `ApiKeySetup`: Key validation, provider detection, error display
- `SharedInputs`: File upload, text paste, form input handling
- `AiDetection`: Resume scanning and result display
- `ResumeAudit`: Analysis request, result rendering, export functions

**Server endpoints:**
- `/api/resume/extract`: File parsing (PDF, DOCX, TXT, MD, CSV), size validation
- `/api/resume/analyze`: Prompt handling, API key routing, error cases
- `/api/interview/questions`: Structured output validation, schema compliance
- `/api/ai-detect`: Text detection scoring, edge cases (empty text, very short text)

**Utilities:**
- `detectAiStatistically`: Scoring accuracy, signal weighting
- `exportQAtoPDF`, `exportQAtoDOCX`: Export format correctness
- `renderMarkdown`: Markdown parsing, regex handling

### Medium Priority

**Integration:**
- Full user flow: upload resume → audit → interview prep
- API key identification across providers (Google, OpenAI, Anthropic)
- Error recovery and retry logic

**Edge cases:**
- Very large resumes (near 5MB limit)
- Resumes with unusual formatting (scanned images, tables)
- Concurrent requests from multiple tabs/users
- Network timeout handling

### What NOT to Test

- Tailwind CSS classes (styling is visual, tested manually)
- External API responses (mock these)
- Browser-specific features (localStorage is mocked in tests)
- Third-party library behavior (jsPDF, docx, lucide-react)

## Mocking Strategy

**What to Mock:**
- `fetch()` calls to external APIs
- `localStorage` for persistent state
- File system operations (server-side)
- External AI provider APIs (use recorded responses)

**What NOT to Mock:**
- React components under test
- Internal utility functions
- Data transformations
- Local computation (AI detection, markdown parsing)

**Example mocks:**

```typescript
// Mock fetch for API calls
global.fetch = vi.fn((url, options) => {
  if (url.includes("/api/ai/identify")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ provider: "google", model: "gemini-2.0" }),
    });
  }
  return Promise.reject(new Error("Not mocked"));
});

// Mock localStorage
const store: Record<string, string> = {};
global.localStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => { store[key] = value; },
  removeItem: (key) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
} as any;
```

## Test Configuration (When Added)

**Recommended `vitest.config.ts`:**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
      ],
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

**Recommended `src/test/setup.ts`:**

```typescript
import "@testing-library/jest-dom";
import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
```

**Updated `package.json` scripts (when tests added):**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "lint": "tsc --noEmit"
  }
}
```

## Coverage Targets

When tests are implemented, aim for:
- **Statements:** 70%+ (core logic coverage)
- **Branches:** 70%+ (if/else paths covered)
- **Functions:** 70%+ (most functions have at least one test)
- **Lines:** 70%+ (most lines executed)

Critical paths (API endpoints, data transformations, detection logic) should target 80%+ coverage.

---

*Testing analysis: 2026-08-26*
