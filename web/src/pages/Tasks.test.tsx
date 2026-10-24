import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { Tasks } from './Tasks';

const confirm = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../components/ConfirmDialog', () => ({ useConfirm: () => confirm }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/api', () => ({ api: { tasksList: vi.fn(), taskNewAttempt: vi.fn(), taskResolve: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.taskNewAttempt).mockResolvedValue({ success: true, data: { id: 'replacement' } } as never);
});
const task = { id: 'reviewed-task', description: 'Reviewed task', status: 'cancelled', revision: 3,
  priority: 0, createdAt: new Date(0).toISOString(), legacyOutcome: false, dependencies: [], dependents: [],
  resolvedFromStatus: 'unknown', resolutionNote: 'Verified prior remote effects', runs: [{ run_id: 'prior-run', status: 'unknown' }] };

describe('Task attempts', () => {
  it('creates a separate attempt only after explicit evidence and confirmation', async () => {
    vi.mocked(api.tasksList).mockResolvedValue({ success: true, data: [task] } as never);
    render(<Tasks />);
    fireEvent.click(await screen.findByRole('button', { name: /Reviewed task Cancelled/ }));
    const button = screen.getByRole('button', { name: 'Create new attempt' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New attempt evidence'), { target: { value: 'Remote effects reviewed; begin new intention' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.taskNewAttempt).toHaveBeenCalledWith('reviewed-task', 3, 'Remote effects reviewed; begin new intention'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not offer a new attempt while the original outcome remains unknown', async () => {
    vi.mocked(api.tasksList).mockResolvedValue({ success: true, data: [{ ...task, status: 'unknown', resolutionNote: undefined, resolvedFromStatus: undefined }] } as never);
    render(<Tasks />);
    fireEvent.click(await screen.findByRole('button', { name: /Reviewed task Unknown/ }));
    expect(screen.queryByRole('button', { name: 'Create new attempt' })).toBeNull();
    expect(api.taskNewAttempt).not.toHaveBeenCalled();
  });
});
