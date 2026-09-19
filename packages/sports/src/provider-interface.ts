import { EventStatus, SportSlug } from '@kazibet/shared';

export interface ExternalEventPayload {
  providerId: string;
  sport: SportSlug;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  startTime: string; // ISO 8601
  status: EventStatus;
  score?: {
    home: number;
    away: number;
    period?: string;
  };
}

export interface SportsDataProvider {
  readonly providerName: string;
  getSports(): Promise<SportSlug[]>;
  fetchUpcomingEvents(sport?: SportSlug): Promise<ExternalEventPayload[]>;
  fetchLiveEvents(): Promise<ExternalEventPayload[]>;
  fetchEventDetails(providerId: string): Promise<ExternalEventPayload | null>;
}
