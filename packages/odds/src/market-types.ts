export type StandardMarketType =
  | '1X2'
  | 'DOUBLE_CHANCE'
  | 'DRAW_NO_BET'
  | 'OVER_UNDER'
  | 'BOTH_TEAMS_TO_SCORE'
  | 'ASIAN_HANDICAP'
  | 'EUROPEAN_HANDICAP'
  | 'CORRECT_SCORE';

export type SuspensionReason =
  | 'VAR_REVIEW'
  | 'GOAL_SCORED'
  | 'RED_CARD'
  | 'PENALTY_AWARDED'
  | 'ODDS_VOLATILITY'
  | 'TECHNICAL_OUTAGE'
  | 'TRADER_MANUAL'
  | 'MATCH_ENDED';

export interface SelectionInput {
  name: string;
  odds: number; // e.g. 1.85
  probability?: number;
}
