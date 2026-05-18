import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Recharts are nevoie de ResizeObserver pentru a randa graficul în JSDOM
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));