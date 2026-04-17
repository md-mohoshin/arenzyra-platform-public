import type { Request } from 'express';
import { Role } from '@prisma/client';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('AuthController', () => {
  const auth = {
    applyForOrganization: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    revoke: jest.fn(),
    validateAccessTokenPayload: jest.fn(),
    me: jest.fn(),
  } as jest.Mocked<
    Pick<
      AuthService,
      | 'applyForOrganization'
      | 'login'
      | 'refresh'
      | 'revoke'
      | 'validateAccessTokenPayload'
      | 'me'
    >
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logout revokes the refresh token provided in the request body', async () => {
    const controller = new AuthController(auth as unknown as AuthService);

    const result = await controller.logout({
      refresh_token: 'refresh-token',
    });

    expect(result).toEqual({ ok: true });
    expect(auth.revoke).toHaveBeenCalledWith('refresh-token');
  });

  it('apply forwards organizer application details', async () => {
    const controller = new AuthController(auth as unknown as AuthService);
    auth.applyForOrganization.mockResolvedValue({
      id: 'app-1',
      name: 'Acme Events',
      email: 'owner@example.com',
      applicantName: 'Owner',
      status: 'PENDING',
      createdAt: new Date('2026-03-24T10:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    });

    const result = await controller.apply({
      name: 'Acme Events',
      email: 'owner@example.com',
      password: 'secret123',
      applicantName: 'Owner',
    });

    expect(auth.applyForOrganization).toHaveBeenCalledWith({
      name: 'Acme Events',
      email: 'owner@example.com',
      password: 'secret123',
      applicantName: 'Owner',
    });
    expect(result).toEqual({
      data: expect.objectContaining({
        id: 'app-1',
        status: 'PENDING',
      }),
    });
  });

  it('me resolves the bearer token from the authorization header', async () => {
    const controller = new AuthController(auth as unknown as AuthService);
    auth.me.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: 'User',
        role: Role.ORGANIZER,
        organizationId: 'org1',
      },
      organization: { id: 'org1', name: 'Org' },
    });

    const req = {
      headers: {
        authorization: 'Bearer jwt-token',
      },
    } as unknown as Request;

    await controller.me(req);

    expect(auth.me).toHaveBeenCalledWith('jwt-token');
  });
});
