import {
  generateId,
  TenantId,
  EventId,
  UUID,
  EventStatus,
  SportSlug,
  KaziBetError
} from '@kazibet/shared';
import {
  DatabaseTransactionContext,
  EventEntity,
  CompetitionEntity,
  TeamEntity,
  SportEntity
} from '@kazibet/database';
import { TenantContextHolder } from '@kazibet/tenant';
import { ExternalEventPayload } from './provider-interface.js';

export class SportsService {
  constructor(private readonly getContext: () => DatabaseTransactionContext) {}

  public async getActiveSports(): Promise<SportEntity[]> {
    const ctx = this.getContext();
    const defaults: SportEntity[] = [
      { id: 'sport-football', slug: 'football', name: 'Football (Soccer)', isActive: true },
      { id: 'sport-basketball', slug: 'basketball', name: 'Basketball', isActive: true },
      { id: 'sport-tennis', slug: 'tennis', name: 'Tennis', isActive: true },
      { id: 'sport-cricket', slug: 'cricket', name: 'Cricket', isActive: true },
      { id: 'sport-rugby', slug: 'rugby', name: 'Rugby', isActive: true }
    ];
    return defaults;
  }

  public async getOrCreateCompetition(sportId: UUID, slug: string, name: string, country?: string): Promise<CompetitionEntity> {
    return {
      id: `comp-${slug}`,
      sportId,
      slug,
      name,
      country
    };
  }

  public async getOrCreateTeam(sportId: UUID, name: string, country?: string): Promise<TeamEntity> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return {
      id: `team-${slug}`,
      sportId,
      name,
      shortName: name.slice(0, 3).toUpperCase(),
      country
    };
  }

  public async createEvent(params: {
    tenantId: TenantId;
    competitionId: UUID;
    homeTeamId: UUID;
    awayTeamId: UUID;
    scheduledStart: Date;
    status?: EventStatus;
  }): Promise<EventEntity> {
    TenantContextHolder.assertTenant(params.tenantId);
    const ctx = this.getContext();
    const id = generateId();

    const event: EventEntity = {
      id,
      tenantId: params.tenantId,
      competitionId: params.competitionId,
      homeTeamId: params.homeTeamId,
      awayTeamId: params.awayTeamId,
      scheduledStart: params.scheduledStart,
      status: params.status || 'SCHEDULED',
      homeScore: 0,
      awayScore: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await ctx.events.create(params.tenantId, event);
  }

  public async updateScore(
    tenantId: TenantId,
    eventId: EventId,
    homeScore: number,
    awayScore: number,
    period?: string
  ): Promise<EventEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    const event = await ctx.events.findById(tenantId, eventId);
    if (!event) {
      throw new KaziBetError('NOT_FOUND', `Event ${eventId} not found.`);
    }

    return await ctx.events.update(tenantId, eventId, {
      homeScore,
      awayScore,
      period,
      status: 'LIVE',
      actualStart: event.actualStart || new Date(),
      updatedAt: new Date()
    });
  }

  public async finishEvent(tenantId: TenantId, eventId: EventId): Promise<EventEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    return await ctx.events.update(tenantId, eventId, {
      status: 'FINISHED',
      updatedAt: new Date()
    });
  }

  public async ingestExternalEvent(tenantId: TenantId, payload: ExternalEventPayload): Promise<EventEntity> {
    TenantContextHolder.assertTenant(tenantId);
    const sportId = `sport-${payload.sport}`;
    const comp = await this.getOrCreateCompetition(
      sportId,
      payload.competitionName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      payload.competitionName
    );
    const home = await this.getOrCreateTeam(sportId, payload.homeTeamName);
    const away = await this.getOrCreateTeam(sportId, payload.awayTeamName);

    return await this.createEvent({
      tenantId,
      competitionId: comp.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      scheduledStart: new Date(payload.startTime),
      status: payload.status
    });
  }

  public async listEvents(tenantId: TenantId, filter?: Partial<EventEntity>): Promise<EventEntity[]> {
    TenantContextHolder.assertTenant(tenantId);
    const ctx = this.getContext();
    return await ctx.events.findMany(tenantId, filter);
  }
}
