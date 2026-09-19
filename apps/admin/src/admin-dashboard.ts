export function renderAdminDashboard(operatorName = 'KaziBet Operations Center'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${operatorName} — Admin Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; height: 100vh; overflow: hidden; }
    aside { width: 260px; background: #111827; border-right: 1px solid #1f2937; display: flex; flex-direction: column; padding: 20px 0; }
    .nav-brand { padding: 0 24px 20px; font-size: 1.2rem; font-weight: 800; color: #10b981; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; }
    .nav-links { list-style: none; padding: 16px 12px; }
    .nav-links li a { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; color: #9ca3af; text-decoration: none; font-weight: 600; font-size: 0.9rem; margin-bottom: 4px; }
    .nav-links li a:hover, .nav-links li a.active { background: #1f2937; color: #f8fafc; }
    .nav-links li a.active { color: #10b981; }
    main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
    header { height: 65px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; }
    .content { padding: 32px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 32px; }
    .kpi-card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
    .kpi-label { font-size: 0.8rem; color: #9ca3af; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
    .kpi-val { font-size: 1.6rem; font-weight: 800; color: #f8fafc; }
    .kpi-sub { font-size: 0.75rem; color: #10b981; margin-top: 6px; }
    .section-box { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 12px; color: #9ca3af; border-bottom: 1px solid #1f2937; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #1f2937; color: #e5e7eb; }
    .btn-action { padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: none; }
    .btn-danger { background: #ef4444; color: #fff; }
    .btn-primary { background: #10b981; color: #090d16; }
    .copilot-panel { background: #1a2234; border: 1px solid #374151; border-radius: 12px; padding: 20px; }
    .copilot-input { width: 100%; background: #111827; border: 1px solid #374151; border-radius: 8px; color: #f8fafc; padding: 12px; font-size: 0.9rem; margin-top: 12px; }
  </style>
</head>
<body>
  <aside>
    <div class="nav-brand">
      <span>KaziBet Admin</span>
      <span style="font-size:0.65rem;background:#1f2937;color:#f59e0b;padding:2px 6px;border-radius:4px;">SANDBOX</span>
    </div>
    <ul class="nav-links">
      <li><a href="#" class="active">📊 Overview</a></li>
      <li><a href="#">⚽ Live Trading</a></li>
      <li><a href="#">💰 Wallets & Ledger</a></li>
      <li><a href="#">💳 Payments & Recon</a></li>
      <li><a href="#">🛡️ Risk & Fraud</a></li>
      <li><a href="#">👤 KYC & AML</a></li>
      <li><a href="#">📜 Audit Logs</a></li>
      <li><a href="#">⚙️ Tenant Config</a></li>
    </ul>
  </aside>

  <main>
    <header>
      <div style="font-weight:700;font-size:1.1rem;">Operator Console — KaziBet Reference Tenant</div>
      <div style="display:flex;gap:12px;align-items:center;">
        <span style="font-size:0.8rem;color:#9ca3af;">Trading Manager: <strong>trader1@kazi.bet</strong></span>
        <button class="btn-action btn-danger" onclick="alert('Emergency: Market suspension signal broadcast to all live streams.')">Emergency Halt</button>
      </div>
    </header>

    <div class="content">
      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Active Events</div>
          <div class="kpi-val">3</div>
          <div class="kpi-sub">1 Live In-Play</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Turnover</div>
          <div class="kpi-val">KES 450,000</div>
          <div class="kpi-sub">+18% today</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Gross Gaming Revenue (GGR)</div>
          <div class="kpi-val">KES 68,500</div>
          <div class="kpi-sub">Hold Margin: 15.2%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pending Withdrawals</div>
          <div class="kpi-val">2</div>
          <div class="kpi-sub" style="color:#f59e0b;">Maker-checker review</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Risk Cases</div>
          <div class="kpi-val" style="color:#ef4444;">1</div>
          <div class="kpi-sub" style="color:#ef4444;">Rapid bet velocity</div>
        </div>
      </div>

      <!-- Live Events & Trading Table -->
      <div class="section-box">
        <div class="section-title">
          <span>⚡ Live Match Management</span>
          <button class="btn-action btn-primary" onclick="alert('Settlement queue triggered: batch evaluating pending fixtures.')">Run Settlement</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Competition</th>
              <th>Status</th>
              <th>Score</th>
              <th>Markets</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Gor Mahia vs AFC Leopards</strong></td>
              <td>Kenya Premier League</td>
              <td><span style="color:#ef4444;font-weight:700;">LIVE (64')</span></td>
              <td>1 - 0</td>
              <td>Active (3 open)</td>
              <td>
                <button class="btn-action btn-danger" onclick="alert('Market suspended: VAR_REVIEW reason logged.')">Suspend</button>
              </td>
            </tr>
            <tr>
              <td><strong>Arsenal vs Chelsea</strong></td>
              <td>English Premier League</td>
              <td><span style="color:#3b82f6;">SCHEDULED</span></td>
              <td>0 - 0</td>
              <td>Active</td>
              <td>
                <button class="btn-action" style="background:#374151;color:#f8fafc;" onclick="alert('Odds editor opened.')">Edit Odds</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- AI Operations Copilot Box -->
      <div class="section-box copilot-panel">
        <div class="section-title">
          <span>🤖 KaziBet AI Operations Copilot</span>
          <span style="font-size:0.75rem;background:#10b981;color:#090d16;padding:2px 8px;border-radius:9999px;font-weight:800;">MCP CONNECTED</span>
        </div>
        <p style="font-size:0.85rem;color:#9ca3af;">Ask questions regarding settlement discrepancies, risk flags, wallet balances, or payment webhooks:</p>
        <input type="text" class="copilot-input" id="copilot-query" placeholder="e.g. 'Show me today risk cases' or 'Why was user-1 blocked?'"
          onkeydown="if(event.key==='Enter') runCopilot()">
        <div id="copilot-output" style="margin-top:12px;background:#111827;padding:14px;border-radius:8px;font-size:0.85rem;display:none;"></div>
      </div>
    </div>
  </main>

  <script>
    async function runCopilot() {
      const q = document.getElementById('copilot-query').value.trim();
      if (!q) return;
      const out = document.getElementById('copilot-output');
      out.style.display = 'block';
      out.innerHTML = '⏳ <em>AI Copilot evaluating database records and MCP tools...</em>';

      setTimeout(() => {
        if (q.toLowerCase().includes('risk') || q.toLowerCase().includes('fraud')) {
          out.innerHTML = '<strong>Copilot:</strong> Identified 1 active risk case:<br>• [HIGH] RAPID_BET_VELOCITY: User placed 5 wagers in 18 seconds on match Gor Mahia vs AFC Leopards. Automated hold applied. Recommend reviewing IP and device fingerprint before approving withdrawals.';
        } else {
          out.innerHTML = '<strong>Copilot:</strong> All systems operational. 0 double-entry ledger discrepancies detected. Total ledger DR = KES 450,000 | CR = KES 450,000.';
        }
      }, 400);
    }
  </script>
</body>
</html>`;
}
