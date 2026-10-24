import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { Operations } from './Operations';

vi.mock('../lib/api', () => ({ api: {
  operationsList: vi.fn(), deliveriesList: vi.fn(), turnsList: vi.fn(), deliveryGet: vi.fn(),
  operationResolve: vi.fn(), deliveryResolve: vi.fn(), deliveryRetry: vi.fn(),
} }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.operationsList).mockResolvedValue({ success: true, data: [{ operation_id: 'operation-unknown', tool_name: 'send', status: 'unknown', started_at: 1, revision: 2 }] } as never);
  vi.mocked(api.deliveriesList).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.turnsList).mockResolvedValue({ success: true, data: [
    { turnId: 'completed-turn', chatId: '1', outcome: { status: 'completed', reason: 'completed' }, delivery: { state: 'delivered' }, modelAttempts: [] },
    { turnId: 'unknown-turn', chatId: '1', outcome: { status: 'unknown', reason: 'effect_unknown' }, delivery: { state: 'unknown' }, modelAttempts: [{ id: 'attempt-1', provider: 'fake', model: 'observed-model', purpose: 'main', incomplete: true }] },
  ] } as never);
});

describe('Operations review', () => {
  it('filters turn outcomes and shows model attempt evidence in details', async () => {
    render(<Operations />);
    await screen.findByRole('button', { name: /unknown-turn/ });
    fireEvent.change(screen.getByLabelText('Turn outcome'), { target: { value: 'unknown' } });
    expect(screen.queryByRole('button', { name: /completed-turn/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /unknown-turn/ }));
    expect(screen.getByRole('heading', { name: 'Turn · unknown' })).not.toBeNull();
    expect(screen.getByText(/observed-model/)).not.toBeNull();
    expect(api.deliveryRetry).not.toHaveBeenCalled();
    expect(api.operationResolve).not.toHaveBeenCalled();
  });

  it('requires explicit review evidence for an unknown action and offers no automatic retry', async () => {
    render(<Operations />);
    fireEvent.click(await screen.findByRole('button', { name: /operation-unknown/ }));
    expect((screen.getByRole('button', { name: 'Record resolution' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry remaining delivery' })).toBeNull();
    await waitFor(() => expect(api.operationsList).toHaveBeenCalledTimes(1));
    expect(api.operationResolve).not.toHaveBeenCalled(); expect(api.deliveryRetry).not.toHaveBeenCalled();
  });
});
