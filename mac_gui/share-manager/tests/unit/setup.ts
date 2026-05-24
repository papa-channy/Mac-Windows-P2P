// Vitest setup — runs once per worker before any test file. Pulls in
// jest-dom's custom matchers so we get `toBeInTheDocument` etc on
// expect(). Keep this short.

import "@testing-library/jest-dom/vitest";
