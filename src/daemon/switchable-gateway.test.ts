import { describe, expect, it } from 'vitest';
import { FakeGateway } from '../testing/fake-gateway.js';
import { createSwitchableGateway } from './switchable-gateway.js';
import { createUnauthenticatedGateway, NOT_CONNECTED } from './unauthenticated-gateway.js';

describe('createSwitchableGateway', () => {
  it('delegates to the initial target, then to the swapped-in one', async () => {
    const holder = createSwitchableGateway(createUnauthenticatedGateway(NOT_CONNECTED));
    await expect(holder.gateway.getFolders()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', message: NOT_CONNECTED });
    const real = new FakeGateway();
    holder.set(real);
    await expect(holder.gateway.getFolders()).resolves.toEqual([]);
  });

  it('forwards every gateway method', () => {
    const holder = createSwitchableGateway(new FakeGateway());
    expect(Object.keys(holder.gateway).sort()).toEqual(Object.keys(createUnauthenticatedGateway()).sort());
  });
});
