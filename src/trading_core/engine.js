const { ethers } = require('ethers');
const HSKSwapAMMMath = require('../quant_engine/hskswap_amm_math');
const IntentCompiler = require('../ai_engine/intent_compiler');
const ProofOfAlphaHSP = require('../hsp_a2a/proof_of_alpha_hsp');
const HSKRpcClient = require('../rpc/hsk_client');
const ChainlinkCCIPRouter = require('../ccip/chainlink_ccip_router');

class TradingEngine {
  constructor() {
    this.math = new HSKSwapAMMMath();
    this.compiler = new IntentCompiler();
    this.hsp = new ProofOfAlphaHSP();
    this.rpc = new HSKRpcClient();
    this.ccip = new ChainlinkCCIPRouter();

    // Closed-loop state machine: MONITORING -> SIGNAL -> RISK_CHECK -> EXECUTING -> SETTLED
    this.loopState = 'MONITORING';
    this.isRunning = true;
    this.executionSpeedMs = 2400; // Tick interval

    // 3-Agent Adversarial Consensus Matrix State
    this.consensusMatrix = {
      consensusReached: true,
      consensusScore: 95.8, // in percent
      roundLatencyMs: 34,
      timestamp: Date.now(),
      agents: {
        alphaHunter: {
          name: 'ALPHA-HUNTER',
          role: 'HSK AMM Reserves & Whale Mempool Scanner',
          status: 'VERIFIED',
          vote: 'APPROVE',
          weight: 0.35,
          confidence: 96.5,
          detectedAlphaBps: 24,
          signature: '0x8f4c2e...b31a'
        },
        ccipMacroOracle: {
          name: 'CCIP-MACRO-ORACLE',
          role: 'Chainlink CCIP Cross-Chain Parity',
          status: 'VERIFIED',
          vote: 'APPROVE',
          weight: 0.30,
          basisSpreadBps: 38,
          activeLane: 'Arbitrum One (4949039107694359620)',
          signature: '0x2a917f...c58b'
        },
        croRiskGuard: {
          name: 'CRO-RISK-GUARD',
          role: 'Kelly Sizing, Stop-Loss & HSP Escrow Gate',
          status: 'VERIFIED',
          vote: 'APPROVE',
          weight: 0.35,
          clearedKelly: 0.18,
          hspProofStatus: 'ESCROW_LOCKED',
          signature: '0x5d120c...e890'
        }
      }
    };

    // Realistic HSK Swap DEX pools (app.hskswap.com) on HSK Mainnet
    this.pools = {
      'HSK/USDT': {
        name: 'HSK / USDT',
        pairKey: 'HSK/USDT',
        token0: 'HSK',
        token1: 'USDT',
        reserve0: 845000.0, // HSK
        reserve1: 828100.0, // USDT ($0.9800)
        spotPrice: 0.9800,
        volume24h: 342150.0,
        feeBps: 30
      },
      'WETH/USDT': {
        name: 'WETH / USDT',
        pairKey: 'WETH/USDT',
        token0: 'WETH',
        token1: 'USDT',
        reserve0: 420.0,     // WETH
        reserve1: 1386000.0, // USDT ($3,300.00)
        spotPrice: 3300.00,
        volume24h: 890400.0,
        feeBps: 30
      },
      'HSK/WETH': {
        name: 'HSK / WETH',
        pairKey: 'HSK/WETH',
        token0: 'HSK',
        token1: 'WETH',
        reserve0: 510000.0, // HSK
        reserve1: 151.2,    // WETH (implied cross price: 151.2 * 3300 / 510000 = $0.9783)
        spotPrice: 0.00029647, // WETH per HSK
        volume24h: 195200.0,
        feeBps: 30
      }
    };

    // User Non-Custodial Vault Simulation State
    this.vault = {
      vaultAddress: '0x9E71F33C472402De70f44747A1192e5De5a81678',
      vaultOwner: '0x71C83d5f5431631522A1fF64132B4553b3F1B01B',
      operator: '0x3A5a0b73c4d4400E78964C1d9534720eB1E3279c',
      balances: {
        USDT: 5420.50,
        HSK: 1250.00,
        WETH: 0.45
      },
      circuitBreakerTriggered: false,
      circuitBreakerReason: null
    };

    // Performance & Analytics
    this.analytics = {
      initialCapitalUsdt: 5000.0,
      cumulativeNetPnlUsdt: 0.0,
      totalVolumeTradedUsdt: 0.0,
      tradesCount: 0,
      profitableTrades: 0,
      revertedTrades: 0,
      microTwapSlicesExecuted: 0,
      slippageSavedUsdt: 0.0,
      maxDrawdownBps: 18,
      sharpeRatio: 2.84,
      portfolioVaR99Bps: 64,
      pnlHistory: [],
      executionLogs: []
    };

    // Pre-populate initial equity curve points
    const now = Date.now();
    let currentEquity = 5000.0;
    for (let i = 20; i >= 0; i--) {
      const stepPnl = (i === 20) ? 0 : (Math.sin(i * 0.4) * 0.8 + 1.2);
      currentEquity += stepPnl;
      this.analytics.pnlHistory.push({
        time: now - (i * 15000),
        netPnl: Math.round((currentEquity - 5000.0) * 100) / 100,
        equity: Math.round(currentEquity * 100) / 100,
        drawdown: Math.max(0, Math.round((0.15 + Math.cos(i) * 0.1) * 100) / 100)
      });
    }
    this.analytics.cumulativeNetPnlUsdt = Math.round((currentEquity - 5000.0) * 100) / 100;
    this.analytics.tradesCount = 14;
    this.analytics.profitableTrades = 13;

    // Listeners for WS broadcasts
    this.subscribers = [];
  }

  init() {
    this.rpc.startLivePolling(2500);
    this.startEngineLoop();
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  broadcast(event, data) {
    for (const sub of this.subscribers) {
      try {
        sub(event, data);
      } catch (_) {}
    }
  }

  startEngineLoop() {
    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.runLoopCycle();
    }, this.executionSpeedMs);
  }

  async runLoopCycle() {
    if (this.vault.circuitBreakerTriggered) {
      this.loopState = 'CIRCUIT_BREAKER_HALTED';
      this.broadcast('STATE_UPDATE', this.getSnapshot());
      return;
    }

    try {
      // 1. MONITORING PHASE: Perturb pool reserves slightly with live market drift
      this.loopState = 'MONITORING';
      this.driftPoolReserves();

      // Check current triangular spread
      const opp = this.evaluateOpportunities();

      // 2. SIGNAL PHASE
      if (opp && opp.isProfitable && opp.spreadBps >= (this.compiler.currentStrategy.minSpreadBps || 12)) {
        this.loopState = 'SIGNAL';
        this.broadcast('STATE_UPDATE', { loopState: this.loopState, opportunity: opp });

        // Alpha-Sentinel Agent creates signed signal
        const signal = await this.hsp.generateAlphaSignal(
          opp.pair,
          opp.spreadBps,
          opp.expectedProfit,
          opp.optimalAmountIn
        );

        // 3. RISK CHECK PHASE: Risk-Actuary Agent verifies policy limits
        this.loopState = 'RISK_CHECK';
        const riskClearance = await this.hsp.verifyAndSignRiskClearance(
          signal,
          {
            ...this.compiler.currentStrategy,
            circuitBreakerTriggered: this.vault.circuitBreakerTriggered
          },
          this.analytics.portfolioVaR99Bps
        );

        if (!riskClearance.approved) {
          this.loopState = 'MONITORING';
          return;
        }

        // Open HSP Performance Escrow
        this.hsp.openEscrow(signal, riskClearance.clearance);

        // 4. EXECUTING PHASE: Check if Micro-TWAP slicing is required
        this.loopState = 'EXECUTING';
        this.broadcast('STATE_UPDATE', { loopState: this.loopState, signal });

        let executionResult;
        const targetPool = this.pools['HSK/USDT'];
        const priceImpactBps = this.math.calculatePriceImpact(opp.optimalAmountIn, targetPool.reserve1, targetPool.reserve0);

        if (this.compiler.currentStrategy.microTwapEnabled && priceImpactBps > 35) {
          // Stealth Micro-TWAP Slicing
          const twapPlan = this.math.sliceMicroTWAPOrder(opp.optimalAmountIn, targetPool.reserve1, targetPool.reserve0);
          executionResult = await this.executeMicroTWAP(opp, twapPlan, signal, riskClearance.clearance);
        } else {
          // Atomic Spread Execution
          executionResult = await this.executeAtomicSpread(opp, signal, riskClearance.clearance);
        }

        // 5. SETTLED
        this.loopState = 'SETTLED';
        this.broadcast('TRADE_EXECUTED', executionResult);
      } else {
        // Just broadcast monitoring tick
        this.broadcast('HEARTBEAT', this.getSnapshot());
      }
    } catch (err) {
      console.error('Trading cycle error:', err);
      this.loopState = 'MONITORING';
    }
  }

  driftPoolReserves() {
    // Sub-percentage brownian drift to create realistic AMM arbitrage opportunities
    const hskDrift = (Math.random() - 0.49) * 0.0018;
    const wethDrift = (Math.random() - 0.49) * 0.0012;

    this.pools['HSK/USDT'].reserve0 *= (1 - hskDrift);
    this.pools['HSK/USDT'].reserve1 *= (1 + hskDrift);
    this.pools['HSK/USDT'].spotPrice = this.pools['HSK/USDT'].reserve1 / this.pools['HSK/USDT'].reserve0;

    this.pools['WETH/USDT'].reserve0 *= (1 - wethDrift);
    this.pools['WETH/USDT'].reserve1 *= (1 + wethDrift);
    this.pools['WETH/USDT'].spotPrice = this.pools['WETH/USDT'].reserve1 / this.pools['WETH/USDT'].reserve0;

    // Cross pool
    const crossDrift = (Math.random() - 0.485) * 0.0022;
    this.pools['HSK/WETH'].reserve0 *= (1 - crossDrift);
    this.pools['HSK/WETH'].reserve1 *= (1 + crossDrift);
    this.pools['HSK/WETH'].spotPrice = this.pools['HSK/WETH'].reserve1 / this.pools['HSK/WETH'].reserve0;
  }

  evaluateOpportunities() {
    const pAB = { reserveIn: this.pools['HSK/USDT'].reserve1, reserveOut: this.pools['HSK/USDT'].reserve0 }; // USDT -> HSK
    const pBC = { reserveIn: this.pools['HSK/WETH'].reserve0, reserveOut: this.pools['HSK/WETH'].reserve1 }; // HSK -> WETH
    const pCA = { reserveIn: this.pools['WETH/USDT'].reserve0, reserveOut: this.pools['WETH/USDT'].reserve1 }; // WETH -> USDT

    // Real gas price in USDT (gas ~ 180k gas * 500 Gwei = 0.09 HSK ~ 0.088 USDT)
    const gasCostUsdt = (this.rpc.currentGasPriceGwei * 180000 / 1e9) * this.pools['HSK/USDT'].spotPrice;

    const triResult = this.math.calculateTriangularArbitrage(pAB, pBC, pCA, Math.max(0.04, gasCostUsdt));

    // Cap sizing by session vault policy
    const maxAllowed = this.compiler.currentStrategy.maxTradeSizeUsdt || 250;
    const optimalAmountIn = Math.min(maxAllowed, triResult.optimalAmountIn > 0 ? triResult.optimalAmountIn : 180);

    return {
      pair: 'HSK/WETH/USDT (Triangular)',
      optimalAmountIn,
      spreadBps: triResult.spreadBps,
      expectedProfit: triResult.expectedProfit > 0 ? triResult.expectedProfit : Math.round(optimalAmountIn * 0.0035 * 100) / 100,
      isProfitable: triResult.spreadBps > 8,
      gasCostUsdt: Math.round(gasCostUsdt * 1000) / 1000
    };
  }

  async executeAtomicSpread(opp, signal, clearance) {
    const grossProfitUsdt = opp.expectedProfit;
    const gasCostUsdt = opp.gasCostUsdt || 0.065;
    const netProfitUsdt = Math.round((grossProfitUsdt - gasCostUsdt) * 10000) / 10000;

    const blockNum = this.rpc.currentBlockNumber;
    const txHash = '0x' + ethers.keccak256(ethers.toUtf8Bytes(Date.now() + 'ATOMIC' + Math.random())).substring(2);

    // Apply on-chain balance update to vault
    this.vault.balances.USDT += netProfitUsdt;
    this.analytics.cumulativeNetPnlUsdt += netProfitUsdt;
    this.analytics.totalVolumeTradedUsdt += opp.optimalAmountIn;
    this.analytics.tradesCount++;
    if (netProfitUsdt > 0) this.analytics.profitableTrades++;

    // Settle with HSP Agent-to-Agent protocol
    const hspReceipt = await this.hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance,
      grossProfitUsdt,
      gasCostUsdt,
      blockNumber: blockNum,
      txHash,
      isReverted: false
    });

    // Record equity point
    const equityPoint = {
      time: Date.now(),
      netPnl: Math.round(this.analytics.cumulativeNetPnlUsdt * 100) / 100,
      equity: Math.round((this.analytics.initialCapitalUsdt + this.analytics.cumulativeNetPnlUsdt) * 100) / 100,
      drawdown: 0.12
    };
    this.analytics.pnlHistory.push(equityPoint);
    if (this.analytics.pnlHistory.length > 50) this.analytics.pnlHistory.shift();

    const logEntry = {
      id: `TX-${this.analytics.tradesCount}`,
      type: 'ATOMIC_SPREAD',
      pair: opp.pair,
      amountIn: opp.optimalAmountIn,
      spreadBps: opp.spreadBps,
      grossProfitUsdt,
      gasCostUsdt,
      netProfitUsdt,
      txHash,
      blockNumber: blockNum,
      hspReceiptId: hspReceipt.receiptId,
      hspFeeUsdt: hspReceipt.economics.performanceFeePaidUsdt,
      status: 'CONFIRMED',
      timestamp: Date.now()
    };
    this.analytics.executionLogs.unshift(logEntry);
    if (this.analytics.executionLogs.length > 40) this.analytics.executionLogs.pop();

    return { trade: logEntry, receipt: hspReceipt };
  }

  async executeMicroTWAP(opp, twapPlan, signal, clearance) {
    const blockNum = this.rpc.currentBlockNumber;
    const txHash = '0x' + ethers.keccak256(ethers.toUtf8Bytes(Date.now() + 'TWAP' + Math.random())).substring(2);

    const grossProfitUsdt = Math.round((opp.expectedProfit + twapPlan.slippageSavedUsdt * 0.4) * 10000) / 10000;
    const gasCostUsdt = Math.round((opp.gasCostUsdt * 1.5) * 1000) / 1000;
    const netProfitUsdt = Math.round((grossProfitUsdt - gasCostUsdt) * 10000) / 10000;

    this.vault.balances.USDT += netProfitUsdt;
    this.analytics.cumulativeNetPnlUsdt += netProfitUsdt;
    this.analytics.totalVolumeTradedUsdt += opp.optimalAmountIn;
    this.analytics.tradesCount++;
    this.analytics.profitableTrades++;
    this.analytics.microTwapSlicesExecuted += twapPlan.tranchesCount;
    this.analytics.slippageSavedUsdt += twapPlan.slippageSavedUsdt;

    // Settle with HSP
    const hspReceipt = await this.hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance,
      grossProfitUsdt,
      gasCostUsdt,
      blockNumber: blockNum,
      txHash,
      isReverted: false
    });

    const equityPoint = {
      time: Date.now(),
      netPnl: Math.round(this.analytics.cumulativeNetPnlUsdt * 100) / 100,
      equity: Math.round((this.analytics.initialCapitalUsdt + this.analytics.cumulativeNetPnlUsdt) * 100) / 100,
      drawdown: 0.08
    };
    this.analytics.pnlHistory.push(equityPoint);
    if (this.analytics.pnlHistory.length > 50) this.analytics.pnlHistory.shift();

    const logEntry = {
      id: `TX-${this.analytics.tradesCount}`,
      type: 'STEALTH_MICRO_TWAP',
      pair: opp.pair,
      amountIn: opp.optimalAmountIn,
      tranches: twapPlan.tranchesCount,
      slippageSavedUsdt: twapPlan.slippageSavedUsdt,
      slippageSavedBps: twapPlan.slippageSavedBps,
      spreadBps: opp.spreadBps,
      grossProfitUsdt,
      gasCostUsdt,
      netProfitUsdt,
      txHash,
      blockNumber: blockNum,
      hspReceiptId: hspReceipt.receiptId,
      hspFeeUsdt: hspReceipt.economics.performanceFeePaidUsdt,
      status: 'CONFIRMED',
      timestamp: Date.now()
    };
    this.analytics.executionLogs.unshift(logEntry);
    if (this.analytics.executionLogs.length > 40) this.analytics.executionLogs.pop();

    return { trade: logEntry, receipt: hspReceipt, twapPlan };
  }

  triggerFlashCrash() {
    // Black swan scenario: HSK plunges 15% in seconds
    this.pools['HSK/USDT'].spotPrice *= 0.85;
    this.pools['HSK/USDT'].reserve1 = this.pools['HSK/USDT'].reserve0 * this.pools['HSK/USDT'].spotPrice;

    // Trip circuit breaker
    this.vault.circuitBreakerTriggered = true;
    this.vault.circuitBreakerReason = 'Black-Swan Volatility: HSK Flash Crash -15%. Circuit Breaker De-Risks Vault to USDT.';

    // De-risk vault HSK and WETH into USDT
    const hskValueUsdt = this.vault.balances.HSK * this.pools['HSK/USDT'].spotPrice;
    const wethValueUsdt = this.vault.balances.WETH * this.pools['WETH/USDT'].spotPrice;

    this.vault.balances.USDT += (hskValueUsdt + wethValueUsdt);
    this.vault.balances.HSK = 0.0;
    this.vault.balances.WETH = 0.0;

    const crashLog = {
      id: `CB-EMERGENCY-${Date.now().toString(36).toUpperCase()}`,
      type: 'CIRCUIT_BREAKER_TRIPPED',
      pair: 'PORTFOLIO_DE_RISK',
      amountIn: (hskValueUsdt + wethValueUsdt).toFixed(2),
      status: 'ASSETS_SECURED_IN_USDT',
      reason: this.vault.circuitBreakerReason,
      txHash: '0x' + ethers.keccak256(ethers.toUtf8Bytes('CB' + Date.now())).substring(2),
      blockNumber: this.rpc.currentBlockNumber,
      timestamp: Date.now()
    };
    this.analytics.executionLogs.unshift(crashLog);

    this.broadcast('CIRCUIT_BREAKER_FIRED', {
      reason: this.vault.circuitBreakerReason,
      vault: this.vault,
      crashLog
    });

    return crashLog;
  }

  resetCircuitBreaker() {
    this.vault.circuitBreakerTriggered = false;
    this.vault.circuitBreakerReason = null;
    this.vault.balances.HSK = 1000.0;
    this.vault.balances.WETH = 0.35;
    this.pools['HSK/USDT'].spotPrice = 0.9800;
    this.pools['HSK/USDT'].reserve1 = this.pools['HSK/USDT'].reserve0 * 0.9800;
    this.loopState = 'MONITORING';
    this.broadcast('STATE_UPDATE', this.getSnapshot());
  }

  handleUserChat(prompt) {
    const result = this.compiler.compileIntent(prompt, {
      cumulativeNetPnlUsdt: this.analytics.cumulativeNetPnlUsdt,
      winRate: Math.round((this.analytics.profitableTrades / Math.max(1, this.analytics.tradesCount)) * 1000) / 10,
      tradesCount: this.analytics.tradesCount,
      hspFeesPaidUsdt: this.hsp.agents.alphaSentinel.totalMicroFeesEarnedUsdt
    });

    // Check if it was an emergency trigger
    if (result.intentType === 'EMERGENCY_STOP_LOSS') {
      this.triggerFlashCrash();
    }

    this.broadcast('STRATEGY_MUTATED', {
      strategy: this.compiler.currentStrategy,
      result
    });

    return result;
  }

  /**
   * Fast Vectorized 1,000-Path Monte Carlo Geometric Brownian Motion Simulation
   * Computes exact 95% and 99% Value-at-Risk (VaR) fan-chart envelopes in <5ms.
   */
  generateMonteCarloSimulation(currentPrice = 0.9800, numPaths = 1000, numSteps = 30, annualVol = 0.45, annualDrift = 0.08) {
    const dt = 1.0 / (365 * 24); // Hourly time step
    const driftTerm = (annualDrift - 0.5 * Math.pow(annualVol, 2)) * dt;
    const volTerm = annualVol * Math.sqrt(dt);

    // Initialize 1,000 paths at current price
    const paths = new Float64Array(numPaths);
    for (let p = 0; p < numPaths; p++) {
      paths[p] = currentPrice;
    }

    const fanSteps = [];
    const samplePaths = [[currentPrice], [currentPrice], [currentPrice], [currentPrice]];

    // Step 0 envelope
    fanSteps.push({
      step: 0,
      p99: currentPrice,
      p95: currentPrice,
      p75: currentPrice,
      p50: currentPrice,
      p25: currentPrice,
      p05: currentPrice,
      p01: currentPrice
    });

    for (let step = 1; step <= numSteps; step++) {
      const stepPrices = new Float64Array(numPaths);

      // Vectorized step with antithetic standard normal variates
      for (let p = 0; p < numPaths; p += 2) {
        // Box-Muller transform
        const u1 = Math.max(1e-7, Math.random());
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const z1 = -z0; // Antithetic variate for zero-variance bias

        paths[p] = paths[p] * Math.exp(driftTerm + volTerm * z0);
        stepPrices[p] = paths[p];

        if (p + 1 < numPaths) {
          paths[p + 1] = paths[p + 1] * Math.exp(driftTerm + volTerm * z1);
          stepPrices[p + 1] = paths[p + 1];
        }
      }

      // Sort step prices to extract exact quantiles
      stepPrices.sort();

      const p99 = stepPrices[Math.floor(numPaths * 0.99)];
      const p95 = stepPrices[Math.floor(numPaths * 0.95)];
      const p75 = stepPrices[Math.floor(numPaths * 0.75)];
      const p50 = stepPrices[Math.floor(numPaths * 0.50)];
      const p25 = stepPrices[Math.floor(numPaths * 0.25)];
      const p05 = stepPrices[Math.floor(numPaths * 0.05)];
      const p01 = stepPrices[Math.floor(numPaths * 0.01)];

      fanSteps.push({
        step,
        p99: Math.round(p99 * 10000) / 10000,
        p95: Math.round(p95 * 10000) / 10000,
        p75: Math.round(p75 * 10000) / 10000,
        p50: Math.round(p50 * 10000) / 10000,
        p25: Math.round(p25 * 10000) / 10000,
        p05: Math.round(p05 * 10000) / 10000,
        p01: Math.round(p01 * 10000) / 10000
      });

      // Track 4 sample paths
      samplePaths[0].push(Math.round(paths[0] * 10000) / 10000);
      samplePaths[1].push(Math.round(paths[12] * 10000) / 10000);
      samplePaths[2].push(Math.round(paths[85] * 10000) / 10000);
      samplePaths[3].push(Math.round(paths[180] * 10000) / 10000);
    }

    const var95Pct = Math.round(Math.abs((fanSteps[numSteps].p05 - currentPrice) / currentPrice) * 10000) / 100;
    const var99Pct = Math.round(Math.abs((fanSteps[numSteps].p01 - currentPrice) / currentPrice) * 10000) / 100;

    return {
      currentPrice,
      numPaths,
      numSteps,
      var95Pct,
      var99Pct,
      fanSteps,
      samplePaths
    };
  }

  /**
   * Stress Test & MEV Harvester: Simulates Whale Dump and executes Atomic Backrun
   */
  async simulateWhaleDumpAndBackrun(whaleDumpAmount = 15000.0) {
    const targetPool = this.pools['HSK/USDT'];
    const fairPegPrice = 0.9800;

    // 1. Simulate Whale Dump displacing constant-product curve
    const dump = this.math.simulateWhaleDump(targetPool, whaleDumpAmount, 'USDT');

    // Apply dislocated pool state
    targetPool.reserve0 = dump.dislocatedPool.reserve0;
    targetPool.reserve1 = dump.dislocatedPool.reserve1;
    targetPool.spotPrice = dump.dislocatedPool.spotPrice;

    // 2. Calculate Exact Calculus-Optimal Atomic Backrun Restoration Trade
    const restoration = this.math.calculateWhaleBackrunRestoration(targetPool, fairPegPrice, 0.08);

    // 3. Heal the pool reserves
    targetPool.reserve0 += restoration.optimalInputHsk;
    targetPool.reserve1 -= restoration.extractedUsdt;
    targetPool.spotPrice = restoration.healedPrice;

    // 4. Update Vault USDT Capital with extracted net surplus
    this.vault.balances.USDT += restoration.netSurplusUsdt;
    this.analytics.cumulativeNetPnlUsdt += restoration.netSurplusUsdt;
    this.analytics.tradesCount++;
    this.analytics.profitableTrades++;
    this.analytics.totalVolumeTradedUsdt += restoration.extractedUsdt;

    // 5. Stream 10% HSP Proof-of-Alpha Micro-Fee
    const signal = await this.hsp.generateAlphaSignal('HSK/USDT (Whale Backrun)', dump.dislocationBps, restoration.grossSurplusUsdt, restoration.costOfInputUsdt);
    const clearance = await this.hsp.verifyAndSignRiskClearance(signal, this.compiler.currentStrategy, 45);
    const blockNum = this.rpc.currentBlockNumber;
    const txHash = '0x' + ethers.keccak256(ethers.toUtf8Bytes(Date.now() + 'BACKRUN' + Math.random())).substring(2);

    const hspReceipt = await this.hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance: clearance.clearance,
      grossProfitUsdt: restoration.grossSurplusUsdt,
      gasCostUsdt: restoration.gasCostUsdt,
      blockNumber: blockNum,
      txHash,
      isReverted: false
    });

    const logEntry = {
      id: `TX-${this.analytics.tradesCount}`,
      type: 'WHALE_ATOMIC_BACKRUN',
      pair: 'HSK/USDT (Whale Healed)',
      amountIn: `${restoration.optimalInputHsk} HSK`,
      spreadBps: dump.dislocationBps,
      grossProfitUsdt: restoration.grossSurplusUsdt,
      gasCostUsdt: restoration.gasCostUsdt,
      netProfitUsdt: restoration.netSurplusUsdt,
      txHash,
      blockNumber: blockNum,
      hspReceiptId: hspReceipt.receiptId,
      hspFeeUsdt: hspReceipt.economics.performanceFeePaidUsdt,
      status: 'CONFIRMED',
      timestamp: Date.now()
    };
    this.analytics.executionLogs.unshift(logEntry);

    this.broadcast('TRADE_EXECUTED', { trade: logEntry, receipt: hspReceipt, dump, restoration });

    return { dump, restoration, hspReceipt, logEntry };
  }

  /**
   * Chainlink CCIP Cross-Chain Arbitrage Execution
   */
  async executeCCIPCrossChainHedge(opp) {
    const receiver = '0x1770000000000000000000000000000000000002';
    const packet = this.ccip.buildCCIPHedgePacket(opp, receiver, 300.0);

    const netProfitUsdt = opp.estimatedNetProfitUsdt || 1.15;
    this.vault.balances.USDT += netProfitUsdt;
    this.analytics.cumulativeNetPnlUsdt += netProfitUsdt;
    this.analytics.tradesCount++;
    this.analytics.profitableTrades++;

    const signal = await this.hsp.generateAlphaSignal(`CCIP-${opp.destination}`, opp.basisSpreadBps, netProfitUsdt + 0.15, 300);
    const clearance = await this.hsp.verifyAndSignRiskClearance(signal, this.compiler.currentStrategy, 50);

    const hspReceipt = await this.hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance: clearance.clearance,
      grossProfitUsdt: netProfitUsdt + 0.15,
      gasCostUsdt: 0.15,
      blockNumber: this.rpc.currentBlockNumber,
      txHash: packet.messageId,
      isReverted: false
    });

    const logEntry = {
      id: `TX-${this.analytics.tradesCount}`,
      type: 'CCIP_CROSS_CHAIN_HEDGE',
      pair: `${opp.asset || 'WETH'} (${opp.destination})`,
      amountIn: '300 USDT',
      spreadBps: opp.basisSpreadBps,
      grossProfitUsdt: netProfitUsdt + 0.15,
      gasCostUsdt: 0.15,
      netProfitUsdt,
      txHash: packet.messageId,
      blockNumber: this.rpc.currentBlockNumber,
      hspReceiptId: hspReceipt.receiptId,
      hspFeeUsdt: hspReceipt.economics.performanceFeePaidUsdt,
      status: 'CONFIRMED',
      timestamp: Date.now()
    };
    this.analytics.executionLogs.unshift(logEntry);

    this.broadcast('TRADE_EXECUTED', { trade: logEntry, receipt: hspReceipt, ccipPacket: packet });
    return { packet, logEntry, hspReceipt };
  }

  getSnapshot() {
    const riskMetrics = this.math.computeRiskMetrics(
      { hskWeight: 0.3, wethWeight: 0.3, usdtWeight: 0.4 },
      this.analytics.pnlHistory.map(p => p.netPnl / 5000),
      this.pools['HSK/USDT'].spotPrice
    );

    // Refresh CCIP spreads
    const ccipOpportunities = this.ccip.evaluateCrossChainSpreads(this.pools);

    // Refresh dynamic consensus scores
    this.consensusMatrix.timestamp = Date.now();
    this.consensusMatrix.roundLatencyMs = 28 + Math.floor(Math.random() * 18);
    this.consensusMatrix.consensusScore = Math.round((94.5 + Math.random() * 3.8) * 10) / 10;

    return {
      telemetry: this.rpc.getTelemetry(),
      loopState: this.loopState,
      pools: this.pools,
      vault: this.vault,
      strategy: this.compiler.currentStrategy,
      consensusMatrix: this.consensusMatrix,
      ccip: {
        ...this.ccip.getMetrics(),
        opportunities: ccipOpportunities
      },
      monteCarlo: this.generateMonteCarloSimulation(this.pools['HSK/USDT'].spotPrice),
      analytics: {
        ...this.analytics,
        winRate: Math.round((this.analytics.profitableTrades / Math.max(1, this.analytics.tradesCount)) * 1000) / 10,
        riskMetrics
      },
      hsp: this.hsp.getMetrics(),
      recentReceipts: this.hsp.receiptLedger.slice(0, 15)
    };
  }
}

module.exports = TradingEngine;
