import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.js',
        // Excludem testele Playwright pentru a nu interfera cu Vitest
        exclude: ['**/node_modules/**', '**/tests/**', 'playwright.config.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            // Includem doar fișierele sursă relevante pentru coverage
            include: ['src/App.jsx'],
            exclude: [
                'src/main.jsx',
                'src/setupTests.js',
                'node_modules/**'
            ],
            all: true,
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100
            }
        },
    },
});