import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDatabase } from '@kazibet/database';
import { TenantService, TenantContextHolder } from '@kazibet/tenant';
import { AuthService } from '@kazibet/identity';
import { KycService, MockKycProvider } from '@kazibet/compliance';
import { SportsService } from '@kazibet/sports';
import { OddsEngine } from '@kazibet/odds';
import { BetPlacementService } from '@kazibet/betting-engine';
import { SettlementEngine } from '@kazibet/settlement';
import { LedgerEngine, STANDARD_ACCOUNTS } from '@kazibet/ledger';
import { PaymentService, MockPaymentProvider, PaymentReconciliationService } from '@kazibet/payments';
import { AnalyticsAggregator } from '@kazibet/rules';

describe('KaziBet Full End-to-End Sportsbook Lifecycle (Section 53)', () => {
  test('executes complete 18-step betting and financial lifecycle successfully', async () => {
    // 0. System Setup
    const db = new InMemoryDatabase();
    const ctxProvider = () => db.getContext();
    const ledger = new LedgerEngine(db);
    const tenantService = new TenantService(ctxProvider);
    const authService = new AuthService(ctxProvider, 'master-test-jwt-secret-32-chars-long!');
    const mockKyc = new MockKycProvider();
    const kycService = new KycService(db, mockKyc);
    const sports = new SportsService(ctxProvider);
    const oddsEngine = new OddsEngine(ctxProvider);
    const bettingService = new BetPlacementService(db, oddsEngine);
    const settlement = new SettlementEngine(db, ledger);
    const mockPayment = new MockPaymentProvider('secret-key-123');
    const paymentProviders = new Map([['MOCK_SANDBOX', mockPayment]]);
    const paymentService = new PaymentService(db, ledger, paymentProviders);
    const reconService = new PaymentReconciliationService(db);
    const analytics = new AnalyticsAggregator(db);

    // Step 1: Create tenant
    const tenant = await tenantService.provisionTenant({
      code: 'kazi-sports',
      name: 'Kazi Sportsbook OS',
      domain: 'sports.kazi.bet',
      defaultCurrency: 'KES'
    });
    assert.equal(tenant.capabilityStatus, 'SANDBOX');

    const tenantContext = {
      tenantId: tenant.id,
      code: tenant.code,
      domain: tenant.domain,
      currency: tenant.defaultCurrency,
      capabilityStatus: tenant.capabilityStatus
    };

    await TenantContextHolder.run(tenantContext, async () => {
      // Step 2: Configure brand
      await db.getContext().tenants.update(tenant.id, {
        config: {
          brand: {
            name: 'KaziBet Premier',
            primaryColor: '#006600',
            secondaryColor: '#BB0000',
            accentColor: '#FFB800'
          }
        }
      });

      // Step 3: Create users
      const user = await authService.register({
        tenantId: tenant.id,
        email: 'bettor.pro@example.com',
        phoneNumber: '+254712345678',
        password: 'SecurePassword123!'
      });
      assert.equal(user.status, 'ACTIVE');

      // Step 4: Complete sandbox KYC
      const kycResult = await kycService.submitVerification({
        tenantId: tenant.id,
        userId: user.id,
        document: {
          documentType: 'NATIONAL_ID',
          documentNumber: '87654321',
          country: 'KE',
          fullName: 'Maina Kamau',
          dateOfBirth: '1992-08-20'
        }
      });
      assert.equal(kycResult.user.status, 'KYC_VERIFIED');
      assert.equal(kycResult.tier, 2);

      // Step 5: Create virtual wallet and deposit simulated funds (1,000 KES = 100,000 cents)
      const depInit = await paymentService.initiateDeposit({
        tenantId: tenant.id,
        userId: user.id,
        providerName: 'MOCK_SANDBOX',
        amountCents: 100000n,
        currency: 'KES',
        phoneNumber: user.phoneNumber,
        idempotencyKey: 'dep-idem-001'
      });

      const webhookPayload = mockPayment.generateSimulatedWebhookPayload({
        providerTxId: depInit.payment.providerTxId!,
        amountCents: 100000n,
        currency: 'KES',
        status: 'SUCCESS'
      });

      await paymentService.handleWebhook({
        tenantId: tenant.id,
        providerName: 'MOCK_SANDBOX',
        headers: webhookPayload.headers,
        rawBody: webhookPayload.body
      });

      const walletAfterDeposit = await db.getContext().wallets.findFirst(tenant.id, { userId: user.id });
      assert.equal(walletAfterDeposit?.availableCents, 100000n);

      // Step 6: Seed sports
      const activeSports = await sports.getActiveSports();
      assert.ok(activeSports.some(s => s.slug === 'football'));

      // Step 7: Create event (Gor Mahia vs AFC Leopards)
      const event = await sports.createEvent({
        tenantId: tenant.id,
        competitionId: 'comp-kpl',
        homeTeamId: 'team-gor-mahia',
        awayTeamId: 'team-afc-leopards',
        scheduledStart: new Date(Date.now() + 3600000)
      });

      // Step 8: Create market (1X2)
      const { market, selections } = await oddsEngine.createMarketWithSelections({
        tenantId: tenant.id,
        eventId: event.id,
        marketType: '1X2',
        name: 'Full Time Result (1X2)',
        selections: [
          { name: 'Gor Mahia (Home)', odds: 2.50 },
          { name: 'Draw', odds: 3.20 },
          { name: 'AFC Leopards (Away)', odds: 3.80 }
        ]
      });

      // Step 9: Publish odds (Update home odds to 3.00)
      const homeSel = selections[0]!;
      await oddsEngine.updateSelectionOdds(tenant.id, homeSel.id, 3.00, 'ODDS_SURGE');

      // Step 10: Place bet (Stake 200 KES = 20,000 cents at odds 3.00)
      // Step 11: Reserve funds (Wallet Hold)
      const betResult = await bettingService.placeBet({
        tenantId: tenant.id,
        userId: user.id,
        type: 'SINGLE',
        stakeCents: 20000n,
        idempotencyKey: 'bet-idem-001',
        legs: [
          {
            selectionId: homeSel.id,
            marketId: market.id,
            eventId: event.id,
            odds: 3.00
          }
        ]
      });

      assert.equal(betResult.remainingAvailableCents, 80000n); // 1,000 - 200 = 800 KES
      const walletHeld = await db.getContext().wallets.findFirst(tenant.id, { userId: user.id });
      assert.equal(walletHeld?.heldCents, 20000n);

      // Step 12: Finish event (Score 2 - 1 for Gor Mahia)
      await sports.updateScore(tenant.id, event.id, 2, 1, 'Full Time');
      await sports.finishEvent(tenant.id, event.id);

      // Step 13: Settle bet
      // Step 14: Credit winnings
      // Stake 200 KES, Odds 3.00 -> Gross Return 600 KES (60,000 cents).
      // Net winnings = 400 KES (40,000 cents).
      // 20% Withholding Tax = 80 KES (8,000 cents).
      // Net Payout = 520 KES (52,000 cents).
      // Remaining wallet available = 800 + 520 = 1,320 KES (132,000 cents).
      const settleResult = await settlement.settleEventMarkets({
        tenantId: tenant.id,
        eventId: event.id,
        result: { homeScore: 2, awayScore: 1, status: 'FINISHED' },
        taxPercentage: 20.0,
        taxBeneficiary: 'KRA'
      });
      assert.equal(settleResult.settledBetsCount, 1);

      const walletAfterSettlement = await db.getContext().wallets.findFirst(tenant.id, { userId: user.id });
      assert.equal(walletAfterSettlement?.availableCents, 132000n);
      assert.equal(walletAfterSettlement?.heldCents, 0n);

      // Step 15: Request withdrawal (500 KES = 50,000 cents)
      // Step 16: Process simulated payment
      const wthResult = await paymentService.initiateWithdrawal({
        tenantId: tenant.id,
        userId: user.id,
        providerName: 'MOCK_SANDBOX',
        amountCents: 50000n,
        destinationAccount: '+254712345678',
        currency: 'KES',
        idempotencyKey: 'wth-idem-001'
      });
      assert.equal(wthResult.status, 'SUCCESS');

      const walletAfterWithdrawal = await db.getContext().wallets.findFirst(tenant.id, { userId: user.id });
      assert.equal(walletAfterWithdrawal?.availableCents, 82000n); // 132,000 - 50,000 = 82,000 cents

      // Step 17: Reconcile transaction
      const reconStatement = [
        {
          providerTxId: depInit.payment.providerTxId!,
          amountCents: 100000n,
          currency: 'KES',
          status: 'SUCCESS',
          timestamp: new Date().toISOString()
        },
        {
          providerTxId: wthResult.providerTxId!,
          amountCents: 50000n,
          currency: 'KES',
          status: 'SUCCESS',
          timestamp: new Date().toISOString()
        }
      ];

      const reconReport = await reconService.reconcile(tenant.id, 'MOCK_SANDBOX', reconStatement);
      assert.equal(reconReport.discrepancies.length, 0);
      assert.equal(reconReport.matchedCount, 2);

      // Step 18: View audit trail & analytics
      const auditLogs = await db.getContext().auditLogs.findMany(tenant.id);
      assert.ok(auditLogs.length >= 2);

      const financialMetrics = await analytics.computeFinancialMetrics(tenant.id);
      assert.equal(financialMetrics.totalTurnoverCents, 20000n);
      assert.equal(financialMetrics.totalPayoutsCents, 52000n);
      assert.equal(financialMetrics.activeBettorsCount, 1);

      // System Invariant: Double-Entry Ledger Mathematical Proof
      const ledgerAudit = await ledger.auditSystemBalance(tenant.id);
      assert.equal(ledgerAudit.balanced, true);
      assert.equal(ledgerAudit.totalDebits, ledgerAudit.totalCredits);
    });
  });
});
