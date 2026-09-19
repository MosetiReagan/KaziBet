import { DEFAULT_DARK_THEME, ThemeColors } from './theme.js';

export class SportsbookUI {
  public static renderBadge(status: string): string {
    const isLive = status === 'LIVE';
    const isFinished = status === 'FINISHED';
    const bg = isLive ? '#ef4444' : isFinished ? '#64748b' : '#3b82f6';
    return `<span style="background:${bg};color:#fff;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:9999px;text-transform:uppercase;letter-spacing:0.05em;">${status}</span>`;
  }

  public static renderOddsButton(params: {
    selectionId: string;
    label: string;
    odds: number;
    suspended?: boolean;
  }): string {
    const disabledAttr = params.suspended ? 'disabled' : '';
    const opacity = params.suspended ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
    return `
      <button class="odds-btn" data-selection-id="${params.selectionId}" data-odds="${params.odds}" ${disabledAttr}
        style="background:#1e293b;border:1px solid #334155;color:#f8fafc;padding:8px 12px;border-radius:6px;font-weight:600;display:flex;justify-content:space-between;align-items:center;min-width:100px;${opacity}transition:all 0.15s ease;">
        <span style="font-size:0.8rem;color:#94a3b8;">${params.label}</span>
        <span style="font-size:0.95rem;color:#10b981;margin-left:8px;">${params.suspended ? '🔒' : params.odds.toFixed(2)}</span>
      </button>
    `;
  }

  public static renderHeader(brandName: string, availableBalanceFormatted: string): string {
    return `
      <header style="background:#121a29;border-bottom:1px solid #334155;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:1.4rem;font-weight:800;letter-spacing:-0.03em;color:#10b981;">${brandName}</div>
          <span style="background:#334155;color:#94a3b8;font-size:0.7rem;padding:2px 6px;border-radius:4px;font-weight:600;">SANDBOX</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="background:#1e293b;padding:6px 14px;border-radius:8px;border:1px solid #334155;">
            <span style="font-size:0.75rem;color:#94a3b8;margin-right:6px;">Balance:</span>
            <span style="font-size:0.95rem;font-weight:700;color:#f8fafc;">${availableBalanceFormatted}</span>
          </div>
          <button style="background:#10b981;color:#090d16;font-weight:700;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;">Deposit</button>
        </div>
      </header>
    `;
  }
}
