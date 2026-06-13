import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService, type SafeUser } from '../src/auth/auth.service';

const user: SafeUser = {
  id: 'u1',
  email: 'user@example.com',
  name: 'User',
  role: Role.ORGANIZER,
  organizationId: 'org1',
};

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  const auth = {
    login: jest.fn(),
    refresh: jest.fn(),
    revoke: jest.fn(),
    me: jest.fn(),
    applyForOrganization: jest.fn(),
    validateAccessTokenPayload: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('login returns access and refresh tokens in the response body', async () => {
    auth.login.mockResolvedValue({
      user,
      organization: { id: 'org1', name: 'Org' },
      accessToken: 'jwt-access-token',
      refreshToken: 'refresh-token',
      refreshExpiresAt: new Date(Date.now() + 2000),
    });

    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'secret' })
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        access_token: 'jwt-access-token',
        accessToken: 'jwt-access-token',
        refresh_token: 'refresh-token',
        refreshToken: 'refresh-token',
        user: expect.objectContaining({ id: user.id }),
      }),
    );
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login rejects client-supplied organizationId overrides', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .post('/auth/login')
      .send({
        email: 'user@example.com',
        password: 'secret',
        organizationId: 'forged-org',
      })
      .expect(400);

    expect(res.body.message).toContain(
      'property organizationId should not exist',
    );
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('refresh accepts a refresh token in the request body', async () => {
    auth.refresh.mockResolvedValue({
      user,
      organization: { id: 'org1', name: 'Org' },
      accessToken: 'new-jwt-access-token',
      refreshToken: 'new-refresh-token',
      refreshExpiresAt: new Date(Date.now() + 2000),
    });

    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .post('/auth/refresh')
      .send({ refresh_token: 'refresh-token' })
      .expect(201);

    expect(auth.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'refresh-token' }),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        access_token: 'new-jwt-access-token',
        refresh_token: 'new-refresh-token',
      }),
    );
  });

  it('logout revokes the provided refresh token', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(server)
      .post('/auth/logout')
      .send({ refresh_token: 'refresh-token' })
      .expect(201);

    expect(res.body).toEqual({ ok: true });
    expect(auth.revoke).toHaveBeenCalledWith('refresh-token');
  });
});
