export function renderSportsbookApp(brandName = 'KaziBet Sportsbook'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — Modern Sportsbook OS</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #121a29;
      --panel-bg: #162032;
      --accent: #10b981;
      --accent-hover: #059669;
      --accent-dim: rgba(16, 185, 129, 0.15);
      --danger: #ef4444;
      --warning: #f59e0b;
      --border: #1e293b;
      --border-light: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; min-height: 100vh; }
    header { background: var(--card-bg); border-bottom: 1px solid var(--border-light); padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand h1 { font-size: 1.35rem; font-weight: 800; color: var(--accent); letter-spacing: -0.5px; }
    .badge-sandbox { background: #1e293b; border: 1px solid var(--border-light); color: var(--warning); font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; font-weight: 700; }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .wallet-pill { background: #1e293b; border: 1px solid var(--border-light); padding: 6px 14px; border-radius: 8px; display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
    .wallet-val { font-weight: 800; color: var(--accent); }
    .wallet-held { font-size: 0.75rem; color: var(--text-muted); }
    
    .btn { padding: 8px 16px; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer; border: none; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-primary { background: var(--accent); color: #090d16; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #1e293b; color: var(--text); border: 1px solid var(--border-light); }
    .btn-secondary:hover { background: #2a374a; }
    .btn-sm { padding: 5px 10px; font-size: 0.75rem; }
    .btn-danger { background: var(--danger); color: #fff; }

    .nav-bar { display: flex; justify-content: space-between; align-items: center; background: #0b111e; padding: 10px 24px; border-bottom: 1px solid var(--border); overflow-x: auto; }
    .nav-sports { display: flex; gap: 8px; }
    .nav-item { padding: 6px 14px; border-radius: 9999px; background: #1a2333; font-size: 0.82rem; font-weight: 600; color: var(--text-muted); cursor: pointer; white-space: nowrap; border: 1px solid transparent; }
    .nav-item.active { background: var(--accent); color: #090d16; font-weight: 700; }
    .filter-group { display: flex; gap: 6px; }
    .filter-btn { padding: 5px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--border-light); color: var(--text-muted); font-size: 0.78rem; font-weight: 600; cursor: pointer; }
    .filter-btn.active { background: var(--border-light); color: var(--text); border-color: var(--accent); }

    .container { display: flex; flex: 1; max-width: 1440px; margin: 0 auto; width: 100%; padding: 20px; gap: 20px; }
    .feed { flex: 1; }
    .bet-slip-panel { width: 380px; background: var(--card-bg); border: 1px solid var(--border-light); border-radius: 12px; padding: 18px; height: fit-content; position: sticky; top: 76px; }

    .match-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; transition: border-color 0.15s; }
    .match-card:hover { border-color: var(--border-light); }
    .match-info { flex: 1; margin-right: 16px; }
    .match-meta { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 6px; }
    .match-teams { font-size: 1.05rem; font-weight: 700; color: var(--text); }
    .badge-live { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 0.7rem; animation: pulse 2s infinite; }
    .badge-scheduled { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem; }

    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

    .odds-row { display: flex; gap: 8px; }
    .odds-btn { background: #1a2333; border: 1px solid var(--border-light); color: var(--text); padding: 8px 12px; border-radius: 8px; min-width: 78px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: background 0.2s, border-color 0.2s; position: relative; }
    .odds-btn:hover:not(:disabled) { border-color: var(--accent); background: #222f44; }
    .odds-btn.selected { background: var(--accent) !important; color: #090d16 !important; border-color: var(--accent) !important; }
    .odds-btn.selected .odds-label { color: #090d16; }
    .odds-btn.selected .odds-val { color: #090d16; }
    .odds-label { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; margin-bottom: 2px; }
    .odds-val { font-size: 0.95rem; font-weight: 800; color: var(--accent); }
    .odds-btn:disabled { opacity: 0.4; cursor: not-allowed; border-style: dashed; }
    .odds-btn.suspended-btn { background: #261b1b; border-color: #5c2424; }
    .odds-btn.suspended-btn .odds-val { color: #f87171; font-size: 0.75rem; }

    /* Flash animations for real-time odds fluctuations */
    .odds-up { animation: flashGreen 1.2s ease; }
    .odds-down { animation: flashRed 1.2s ease; }
    @keyframes flashGreen { 0% { background: rgba(16, 185, 129, 0.6); } 100% { background: #1a2333; } }
    @keyframes flashRed { 0% { background: rgba(239, 68, 68, 0.6); } 100% { background: #1a2333; } }

    /* Bet Slip Styling */
    .slip-leg { background: #1a2333; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; position: relative; }
    .slip-leg.suspended { border-color: var(--danger); background: rgba(239, 68, 68, 0.08); }
    .slip-leg-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
    .slip-leg-name { font-weight: 700; font-size: 0.9rem; }
    .slip-leg-event { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; }
    .slip-leg-odds { font-weight: 800; color: var(--accent); font-size: 0.9rem; }
    .btn-remove-leg { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem; line-height: 1; }
    .btn-remove-leg:hover { color: var(--danger); }
    .badge-leg-suspended { background: var(--danger); color: #fff; font-size: 0.65rem; font-weight: 800; padding: 1px 5px; border-radius: 3px; margin-left: 6px; }

    .quick-chips { display: flex; gap: 6px; margin: 8px 0; }
    .chip { flex: 1; background: #1e293b; border: 1px solid var(--border-light); color: var(--text-muted); font-size: 0.75rem; font-weight: 700; border-radius: 4px; padding: 5px; text-align: center; cursor: pointer; }
    .chip:hover { color: var(--text); border-color: var(--accent); }

    .tax-breakdown { background: #0f1624; border-radius: 8px; padding: 12px; margin: 12px 0; font-size: 0.82rem; border: 1px solid var(--border); }
    .tax-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .tax-row:last-child { margin-bottom: 0; padding-top: 6px; border-top: 1px dashed var(--border-light); font-weight: 800; font-size: 0.95rem; color: var(--accent); }
    .tax-wht { color: var(--warning); }

    /* Modal dialogs */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; z-index: 200; }
    .modal-card { background: var(--panel-bg); border: 1px solid var(--border-light); border-radius: 12px; width: 100%; max-width: 460px; padding: 24px; position: relative; }
    .modal-title { font-size: 1.2rem; font-weight: 800; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .modal-close { background: none; border: none; color: var(--text-muted); font-size: 1.3rem; cursor: pointer; }
    .input-field { width: 100%; background: #0d1421; border: 1px solid var(--border-light); color: #fff; padding: 10px 12px; border-radius: 6px; font-size: 0.95rem; margin-bottom: 12px; }
    .input-field:focus { outline: none; border-color: var(--accent); }
    .modal-tabs { display: flex; border-bottom: 1px solid var(--border-light); margin-bottom: 16px; }
    .modal-tab { flex: 1; text-align: center; padding: 10px; cursor: pointer; font-weight: 700; font-size: 0.88rem; color: var(--text-muted); }
    .modal-tab.active { color: var(--accent); border-bottom: 2px solid var(--accent); }

    .rg-footer { background: #0b111e; border-top: 1px solid var(--border); padding: 12px 24px; font-size: 0.78rem; text-align: center; color: var(--text-muted); }
    .rg-footer a { color: var(--warning); text-decoration: underline; cursor: pointer; margin-left: 6px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>${brandName}</h1>
      <span class="badge-sandbox">SANDBOX OS</span>
    </div>
    <div class="header-actions">
      <!-- Unauthenticated State -->
      <div id="auth-logged-out" style="display: flex; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="openAuthModal('LOGIN')">Sign In</button>
        <button class="btn btn-primary btn-sm" onclick="openAuthModal('REGISTER')">Register</button>
      </div>
      <!-- Authenticated State -->
      <div id="auth-logged-in" style="display: none; align-items: center; gap: 12px;">
        <div class="wallet-pill">
          <div>
            <div style="font-size:0.7rem; color:var(--text-muted);">Available</div>
            <div class="wallet-val" id="disp-avail">KES 0.00</div>
          </div>
          <div style="border-left: 1px solid var(--border-light); padding-left: 8px;">
            <div style="font-size:0.7rem; color:var(--text-muted);">Held</div>
            <div class="wallet-held" id="disp-held">KES 0.00</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openCashierModal('DEPOSIT')">💰 Deposit</button>
        <button class="btn btn-secondary btn-sm" onclick="openCashierModal('WITHDRAW')">Withdraw</button>
        <button class="btn btn-secondary btn-sm" onclick="openMyBetsModal()">📋 My Bets</button>
        <button class="btn btn-secondary btn-sm" onclick="handleLogout()" style="color:var(--text-muted);">Logout</button>
      </div>
    </div>
  </header>

  <nav class="nav-bar">
    <div class="nav-sports">
      <div class="nav-item active" onclick="switchSport('football')">⚽ Football</div>
      <div class="nav-item" onclick="switchSport('basketball')">🏀 Basketball</div>
      <div class="nav-item" onclick="switchSport('tennis')">🎾 Tennis</div>
      <div class="nav-item" onclick="switchSport('cricket')">🏏 Cricket</div>
      <div class="nav-item" onclick="switchSport('rugby')">🏉 Rugby</div>
    </div>
    <div class="filter-group">
      <button class="filter-btn active" id="flt-all" onclick="setFilter('ALL')">All</button>
      <button class="filter-btn" id="flt-live" onclick="setFilter('LIVE')">🔴 Live In-Play</button>
      <button class="filter-btn" id="flt-sched" onclick="setFilter('SCHEDULED')">Upcoming</button>
    </div>
  </nav>

  <div class="container">
    <!-- Center Matches Feed -->
    <main class="feed">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h2 style="font-size:1.15rem; font-weight:800;" id="feed-title">🔥 Live & Upcoming Matches</h2>
        <span id="realtime-status" style="font-size:0.75rem; color:var(--accent); display:flex; align-items:center; gap:4px;">
          <span style="display:inline-block; width:8px; height:8px; background:var(--accent); border-radius:50%;"></span>
          Realtime Feed Connected
        </span>
      </div>

      <div id="matches-container">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading live sportsbook lines...</div>
      </div>
    </main>

    <!-- Right Side Bet Slip -->
    <aside class="bet-slip-panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="font-size:1.05rem; font-weight:800;">Bet Slip</h3>
        <span id="slip-count" style="background:var(--accent); color:#090d16; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:9999px;">0</span>
      </div>

      <div id="slip-legs" style="min-height:120px; font-size:0.85rem; color:var(--text-muted); display:flex; flex-direction:column; justify-content:center; align-items:center; border:1px dashed var(--border-light); border-radius:8px; padding:16px;">
        Click odds on any match to build your accumulator slip
      </div>

      <div id="slip-controls" style="margin-top:14px; border-top:1px solid var(--border-light); padding-top:14px; display:none;">
        <div style="margin-bottom:8px;">
          <label style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:4px; font-weight:600;">Stake (KES):</label>
          <input type="number" id="stake-input" value="100" min="10" max="100000" oninput="recalculateSlip()" class="input-field" style="margin-bottom:4px; font-weight:800; font-size:1.1rem; color:var(--accent);">
          <div class="quick-chips">
            <div class="chip" onclick="addStake(50)">+50</div>
            <div class="chip" onclick="addStake(100)">+100</div>
            <div class="chip" onclick="addStake(500)">+500</div>
            <div class="chip" onclick="addStake(1000)">+1000</div>
          </div>
        </div>

        <!-- 20% Kenya Withholding Tax Breakdown -->
        <div class="tax-breakdown">
          <div class="tax-row">
            <span>Total Odds:</span>
            <strong id="calc-odds" style="color:#fff;">1.00</strong>
          </div>
          <div class="tax-row">
            <span>Gross Return:</span>
            <span id="calc-gross">KES 0.00</span>
          </div>
          <div class="tax-row tax-wht">
            <span>Withholding Tax (20%):</span>
            <span id="calc-wht">KES 0.00</span>
          </div>
          <div class="tax-row">
            <span>Est. Net Payout:</span>
            <span id="calc-net">KES 0.00</span>
          </div>
        </div>

        <div id="slip-error" style="color:var(--danger); font-size:0.8rem; margin-bottom:8px; display:none;"></div>

        <button id="btn-place-bet" class="btn btn-primary" style="width:100%; padding:14px; font-size:1rem;" onclick="submitBetSlip()">
          Place Bet
        </button>
      </div>
    </aside>
  </div>

  <!-- Cashier Modal (Deposit & Withdrawal) -->
  <div class="modal-overlay" id="cashier-modal">
    <div class="modal-card">
      <div class="modal-title">
        <span>💵 Cashier</span>
        <button class="modal-close" onclick="closeModals()">✕</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab active" id="tab-dep" onclick="switchCashierTab('DEPOSIT')">M-Pesa Deposit</div>
        <div class="modal-tab" id="tab-wth" onclick="switchCashierTab('WITHDRAW')">Withdrawal</div>
      </div>

      <!-- Deposit View -->
      <div id="cashier-deposit-view">
        <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:12px;">
          Lipa Na M-Pesa Online STK Push. Enter amount and Safaricom phone number to trigger the PIN prompt.
        </div>
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Amount (KES):</label>
        <input type="number" id="dep-amount" value="500" min="10" max="150000" class="input-field">
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Phone Number (+254...):</label>
        <input type="tel" id="dep-phone" value="254712345678" class="input-field">
        <div id="dep-status-msg" style="font-size:0.82rem; margin-bottom:12px; display:none;"></div>
        <button id="btn-dep-submit" class="btn btn-primary" style="width:100%; padding:12px;" onclick="triggerMpesaDeposit()">
          Initiate M-Pesa STK Push
        </button>
      </div>

      <!-- Withdrawal View -->
      <div id="cashier-withdraw-view" style="display:none;">
        <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:12px;">
          Instant payout to your registered M-Pesa mobile number via Safaricom B2C.
        </div>
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Amount (KES):</label>
        <input type="number" id="wth-amount" value="500" min="50" max="70000" class="input-field">
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Destination Phone:</label>
        <input type="tel" id="wth-phone" value="254712345678" class="input-field">
        <div id="wth-status-msg" style="font-size:0.82rem; margin-bottom:12px; display:none;"></div>
        <button id="btn-wth-submit" class="btn btn-primary" style="width:100%; padding:12px;" onclick="triggerWithdrawal()">
          Request Withdrawal
        </button>
      </div>
    </div>
  </div>

  <!-- My Bets Modal -->
  <div class="modal-overlay" id="mybets-modal">
    <div class="modal-card" style="max-width:580px;">
      <div class="modal-title">
        <span>📋 My Bets</span>
        <button class="modal-close" onclick="closeModals()">✕</button>
      </div>
      <div id="mybets-list" style="max-height:420px; overflow-y:auto;">
        <div style="text-align:center; padding:20px; color:var(--text-muted);">Loading your bets...</div>
      </div>
    </div>
  </div>

  <!-- Auth Modal (Login / Register) -->
  <div class="modal-overlay" id="auth-modal">
    <div class="modal-card">
      <div class="modal-title">
        <span id="auth-title">Sign In</span>
        <button class="modal-close" onclick="closeModals()">✕</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab active" id="tab-login" onclick="switchAuthTab('LOGIN')">Sign In</div>
        <div class="modal-tab" id="tab-reg" onclick="switchAuthTab('REGISTER')">Register</div>
      </div>

      <div id="auth-form">
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Phone Number (Kenyan MSISDN):</label>
        <input type="tel" id="auth-phone" placeholder="0712345678 or +254..." class="input-field">
        <label style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Password:</label>
        <input type="password" id="auth-pass" placeholder="••••••••" class="input-field">
        <div id="auth-error-msg" style="color:var(--danger); font-size:0.82rem; margin-bottom:12px; display:none;"></div>
        <button id="btn-auth-submit" class="btn btn-primary" style="width:100%; padding:12px;" onclick="handleAuthSubmit()">
          Sign In
        </button>
      </div>
    </div>
  </div>

  <footer class="rg-footer">
    ⚠️ <strong>Responsible Gaming:</strong> Betting is strictly forbidden for persons under the age of 18. Gaming can be addictive. Play responsibly.
    <a onclick="alert('Responsible gaming limits, self-exclusion, and reality checks are active.')">Account Protection & Limits</a>
  </footer>

  <script>
    // State
    const API_URL = window.location.origin;
    const TENANT_CODE = 'kazi-sports';
    let authToken = sessionStorage.getItem('kazibet_token') || null;
    let currentUser = null;
    let currentFilter = 'ALL';
    let slipLegs = [];
    let cachedEvents = [];
    let userBalance = { availableCents: 0n, heldCents: 0n };

    // Initialize
    window.addEventListener('DOMContentLoaded', async () => {
      initAuth();
      await loadEvents();
      initRealtime();
    });

    // -------------------------------------------------------------
    // Authentication & Storage
    // -------------------------------------------------------------
    function initAuth() {
      if (authToken) {
        document.getElementById('auth-logged-out').style.display = 'none';
        document.getElementById('auth-logged-in').style.display = 'flex';
        fetchBalance();
      } else {
        document.getElementById('auth-logged-out').style.display = 'flex';
        document.getElementById('auth-logged-in').style.display = 'none';
      }
    }

    function openAuthModal(mode) {
      switchAuthTab(mode);
      document.getElementById('auth-modal').style.display = 'flex';
    }

    function switchAuthTab(mode) {
      const isLogin = mode === 'LOGIN';
      document.getElementById('tab-login').className = isLogin ? 'modal-tab active' : 'modal-tab';
      document.getElementById('tab-reg').className = !isLogin ? 'modal-tab active' : 'modal-tab';
      document.getElementById('auth-title').innerText = isLogin ? 'Sign In' : 'Create Account';
      document.getElementById('btn-auth-submit').innerText = isLogin ? 'Sign In' : 'Register Now';
      document.getElementById('btn-auth-submit').dataset.mode = mode;
      document.getElementById('auth-error-msg').style.display = 'none';
    }

    async function handleAuthSubmit() {
      const mode = document.getElementById('btn-auth-submit').dataset.mode || 'LOGIN';
      const phone = document.getElementById('auth-phone').value.trim();
      const password = document.getElementById('auth-pass').value;
      const errEl = document.getElementById('auth-error-msg');

      if (!phone || !password) {
        errEl.innerText = 'Phone and password are required.';
        errEl.style.display = 'block';
        return;
      }

      const endpoint = mode === 'LOGIN' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Code': TENANT_CODE },
          body: JSON.stringify({ identifier: phone, password, phone })
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.innerText = data.error?.message || 'Authentication failed.';
          errEl.style.display = 'block';
          return;
        }

        authToken = data.token;
        sessionStorage.setItem('kazibet_token', authToken);
        closeModals();
        initAuth();
      } catch (err) {
        errEl.innerText = 'Server communication error.';
        errEl.style.display = 'block';
      }
    }

    function handleLogout() {
      authToken = null;
      sessionStorage.removeItem('kazibet_token');
      initAuth();
    }

    // -------------------------------------------------------------
    // Cashier & Balance
    // -------------------------------------------------------------
    async function fetchBalance() {
      if (!authToken) return;
      try {
        const res = await fetch('/api/v1/cashier/balance', {
          headers: { 'Authorization': 'Bearer ' + authToken, 'X-Tenant-Code': TENANT_CODE }
        });
        if (res.ok) {
          const data = await res.json();
          userBalance.availableCents = BigInt(data.availableCents || 0);
          userBalance.heldCents = BigInt(data.heldCents || 0);
          document.getElementById('disp-avail').innerText = formatCents(userBalance.availableCents);
          document.getElementById('disp-held').innerText = formatCents(userBalance.heldCents);
          recalculateSlip();
        }
      } catch {
        // ignore
      }
    }

    function openCashierModal(tab) {
      if (!authToken) { openAuthModal('LOGIN'); return; }
      switchCashierTab(tab);
      document.getElementById('cashier-modal').style.display = 'flex';
    }

    function switchCashierTab(tab) {
      const isDep = tab === 'DEPOSIT';
      document.getElementById('tab-dep').className = isDep ? 'modal-tab active' : 'modal-tab';
      document.getElementById('tab-wth').className = !isDep ? 'modal-tab active' : 'modal-tab';
      document.getElementById('cashier-deposit-view').style.display = isDep ? 'block' : 'none';
      document.getElementById('cashier-withdraw-view').style.display = !isDep ? 'block' : 'none';
    }

    async function triggerMpesaDeposit() {
      const amountKes = parseFloat(document.getElementById('dep-amount').value);
      const phone = document.getElementById('dep-phone').value.trim();
      const statusMsg = document.getElementById('dep-status-msg');
      const btn = document.getElementById('btn-dep-submit');

      if (isNaN(amountKes) || amountKes <= 0) {
        statusMsg.innerText = 'Enter a valid positive amount.';
        statusMsg.style.color = 'var(--danger)';
        statusMsg.style.display = 'block';
        return;
      }

      btn.disabled = true;
      statusMsg.innerText = '⏳ Triggering M-Pesa STK Push... Check your phone.';
      statusMsg.style.color = 'var(--warning)';
      statusMsg.style.display = 'block';

      try {
        const res = await fetch('/api/v1/cashier/deposit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken,
            'X-Tenant-Code': TENANT_CODE
          },
          body: JSON.stringify({
            amountCents: Math.round(amountKes * 100),
            phoneNumber: phone
          })
        });
        const data = await res.json();
        if (!res.ok) {
          statusMsg.innerText = data.error?.message || 'Deposit failed.';
          statusMsg.style.color = 'var(--danger)';
          btn.disabled = false;
          return;
        }

        statusMsg.innerText = '📲 STK Push sent! Waiting for M-Pesa PIN confirmation...';
        pollDepositStatus(data.paymentId, 0);
      } catch (err) {
        statusMsg.innerText = 'Network error.';
        statusMsg.style.color = 'var(--danger)';
        btn.disabled = false;
      }
    }

    async function pollDepositStatus(paymentId, attempts) {
      const statusMsg = document.getElementById('dep-status-msg');
      const btn = document.getElementById('btn-dep-submit');

      if (attempts > 15) {
        statusMsg.innerText = '⚠️ M-Pesa resolution taking longer than expected. Balance will update shortly.';
        btn.disabled = false;
        fetchBalance();
        return;
      }

      try {
        const res = await fetch('/api/v1/cashier/deposit/status/' + paymentId, {
          headers: { 'Authorization': 'Bearer ' + authToken, 'X-Tenant-Code': TENANT_CODE }
        });
        const data = await res.json();
        if (data.status === 'SUCCESS') {
          statusMsg.innerText = '✅ Deposit confirmed! Your wallet has been credited.';
          statusMsg.style.color = 'var(--accent)';
          btn.disabled = false;
          fetchBalance();
          return;
        } else if (data.status === 'FAILED') {
          statusMsg.innerText = '❌ M-Pesa payment cancelled or failed.';
          statusMsg.style.color = 'var(--danger)';
          btn.disabled = false;
          return;
        }
      } catch {
        // continue polling
      }

      setTimeout(() => pollDepositStatus(paymentId, attempts + 1), 2000);
    }

    async function triggerWithdrawal() {
      const amountKes = parseFloat(document.getElementById('wth-amount').value);
      const phone = document.getElementById('wth-phone').value.trim();
      const statusMsg = document.getElementById('wth-status-msg');
      const btn = document.getElementById('btn-wth-submit');

      if (isNaN(amountKes) || amountKes <= 0) {
        statusMsg.innerText = 'Enter a valid withdrawal amount.';
        statusMsg.style.color = 'var(--danger)';
        statusMsg.style.display = 'block';
        return;
      }

      btn.disabled = true;
      statusMsg.innerText = 'Processing withdrawal...';
      statusMsg.style.color = 'var(--warning)';
      statusMsg.style.display = 'block';

      try {
        const res = await fetch('/api/v1/cashier/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken,
            'X-Tenant-Code': TENANT_CODE
          },
          body: JSON.stringify({
            amountCents: Math.round(amountKes * 100),
            destinationAccount: phone
          })
        });
        const data = await res.json();
        if (!res.ok) {
          statusMsg.innerText = data.error?.message || 'Withdrawal failed.';
          statusMsg.style.color = 'var(--danger)';
          btn.disabled = false;
          return;
        }

        statusMsg.innerText = '✅ Withdrawal initiated successfully via M-Pesa B2C!';
        statusMsg.style.color = 'var(--accent)';
        btn.disabled = false;
        fetchBalance();
      } catch (err) {
        statusMsg.innerText = 'Network error.';
        statusMsg.style.color = 'var(--danger)';
        btn.disabled = false;
      }
    }

    // -------------------------------------------------------------
    // Sports Book & Match Feed
    // -------------------------------------------------------------
    async function loadEvents() {
      try {
        const res = await fetch('/api/v1/events?status=' + currentFilter, {
          headers: { 'X-Tenant-Code': TENANT_CODE }
        });
        if (res.ok) {
          const data = await res.json();
          cachedEvents = data.events || [];
          renderMatches();
        }
      } catch (err) {
        renderFallbackMatches();
      }
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.getElementById('flt-all').className = filter === 'ALL' ? 'filter-btn active' : 'filter-btn';
      document.getElementById('flt-live').className = filter === 'LIVE' ? 'filter-btn active' : 'filter-btn';
      document.getElementById('flt-sched').className = filter === 'SCHEDULED' ? 'filter-btn active' : 'filter-btn';
      loadEvents();
    }

    function switchSport(sport) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
      loadEvents();
    }

    function renderMatches() {
      const container = document.getElementById('matches-container');
      if (!cachedEvents || cachedEvents.length === 0) {
        renderFallbackMatches();
        return;
      }

      let html = '';
      cachedEvents.forEach((ev) => {
        const isLive = ev.status === 'LIVE';
        const badge = isLive
          ? '<span class="badge-live">LIVE ' + (ev.period || '') + '</span>'
          : '<span class="badge-scheduled">SCHEDULED</span>';

        const market = ev.markets?.[0];
        const selections = market?.selections || [];

        let oddsHtml = '';
        if (market?.status === 'SUSPENDED') {
          oddsHtml = '<div style="font-size:0.8rem; color:var(--danger); font-weight:700; padding:8px 12px; border:1px dashed var(--danger); border-radius:6px;">MARKET SUSPENDED</div>';
        } else {
          selections.forEach((sel) => {
            const isSelected = slipLegs.some(l => l.selectionId === sel.id);
            oddsHtml += \`
              <button class="odds-btn \${isSelected ? 'selected' : ''}" id="btn-sel-\${sel.id}"
                onclick="toggleLeg('\${ev.id}', '\${market.id}', '\${sel.id}', '\${escapeHtml(sel.name)}', \${sel.currentOdds})">
                <span class="odds-label">\${escapeHtml(sel.name)}</span>
                <span class="odds-val" id="val-sel-\${sel.id}">\${sel.currentOdds.toFixed(2)}</span>
              </button>
            \`;
          });
        }

        html += \`
          <div class="match-card" id="card-ev-\${ev.id}">
            <div class="match-info">
              <div class="match-meta">
                \${badge}
                <span>\${ev.competitionId || 'Premier League'}</span>
              </div>
              <div class="match-teams" id="teams-ev-\${ev.id}">
                \${ev.homeTeamId || 'Home'} \${isLive ? (ev.homeScore + ' - ' + ev.awayScore) : 'vs'} \${ev.awayTeamId || 'Away'}
              </div>
            </div>
            <div class="odds-row" id="odds-row-\${ev.id}">
              \${oddsHtml}
            </div>
          </div>
        \`;
      });

      container.innerHTML = html;
    }

    function renderFallbackMatches() {
      // Offline / fallback demo matches
      const container = document.getElementById('matches-container');
      container.innerHTML = \`
        <div class="match-card">
          <div class="match-info">
            <div class="match-meta">
              <span class="badge-live">LIVE 67'</span>
              <span>Kenya Premier League</span>
            </div>
            <div class="match-teams">Gor Mahia 1 - 0 AFC Leopards</div>
          </div>
          <div class="odds-row">
            <button class="odds-btn" onclick="toggleLeg('ev-1', 'm-1', 's-1', 'Gor Mahia', 1.25)">
              <span class="odds-label">1</span>
              <span class="odds-val">1.25</span>
            </button>
            <button class="odds-btn" onclick="toggleLeg('ev-1', 'm-1', 's-2', 'Draw', 4.50)">
              <span class="odds-label">X</span>
              <span class="odds-val">4.50</span>
            </button>
            <button class="odds-btn" onclick="toggleLeg('ev-1', 'm-1', 's-3', 'AFC Leopards', 8.50)">
              <span class="odds-label">2</span>
              <span class="odds-val">8.50</span>
            </button>
          </div>
        </div>

        <div class="match-card">
          <div class="match-info">
            <div class="match-meta">
              <span class="badge-scheduled">SCHEDULED</span>
              <span>English Premier League • Today 19:30</span>
            </div>
            <div class="match-teams">Arsenal vs Chelsea</div>
          </div>
          <div class="odds-row">
            <button class="odds-btn" onclick="toggleLeg('ev-2', 'm-2', 's-4', 'Arsenal', 2.15)">
              <span class="odds-label">1</span>
              <span class="odds-val">2.15</span>
            </button>
            <button class="odds-btn" onclick="toggleLeg('ev-2', 'm-2', 's-5', 'Draw', 3.45)">
              <span class="odds-label">X</span>
              <span class="odds-val">3.45</span>
            </button>
            <button class="odds-btn" onclick="toggleLeg('ev-2', 'm-2', 's-6', 'Chelsea', 3.55)">
              <span class="odds-label">2</span>
              <span class="odds-val">3.55</span>
            </button>
          </div>
        </div>
      \`;
    }

    // -------------------------------------------------------------
    // Bet Slip & Tax Engine
    // -------------------------------------------------------------
    function toggleLeg(eventId, marketId, selectionId, name, odds) {
      const existingIdx = slipLegs.findIndex(l => l.selectionId === selectionId);
      if (existingIdx >= 0) {
        slipLegs.splice(existingIdx, 1);
      } else {
        // Disallow multiple selections from same event
        slipLegs = slipLegs.filter(l => l.eventId !== eventId);
        slipLegs.push({ eventId, marketId, selectionId, name, odds, isSuspended: false });
      }

      renderSlipUI();
      renderMatches();
    }

    function removeLeg(index) {
      slipLegs.splice(index, 1);
      renderSlipUI();
      renderMatches();
    }

    function addStake(extra) {
      const input = document.getElementById('stake-input');
      const current = parseFloat(input.value) || 0;
      input.value = current + extra;
      recalculateSlip();
    }

    function renderSlipUI() {
      const container = document.getElementById('slip-legs');
      const controls = document.getElementById('slip-controls');
      document.getElementById('slip-count').innerText = slipLegs.length;

      if (slipLegs.length === 0) {
        container.innerHTML = 'Click odds on any match to build your accumulator slip';
        controls.style.display = 'none';
        return;
      }

      controls.style.display = 'block';
      let html = '';
      slipLegs.forEach((leg, idx) => {
        html += \`
          <div class="slip-leg \${leg.isSuspended ? 'suspended' : ''}">
            <div class="slip-leg-header">
              <span class="slip-leg-name">
                \${escapeHtml(leg.name)}
                \${leg.isSuspended ? '<span class="badge-leg-suspended">SUSPENDED</span>' : ''}
              </span>
              <button class="btn-remove-leg" onclick="removeLeg(\${idx})">✕</button>
            </div>
            <div class="slip-leg-odds">Odds: \${leg.odds.toFixed(2)}</div>
          </div>
        \`;
      });

      container.innerHTML = html;
      recalculateSlip();
    }

    function recalculateSlip() {
      const stakeKes = parseFloat(document.getElementById('stake-input').value) || 0;
      const stakeCents = BigInt(Math.round(stakeKes * 100));

      const totalOdds = slipLegs.reduce((acc, l) => acc * l.odds, 1.0);
      document.getElementById('calc-odds').innerText = totalOdds.toFixed(2);

      const anySuspended = slipLegs.some(l => l.isSuspended);
      const placeBtn = document.getElementById('btn-place-bet');
      const errEl = document.getElementById('slip-error');

      if (anySuspended) {
        placeBtn.disabled = true;
        errEl.innerText = 'Cannot place: one or more legs are currently suspended.';
        errEl.style.display = 'block';
        return;
      }

      if (authToken && userBalance.availableCents < stakeCents) {
        placeBtn.disabled = true;
        errEl.innerText = 'Insufficient wallet balance. Please deposit funds.';
        errEl.style.display = 'block';
      } else {
        placeBtn.disabled = false;
        errEl.style.display = 'none';
      }

      // Financial Calculation
      const oddsScaled = BigInt(Math.round(totalOdds * 10000));
      const grossCents = (stakeCents * oddsScaled) / 10000n;

      let netWinnings = 0n;
      let whtCents = 0n;
      if (grossCents > stakeCents) {
        netWinnings = grossCents - stakeCents;
        // 20% Kenya Withholding Tax
        whtCents = (netWinnings * 2000n + 5000n) / 10000n;
      }

      const netPayoutCents = grossCents - whtCents;

      document.getElementById('calc-gross').innerText = formatCents(grossCents);
      document.getElementById('calc-wht').innerText = formatCents(whtCents);
      document.getElementById('calc-net').innerText = formatCents(netPayoutCents);
    }

    async function submitBetSlip() {
      if (!authToken) {
        openAuthModal('LOGIN');
        return;
      }

      const stakeKes = parseFloat(document.getElementById('stake-input').value) || 0;
      const stakeCents = Math.round(stakeKes * 100);

      const legs = slipLegs.map(l => ({
        selectionId: l.selectionId,
        marketId: l.marketId,
        eventId: l.eventId,
        odds: l.odds
      }));

      const btn = document.getElementById('btn-place-bet');
      btn.disabled = true;
      btn.innerText = 'Placing Wager...';

      try {
        const res = await fetch('/api/v1/bets/place', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken,
            'X-Tenant-Code': TENANT_CODE,
            'Idempotency-Key': 'bet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
          },
          body: JSON.stringify({
            type: legs.length > 1 ? 'ACCUMULATOR' : 'SINGLE',
            stakeCents,
            legs
          })
        });

        const data = await res.json();
        if (!res.ok) {
          alert('Bet Placement Failed: ' + (data.error?.message || 'Server error'));
          btn.disabled = false;
          btn.innerText = 'Place Bet';
          return;
        }

        alert('🎉 Bet Placed Successfully!\\nSlip ID: ' + data.betSlip.id + '\\nStake: KES ' + stakeKes);
        slipLegs = [];
        renderSlipUI();
        renderMatches();
        fetchBalance();
      } catch (err) {
        alert('Network error while placing bet.');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Place Bet';
      }
    }

    // -------------------------------------------------------------
    // My Bets & Cashout
    // -------------------------------------------------------------
    async function openMyBetsModal() {
      if (!authToken) { openAuthModal('LOGIN'); return; }
      document.getElementById('mybets-modal').style.display = 'flex';
      const container = document.getElementById('mybets-list');
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Fetching your bets...</div>';

      try {
        const res = await fetch('/api/v1/bets', {
          headers: { 'Authorization': 'Bearer ' + authToken, 'X-Tenant-Code': TENANT_CODE }
        });
        const data = await res.json();
        const bets = data.bets || [];

        if (bets.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">No bets placed yet.</div>';
          return;
        }

        let html = '';
        bets.forEach(b => {
          const isOpen = b.status === 'PLACED';
          const badgeClass = isOpen ? 'badge-scheduled' : b.status === 'WON' ? 'badge-live' : '';

          html += \`
            <div style="background:#121a29; border:1px solid var(--border-light); border-radius:8px; padding:14px; margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                <span style="font-weight:700;">Bet #\${b.id.slice(0,8)}</span>
                <span class="\${badgeClass}">\${b.status}</span>
              </div>
              <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:8px;">
                Stake: <strong>\${formatCents(BigInt(b.stakeCents))}</strong> • Odds: <strong>\${b.odds}</strong> • Est. Payout: <strong>\${formatCents(BigInt(b.potentialPayoutCents))}</strong>
              </div>
              \${isOpen ? \`
                <button class="btn btn-secondary btn-sm" onclick="executeCashout('\${b.id}')" style="border-color:var(--accent); color:var(--accent);">
                  ⚡ Instant Cashout
                </button>
              \` : ''}
            </div>
          \`;
        });
        container.innerHTML = html;
      } catch {
        container.innerHTML = '<div style="color:var(--danger); padding:20px;">Failed to load bets.</div>';
      }
    }

    async function executeCashout(betId) {
      if (!confirm('Confirm cashout for this bet?')) return;
      try {
        const res = await fetch('/api/v1/bets/' + betId + '/cashout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'X-Tenant-Code': TENANT_CODE }
        });
        const data = await res.json();
        if (res.ok) {
          alert('✅ Bet cashed out! Payout credited to your wallet.');
          fetchBalance();
          openMyBetsModal();
        } else {
          alert('Cashout Failed: ' + (data.error?.message || 'Error'));
        }
      } catch {
        alert('Network error.');
      }
    }

    // -------------------------------------------------------------
    // Realtime Updates (SSE / WebSocket)
    // -------------------------------------------------------------
    function initRealtime() {
      const sseUrl = '/events?tenantId=' + TENANT_CODE + '&channel=global';
      try {
        const es = new EventSource(sseUrl);
        es.addEventListener('ODDS_UPDATED', (e) => {
          try {
            const data = JSON.parse(e.data);
            handleRealtimeOdds(data);
          } catch {}
        });

        es.addEventListener('MARKET_SUSPENDED', (e) => {
          try {
            const data = JSON.parse(e.data);
            handleRealtimeSuspension(data);
          } catch {}
        });

        es.onerror = () => {
          document.getElementById('realtime-status').innerHTML = '<span style="display:inline-block; width:8px; height:8px; background:var(--warning); border-radius:50%;"></span> Feed Polling';
        };
      } catch {
        // EventSource not available or cross-origin
      }
    }

    function handleRealtimeOdds(data) {
      if (!data.selections) return;
      data.selections.forEach(sel => {
        const valEl = document.getElementById('val-sel-' + sel.id);
        const btnEl = document.getElementById('btn-sel-' + sel.id);

        if (valEl && btnEl) {
          const oldOdds = parseFloat(valEl.innerText) || sel.odds;
          valEl.innerText = sel.odds.toFixed(2);

          // Visual price animation
          btnEl.classList.remove('odds-up', 'odds-down');
          void btnEl.offsetWidth; // trigger reflow
          if (sel.odds > oldOdds) {
            btnEl.classList.add('odds-up');
          } else if (sel.odds < oldOdds) {
            btnEl.classList.add('odds-down');
          }
        }

        // Update in open bet slip
        const slipLeg = slipLegs.find(l => l.selectionId === sel.id);
        if (slipLeg) {
          slipLeg.odds = sel.odds;
          renderSlipUI();
        }
      });
    }

    function handleRealtimeSuspension(data) {
      // Auto-suspend bet slip if leg is in slip
      slipLegs.forEach(leg => {
        if (leg.marketId === data.marketId) {
          leg.isSuspended = true;
        }
      });
      renderSlipUI();

      // Disable match card odds button
      const row = document.getElementById('odds-row-' + data.eventId);
      if (row) {
        row.innerHTML = '<div style="font-size:0.8rem; color:var(--danger); font-weight:700; padding:8px 12px; border:1px dashed var(--danger); border-radius:6px;">MARKET SUSPENDED</div>';
      }
    }

    // -------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------
    function formatCents(cents) {
      const s = cents / 100n;
      const r = cents % 100n;
      return 'KES ' + s.toLocaleString() + '.' + r.toString().padStart(2, '0');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function closeModals() {
      document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    }
  </script>
</body>
</html>`;
}
