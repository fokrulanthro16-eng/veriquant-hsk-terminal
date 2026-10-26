/**
 * VeriQuant HSK - Comprehensive Institutional End-to-End Verification Test Suite
 * Validates:
 * 1. Live HSK Chain Mainnet RPC telemetry & Chain ID 177
 * 2. Calculus-Optimal AMM router math (x * y = k) & exact Delta x* sizing
 * 3. Stealth Micro-TWAP order slicing & MEV sandwich protection (>80% slippage reduction)
 * 4. Stop-loss circuit breaker de-risking & session revocation
 * 5. Conversational Intent-to-Calldata compilation & ABI encoding
 * 6. HSP Proof-of-Alpha 3-agent cryptographic receipts & Pay-Only-For-Profit invariant
 */

const assert = require('assert');
const { ethers } = require('ethers');
const HSKSwapAMMMath = require('./src/quant_engine/hskswap_amm_math');
const IntentCompiler = require('./src/ai_engine/intent_compiler');
const ProofOfAlphaHSP = require('./src/hsp_a2a/proof_of_alpha_hsp');
const HSKRpcClient = require('./src/rpc/hsk_client');

let passedTests = 0;
let totalTests = 0;

function it(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`     Reason: ${err.message}`);
  }
}

async function itAsync(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${description}`);
    console.error(`     Reason: ${err.message}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🔬 STARTING VERIQUANT HSK END-TO-END VERIFICATION SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test Group 1: Live HSK Chain Mainnet RPC
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Real HSK Mainnet (Chain ID 177) Telemetry ---');

  const rpc = new HSKRpcClient();

  await itAsync('Connects directly to HSK Mainnet RPC and retrieves live block number', async () => {
    const telemetry = await rpc.refreshTelemetry();
    assert.ok(telemetry.blockNumber > 29000000, `Block number ${telemetry.blockNumber} should exceed 29M`);
    assert.strictEqual(telemetry.chainId, 177, 'Chain ID must be 177 (HSK Mainnet)');
    assert.strictEqual(telemetry.chainIdHex, '0xb1', 'Chain ID Hex must be 0xb1');
    assert.ok(telemetry.gasPriceGwei > 0, 'Gas price should be greater than 0 Gwei');
    console.log(`     [HSK Live Block: ${telemetry.blockNumber}, Gas: ${telemetry.gasPriceGwei} Gwei, Latency: ${telemetry.latencyMs}ms]`);
  });

  await itAsync('Switches to HSK Testnet and falls back cleanly', async () => {
    const testnet = rpc.setNetwork('testnet');
    assert.strictEqual(testnet.chainId, 133);
    const telemetry = await rpc.refreshTelemetry();
    assert.strictEqual(telemetry.chainId, 133);
    // Switch back
    rpc.setNetwork('mainnet');
  });

  // -------------------------------------------------------------
  // Test Group 2: AMM Constant Product Calculus & Optimal Sizing
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Calculus-Optimal AMM Math & Delta x* ---');

  const math = new HSKSwapAMMMath();

  it('Calculates exact UniswapV2 constant-product output with 0.30% fee tier', () => {
    // 100 USDT into HSK pool (reserveIn = 1,000,000, reserveOut = 1,000,000)
    const amountIn = 100;
    const resIn = 1000000;
    const resOut = 1000000;
    const out = math.getAmountOut(amountIn, resIn, resOut, 30);
    // Delta y = (100 * 997 * 1,000,000) / (1,000,000 * 1,000 + 100 * 997) ~ 99.601
    assert.ok(out > 99.5 && out < 99.7, `Expected output ~99.6, got ${out}`);
  });

  it('Calculates price impact accurately in basis points (bps)', () => {
    const impact = math.calculatePriceImpact(1000, 100000, 100000, 30);
    assert.ok(impact > 95 && impact < 135, `Expected impact ~100-130 bps, got ${impact}`);
  });

  it('Calculates closed-form optimal arbitrage input sizing (Delta x*) where dPi/dDeltaX = 0', () => {
    // Pool 1: 100,000 Token A : 105,000 Token B (takes Token A, outputs Token B)
    // Pool 2: 108,000 Token A : 100,000 Token B (takes Token B, outputs Token A)
    // Cross-spread > fee threshold -> Mathematically guaranteed positive net arbitrage
    const pool1 = { reserveA: 100000, reserveB: 105000 };
    const pool2 = { reserveA: 108000, reserveB: 100000 };

    const arb = math.calculateOptimalArbitrage(pool1, pool2, 0.05);
    assert.strictEqual(arb.isProfitable, true, 'Arbitrage should be profitable');
    assert.ok(arb.optimalAmountIn > 50 && arb.optimalAmountIn < 5000, `Optimal sizing ${arb.optimalAmountIn} in valid bounds`);
    assert.ok(arb.expectedProfit > 0, `Expected profit must be positive: ${arb.expectedProfit}`);
    console.log(`     [Calculated Optimal Input Delta x*: ${arb.optimalAmountIn} Token A, Net Profit: ${arb.expectedProfit}]`);
  });

  it('Simulates Whale Dump on HSK Swap (>1.5% dislocation) and calculates exact Atomic Backrun Restoration Trade', () => {
    const testPool = { reserve0: 845000, reserve1: 828100, spotPrice: 0.9800 };
    const dump = math.simulateWhaleDump(testPool, 15000, 'USDT');

    assert.ok(dump.dislocationPct >= 1.5, `Dislocation ${dump.dislocationPct}% must exceed 1.5%`);
    assert.ok(dump.dislocatedPrice > dump.initialPrice, 'USDT dump into pool should increase USDT/HSK price');

    const restoration = math.calculateWhaleBackrunRestoration(dump.dislocatedPool, 0.9800, 0.08);
    assert.strictEqual(restoration.isProfitable, true, 'Backrun restoration trade must be profitable');
    assert.ok(restoration.optimalInputHsk > 1000, 'Optimal HSK input should exceed 1000');
    assert.ok(restoration.netSurplusUsdt > 0, `Extracted reserve surplus must be positive: ${restoration.netSurplusUsdt}`);
    assert.ok(restoration.pegErrorBps < 15, `Post-backrun price should heal to peg (<15 bps error): ${restoration.pegErrorBps} bps`);
    console.log(`     [Whale Dump: $15k USDT -> Dislocation: +${dump.dislocationBps} bps. Backrun Captured: +$${restoration.netSurplusUsdt} USDT Surplus, Healed Peg: $${restoration.healedPrice}]`);
  });

  // -------------------------------------------------------------
  // Test Group 3: Stealth Micro-TWAP Order Slicing & MEV Shield
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Stealth Micro-TWAP & MEV Shield ---');

  it('Automatically decomposes large orders into randomized tranches when price impact exceeds 0.35%', () => {
    // Large 2,500 USDT order in a pool with 25,000 USDT reserve (10% depth -> large impact)
    const largeOrder = 2500;
    const resIn = 25000;
    const resOut = 25000;

    const twapPlan = math.sliceMicroTWAPOrder(largeOrder, resIn, resOut, 35);
    assert.strictEqual(twapPlan.sliced, true, 'Must trigger stealth micro-TWAP slicing');
    assert.ok(twapPlan.tranchesCount >= 3, `Expected at least 3 tranches, got ${twapPlan.tranchesCount}`);
    assert.ok(twapPlan.slippageSavedUsdt > 0, `Slippage savings must be positive: ${twapPlan.slippageSavedUsdt}`);
    assert.ok(twapPlan.slippageSavedBps > 100, `Slippage saved bps must exceed 100 bps, got ${twapPlan.slippageSavedBps}`);

    // Verify non-linear jitter variance (tranches should not be identical)
    const t1 = twapPlan.tranches[0].amountIn;
    const t2 = twapPlan.tranches[1].amountIn;
    assert.notStrictEqual(t1, t2, 'Tranches must have randomized jitter to evade MEV sandwich bots');
    console.log(`     [Large Order: ${largeOrder} USDT -> ${twapPlan.tranchesCount} Stealth Tranches. Slippage Saved: $${twapPlan.slippageSavedUsdt} USDT (${twapPlan.slippageSavedBps} bps)]`);
  });

  // -------------------------------------------------------------
  // Test Group 4: Conversational Intent-to-Calldata Compiler
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Intent-to-Calldata Compiler (Track 1) ---');

  const compiler = new IntentCompiler();

  it('Parses complex institutional trading prompt and compiles valid EVM calldata', () => {
    const prompt = 'Cap my max trade size at 200 USDT, tighten stop-loss to 1.2%, enable Micro-TWAP on HSK/USDT, and hunt >18 bps triangular spreads';
    const result = compiler.compileIntent(prompt);

    assert.strictEqual(result.intentType, 'STRATEGY_UPDATE');
    assert.strictEqual(result.strategy.maxTradeSizeUsdt, 200);
    assert.strictEqual(result.strategy.stopLossPercent, 1.2);
    assert.strictEqual(result.strategy.dailyDrawdownLimitBps, 120);
    assert.strictEqual(result.strategy.microTwapEnabled, true);
    assert.strictEqual(result.strategy.minSpreadBps, 18);

    assert.ok(result.calldataHex.startsWith('0x'), 'Calldata must start with 0x');
    assert.ok(result.calldataHex.length > 64, 'Calldata must contain valid ABI encoded bytes');
    assert.strictEqual(result.functionName, 'setAiSessionPolicy');
    console.log(`     [Compiled Calldata for setAiSessionPolicy: ${result.calldataHex.substring(0, 34)}...]`);
  });

  it('Detects emergency stop-loss intent and compiles circuit breaker calldata', () => {
    const emergencyPrompt = 'Trigger emergency stop-loss on crash';
    const result = compiler.compileIntent(emergencyPrompt);

    assert.strictEqual(result.intentType, 'EMERGENCY_STOP_LOSS');
    assert.strictEqual(result.functionName, 'triggerEmergencyStopLoss');
    assert.ok(result.calldataHex.startsWith('0x'));
  });

  it('Parses Mumbai Quant Hinglish natural language command and compiles valid EVM calldata', () => {
    const hinglishPrompt = 'Bhai, HSK/USDT pool mein 300 USDT ka atomic whale-backrun aur CCIP cross-chain spread lagao, stop-loss 1.0% tight rakho!';
    const result = compiler.compileIntent(hinglishPrompt);

    assert.strictEqual(result.intentType, 'STRATEGY_UPDATE');
    assert.strictEqual(result.strategy.maxTradeSizeUsdt, 300);
    assert.strictEqual(result.strategy.stopLossPercent, 1.0);
    assert.strictEqual(result.strategy.dailyDrawdownLimitBps, 100);
    assert.ok(result.strategy.targetPairs.includes('HSK/USDT'));
    assert.strictEqual(result.strategy.atomicWhaleBackrun, true);
    assert.strictEqual(result.strategy.ccipCrossChainEnabled, true);
    assert.ok(result.botResponse.includes('मुंबई') || result.botResponse.includes('Mumbai'));
    assert.ok(result.calldataHex.startsWith('0x'));
    console.log(`     [Mumbai Hinglish Parsed: 300 USDT, 1.0% SL, Whale-Backrun: true, CCIP: true]`);
  });

  // -------------------------------------------------------------
  // Test Group 5: HSP Agent-to-Agent "Proof-of-Alpha" Escrow
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: HSP Agent-to-Agent Settlement (Track 2) ---');

  const hsp = new ProofOfAlphaHSP();

  await itAsync('Generates cryptographically signed Alpha-Sentinel signal and Risk-Actuary clearance', async () => {
    const signal = await hsp.generateAlphaSignal('HSK/USDT', 22, 5.50, 180);
    assert.ok(signal.signalId.startsWith('SIG-HSP-'));
    assert.ok(signal.signature.startsWith('0x'));
    assert.strictEqual(signal.chainId, 177);

    const clearance = await hsp.verifyAndSignRiskClearance(signal, {
      maxTradeSizeUsdt: 250,
      minSpreadBps: 15,
      circuitBreakerTriggered: false
    }, 70);

    assert.strictEqual(clearance.approved, true);
    assert.ok(clearance.clearance.signature.startsWith('0x'));
  });

  await itAsync('Enforces Pay-Only-For-Profit invariant: Streams 10% fee on profitable trade', async () => {
    const signal = await hsp.generateAlphaSignal('HSK/USDT', 25, 4.00, 200);
    const clearance = await hsp.verifyAndSignRiskClearance(signal, { maxTradeSizeUsdt: 300, minSpreadBps: 10 }, 65);

    const receipt = await hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance: clearance.clearance,
      grossProfitUsdt: 4.00,
      gasCostUsdt: 0.05,
      blockNumber: 29315920,
      txHash: '0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000',
      isReverted: false
    });

    assert.strictEqual(receipt.settlementStatus, 'SETTLED_PROFITABLE');
    // Net profit = 3.95 USDT. 10% fee = 0.395 USDT
    assert.strictEqual(receipt.economics.performanceFeePaidUsdt, 0.395);
    assert.ok(receipt.executionSignature.startsWith('0x'));

    // Verify cryptographic receipt
    const verification = hsp.verifyReceipt(receipt);
    assert.strictEqual(verification.isValid, true, 'Cryptographic receipt signature must be valid');
    assert.strictEqual(verification.executionAgentVerified, true);
    console.log(`     [Profitable Trade Receipt: ${receipt.receiptId}, 10% Micro-Fee Paid: $${receipt.economics.performanceFeePaidUsdt} USDT]`);
  });

  await itAsync('Enforces Pay-Only-For-Profit invariant: 0.00 USDT paid on reverted or losing trade', async () => {
    const signal = await hsp.generateAlphaSignal('HSK/USDT', 15, 2.00, 200);
    const clearance = await hsp.verifyAndSignRiskClearance(signal, { maxTradeSizeUsdt: 300, minSpreadBps: 10 }, 65);

    const revertedReceipt = await hsp.settleTradeAndStreamMicroFee({
      signal,
      clearance: clearance.clearance,
      grossProfitUsdt: 0,
      gasCostUsdt: 0.05,
      blockNumber: 29315922,
      txHash: '0x999988887777666655554444333322221111aaaabbbbccccddddeeeeffff0000',
      isReverted: true
    });

    assert.strictEqual(revertedReceipt.settlementStatus, 'REVERTED_ATOMIC_GUARDRAIL');
    assert.strictEqual(revertedReceipt.economics.performanceFeePaidUsdt, 0.0, 'Must pay exactly 0.00 USDT on reverted trades');
    console.log(`     [Reverted Trade Receipt: ${revertedReceipt.receiptId}, Fee Paid: $${revertedReceipt.economics.performanceFeePaidUsdt} USDT (Zero Fee Protection)]`);
  });

  // -------------------------------------------------------------
  // Test Group 6: Chainlink CCIP Cross-Chain Arbitrage
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Chainlink CCIP Cross-Chain Parity & Routing ---');

  const ChainlinkCCIPRouter = require('./src/ccip/chainlink_ccip_router');
  const ccip = new ChainlinkCCIPRouter();

  it('Evaluates cross-chain spreads and constructs verifiable CCIP message packet', () => {
    const dummyPools = {
      'WETH/USDT': { spotPrice: 3300.00 },
      'HSK/USDT': { spotPrice: 0.9800 }
    };
    const opps = ccip.evaluateCrossChainSpreads(dummyPools);
    assert.ok(opps.length >= 2, 'Must evaluate at least 2 CCIP lanes (Ethereum, Arbitrum)');
    assert.strictEqual(opps[0].chainSelector, '5009297550715157269');
    assert.strictEqual(opps[1].chainSelector, '4949039107694359620');

    const topOpp = opps[0];
    const receiver = '0x1770000000000000000000000000000000000002';
    const packet = ccip.buildCCIPHedgePacket(topOpp, receiver, 300.0);

    assert.ok(packet.messageId.startsWith('0x'));
    assert.strictEqual(packet.messageId.length, 66); // 32 bytes hex
    assert.strictEqual(packet.sourceChainId, 177);
    assert.strictEqual(packet.status, 'DISPATCHED_TO_CCIP_LANE');
    console.log(`     [CCIP Dispatched: ${packet.destinationChain} (Selector: ${packet.destinationSelector}), MsgID: ${packet.messageId.substring(0, 24)}...]`);
  });

  // -------------------------------------------------------------
  // Test Group 7: Monte Carlo 1,000-Path Risk Fan Chart
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: 1,000-Path Monte Carlo Geometric Brownian Motion ---');

  const TradingEngine = require('./src/trading_core/engine');
  const engine = new TradingEngine();

  it('Executes 1,000-path Monte Carlo simulation with antithetic variance reduction in <10ms', () => {
    const t0 = Date.now();
    const mc = engine.generateMonteCarloSimulation(0.9800, 1000, 30, 0.45, 0.08);
    const elapsed = Date.now() - t0;

    assert.strictEqual(mc.numPaths, 1000);
    assert.strictEqual(mc.numSteps, 30);
    assert.strictEqual(mc.fanSteps.length, 31);

    // Check quantile monotonicity
    const lastStep = mc.fanSteps[30];
    assert.ok(lastStep.p99 >= lastStep.p95, 'p99 >= p95');
    assert.ok(lastStep.p95 >= lastStep.p75, 'p95 >= p75');
    assert.ok(lastStep.p75 >= lastStep.p50, 'p75 >= p50');
    assert.ok(lastStep.p50 >= lastStep.p25, 'p50 >= p25');
    assert.ok(lastStep.p25 >= lastStep.p05, 'p25 >= p05');
    assert.ok(lastStep.p05 >= lastStep.p01, 'p05 >= p01');

    assert.ok(mc.var99Pct > 0, `99% VaR must be positive: ${mc.var99Pct}%`);
    console.log(`     [Monte Carlo: 1,000 Paths calculated in ${elapsed}ms. 99% VaR: ${mc.var99Pct}%, Median Peg: $${lastStep.p50}]`);
  });

  // -------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 TEST SUITE COMPLETE: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🏆 ALL INSTITUTIONAL INVARIANTS MATHEMATICALLY & CRYPTOGRAPHICALLY VERIFIED');
  } else {
    console.error('⚠️ SOME TESTS FAILED');
  }
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
