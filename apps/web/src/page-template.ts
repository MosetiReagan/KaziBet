import { SportsbookUI } from '@kazibet/ui';

export function renderSportsbookApp(brandName = 'KaziBet Sportsbook'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — Sportsbook OS</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090d16; color: #f8fafc; display: flex; flex-direction: column; min-height: 100vh; }
    header { background: #121a29; border-bottom: 1px solid #334155; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 50; }
    .nav-sports { display: flex; gap: 8px; background: #0f172a; padding: 10px 24px; border-bottom: 1px solid #1e293b; overflow-x: auto; }
    .nav-item { padding: 8px 16px; border-radius: 9999px; background: #1e293b; font-size: 0.85rem; font-weight: 600; color: #94a3b8; text-decoration: none; cursor: pointer; white-space: nowrap; }
    .nav-item.active { background: #10b981; color: #090d16; }
    .container { display: flex; flex: 1; max-width: 1400px; margin: 0 auto; width: 100%; padding: 24px; gap: 24px; }
    .feed { flex: 1; }
    .bet-slip-panel { width: 360px; background: #121a29; border: 1px solid #334155; border-radius: 12px; padding: 20px; height: fit-content; position: sticky; top: 80px; }
    .match-card { background: #121a29; border: 1px solid #1e293b; border-radius: 12px; padding: 18px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .match-teams { font-size: 1.1rem; font-weight: 700; margin-bottom: 6px; }
    .match-meta { font-size: 0.8rem; color: #94a3b8; display: flex; gap: 8px; align-items: center; }
    .odds-group { display: flex; gap: 8px; }
    .odds-btn { background: #1e293b; border: 1px solid #334155; color: #f8fafc; padding: 8px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; flex-direction: column; align-items: center; min-width: 75px; transition: all 0.15s; }
    .odds-btn:hover { border-color: #10b981; background: #243247; }
    .odds-btn.selected { background: #10b981; color: #090d16; border-color: #10b981; }
    .odds-val { font-size: 1rem; font-weight: 700; color: #10b981; }
    .odds-btn.selected .odds-val { color: #090d16; }
    .odds-label { font-size: 0.75rem; color: #94a3b8; }
    .odds-btn.selected .odds-label { color: #090d16; }
    .btn-place { background: #10b981; color: #090d16; font-weight: 800; font-size: 1rem; border: none; border-radius: 8px; width: 100%; padding: 14px; cursor: pointer; margin-top: 16px; }
    .btn-place:hover { background: #059669; }
    .rg-banner { background: #1e293b; border-top: 1px solid #334155; padding: 12px; text-align: center; font-size: 0.8rem; color: #94a3b8; }
    .rg-banner a { color: #f59e0b; text-decoration: underline; margin-left: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div style="display:flex;align-items:center;gap:12px;">
      <h1 style="font-size:1.4rem;font-weight:800;color:#10b981;">${brandName}</h1>
      <span style="background:#1e293b;border:1px solid #334155;color:#f59e0b;font-size:0.7rem;padding:2px 8px;border-radius:9999px;font-weight:700;">SANDBOX</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;">
      <div style="background:#1e293b;padding:6px 14px;border-radius:8px;border:1px solid #334155;">
        <span style="font-size:0.75rem;color:#94a3b8;">Wallet:</span>
        <strong id="balance-display" style="font-size:1rem;color:#10b981;margin-left:4px;">KES 1,000.00</strong>
      </div>
      <button onclick="alert('Sandbox: Virtual deposit of KES 500 added to simulated wallet!')" style="background:#10b981;color:#090d16;border:none;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer;">Deposit</button>
    </div>
  </header>

  <nav class="nav-sports">
    <div class="nav-item active">⚽ Football</div>
    <div class="nav-item">🏀 Basketball</div>
    <div class="nav-item">🎾 Tennis</div>
    <div class="nav-item">🏏 Cricket</div>
    <div class="nav-item">🏉 Rugby</div>
    <div class="nav-item" style="color:#ef4444;">🔴 Live In-Play</div>
  </nav>

  <div class="container">
    <main class="feed">
      <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:16px;color:#f8fafc;">🔥 Live & Upcoming Fixtures</h2>

      <!-- Match 1 -->
      <div class="match-card">
        <div>
          <div class="match-meta">
            ${SportsbookUI.renderBadge('LIVE')}
            <span>Kenya Premier League • 64'</span>
          </div>
          <div class="match-teams" style="margin-top:6px;">Gor Mahia 1 - 0 AFC Leopards</div>
        </div>
        <div class="odds-group">
          <button class="odds-btn" onclick="addToSlip('Gor Mahia (Home)', 1.25, 'm1')">
            <span class="odds-label">1</span>
            <span class="odds-val">1.25</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('Draw', 4.80, 'm1')">
            <span class="odds-label">X</span>
            <span class="odds-val">4.80</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('AFC Leopards (Away)', 9.50, 'm1')">
            <span class="odds-label">2</span>
            <span class="odds-val">9.50</span>
          </button>
        </div>
      </div>

      <!-- Match 2 -->
      <div class="match-card">
        <div>
          <div class="match-meta">
            ${SportsbookUI.renderBadge('SCHEDULED')}
            <span>English Premier League • Today 19:30</span>
          </div>
          <div class="match-teams" style="margin-top:6px;">Arsenal vs Chelsea</div>
        </div>
        <div class="odds-group">
          <button class="odds-btn" onclick="addToSlip('Arsenal (Home)', 2.10, 'm2')">
            <span class="odds-label">1</span>
            <span class="odds-val">2.10</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('Draw', 3.40, 'm2')">
            <span class="odds-label">X</span>
            <span class="odds-val">3.40</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('Chelsea (Away)', 3.60, 'm2')">
            <span class="odds-label">2</span>
            <span class="odds-val">3.60</span>
          </button>
        </div>
      </div>

      <!-- Match 3 -->
      <div class="match-card">
        <div>
          <div class="match-meta">
            ${SportsbookUI.renderBadge('SCHEDULED')}
            <span>UEFA Champions League • Tomorrow 21:00</span>
          </div>
          <div class="match-teams" style="margin-top:6px;">Real Madrid vs Bayern Munich</div>
        </div>
        <div class="odds-group">
          <button class="odds-btn" onclick="addToSlip('Real Madrid (Home)', 2.25, 'm3')">
            <span class="odds-label">1</span>
            <span class="odds-val">2.25</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('Draw', 3.50, 'm3')">
            <span class="odds-label">X</span>
            <span class="odds-val">3.50</span>
          </button>
          <button class="odds-btn" onclick="addToSlip('Bayern Munich (Away)', 3.10, 'm3')">
            <span class="odds-label">2</span>
            <span class="odds-val">3.10</span>
          </button>
        </div>
      </div>
    </main>

    <aside class="bet-slip-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="font-size:1.1rem;font-weight:700;">Bet Slip</h3>
        <span id="slip-count" style="background:#10b981;color:#090d16;font-size:0.75rem;font-weight:800;padding:2px 8px;border-radius:9999px;">0</span>
      </div>

      <div id="slip-items" style="min-height:100px;font-size:0.85rem;color:#94a3b8;display:flex;flex-direction:column;justify-content:center;align-items:center;border:1px dashed #334155;border-radius:8px;padding:16px;">
        Click odds on any match to add selections
      </div>

      <div style="margin-top:16px;border-top:1px solid #334155;padding-top:16px;">
        <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:8px;">
          <span>Total Odds:</span>
          <strong id="total-odds" style="color:#10b981;">1.00</strong>
        </div>

        <div style="margin-bottom:12px;">
          <label style="font-size:0.8rem;color:#94a3b8;display:block;margin-bottom:4px;">Stake (KES):</label>
          <input type="number" id="stake-input" value="100" min="10" max="100000" oninput="updatePayout()"
            style="width:100%;background:#1e293b;border:1px solid #334155;color:#f8fafc;padding:10px;border-radius:6px;font-weight:700;font-size:1rem;">
        </div>

        <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;">
          <span>Est. Return:</span>
          <span id="est-payout" style="color:#10b981;">KES 100.00</span>
        </div>

        <button class="btn-place" onclick="placeBetSlip()">Place Bet</button>
      </div>
    </aside>
  </div>

  <footer class="rg-banner">
    ⚠️ <strong>Responsible Gaming:</strong> Gambling can be addictive. Play responsibly. 18+ only.
    <a onclick="alert('Responsible gaming: self-exclusion options and deposit limits are available in account settings.')">Set Limits or Self-Exclude</a>
  </footer>

  <script>
    let selections = [];

    function addToSlip(name, odds, eventId) {
      // replace if same event
      selections = selections.filter(s => s.eventId !== eventId);
      selections.push({ name, odds, eventId });
      renderSlip();
    }

    function removeSel(index) {
      selections.splice(index, 1);
      renderSlip();
    }

    function renderSlip() {
      const container = document.getElementById('slip-items');
      document.getElementById('slip-count').innerText = selections.length;

      if (selections.length === 0) {
        container.innerHTML = 'Click odds on any match to add selections';
        document.getElementById('total-odds').innerText = '1.00';
        updatePayout();
        return;
      }

      let html = '';
      let totalOdds = 1.0;
      selections.forEach((s, idx) => {
        totalOdds *= s.odds;
        html += \`
          <div style="background:#1e293b;border-radius:6px;padding:8px 12px;margin-bottom:8px;width:100%;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;color:#f8fafc;">\${s.name}</div>
              <div style="font-size:0.75rem;color:#10b981;">Odds: \${s.odds.toFixed(2)}</div>
            </div>
            <button onclick="removeSel(\${idx})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-weight:800;">✕</button>
          </div>
        \`;
      });

      container.innerHTML = html;
      document.getElementById('total-odds').innerText = totalOdds.toFixed(2);
      updatePayout();
    }

    function updatePayout() {
      const stake = parseFloat(document.getElementById('stake-input').value) || 0;
      const odds = parseFloat(document.getElementById('total-odds').innerText) || 1.0;
      const payout = (stake * odds).toFixed(2);
      document.getElementById('est-payout').innerText = 'KES ' + payout;
    }

    function placeBetSlip() {
      if (selections.length === 0) {
        alert('Please add at least one selection to your bet slip.');
        return;
      }
      const stake = parseFloat(document.getElementById('stake-input').value) || 0;
      const payout = document.getElementById('est-payout').innerText;
      alert(\`🎉 Bet successfully placed in Sandbox!\\nStake: KES \${stake}\\nPotential Payout: \${payout}\\nDouble-entry ledger hold has been reserved.\`);
      selections = [];
      renderSlip();
    }
  </script>
</body>
</html>`;
}
