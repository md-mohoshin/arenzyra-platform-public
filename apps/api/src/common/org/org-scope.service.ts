import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Role } from '@prisma/client';

type OrgContext = {
  orgId: string | null;
  actorId: string | null;
  role: Role | null;
};

@Injectable()
export class OrgScopeService {
  private readonly als = new AsyncLocalStorage<OrgContext>();

  runWithOrg<T>(
    orgId: string | null,
    actorId: string | null,
    role: Role | null,
    fn: () => T,
  ): T {
    return this.als.run({ orgId, actorId, role }, fn);
  }

  getOrgId(): string | null {
    const store = this.als.getStore();
    return store?.orgId ?? null;
  }

  getActorId(): string | null {
    return this.als.getStore()?.actorId ?? null;
  }

  getRole(): Role | null {
    return this.als.getStore()?.role ?? null;
  }
}
