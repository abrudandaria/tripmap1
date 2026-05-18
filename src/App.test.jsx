import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

vi.mock('js-cookie', () => ({ default: { get: vi.fn(), set: vi.fn() } }));

describe('TripMap 100% Coverage', () => {
    it('runs all features and views', () => {
        render(<App />);

        // Auth
        fireEvent.click(screen.getByText(/New here/i));
        fireEvent.click(screen.getByText(/Sign In/i));
        fireEvent.click(screen.getByText(/Open Master Dashboard/i));

        // Add (Validation + Success)
        fireEvent.click(screen.getByText(/Add New Trip/i));
        fireEvent.click(screen.getByText(/Confirm Trip/i)); // Return branch

        fireEvent.change(screen.getByLabelText(/Destination Name/i), { target: { value: 'Iceland' } });
        fireEvent.change(screen.getByLabelText(/Short Description/i), { target: { value: 'Auroras' } });
        fireEvent.change(screen.getByLabelText(/Budget/i), { target: { value: '3500' } });
        fireEvent.change(screen.getByLabelText(/Days/i), { target: { value: '8' } });
        fireEvent.click(screen.getByText(/Confirm Trip/i));

        // Edit
        fireEvent.click(screen.getAllByText('📝')[0]);
        fireEvent.change(screen.getByLabelText(/Destination Name/i), { target: { value: 'Paris Deluxe' } });
        fireEvent.click(screen.getByText(/Confirm Trip/i));

        // Delete & Cleanup
        fireEvent.click(screen.getAllByText('🗑️')[0]);
        fireEvent.click(screen.getByText(/Add New Trip/i));
        fireEvent.click(screen.getByText(/Cancel/i));
        fireEvent.click(screen.getByText(/Logout/i));

        expect(screen.getByText(/Sign In/i)).toBeInTheDocument();
    });
});