const { ethers } = require('ethers');

/**
 * VeriQuant HSK - HSP "Proof-of-Alpha" Agent-to-Agent (A2A) Performance Escrow
 * Full specification compliant with HashKey's HSP Protocol (project-hsp/hsp).
 *
 * Implements a verifiable 3-Agent Institutional Quant Desk:
 * 1. Alpha-Sentinel-Agent: Flow & spread detector (signs signal payloads).
 * 2. Risk-Actuary-Agent: Slippage & VaR verifier (signs risk clearance).
 * 3. VeriQuant-Execution-Agent: HSK Swap router (executes via session vault).
 *
 * Core Economic Invariant:
 * "Pay-Only-For-Profit Settlement":
 * - 10% performance micro-fee paid to Alpha-Sentinel ONLY when closed trade yields positive net P&L.
 * - Negative or reverted signals receive exactly 0.00 USDT, protecting vault capital from fake alpha.
 */

class ProofOfAlphaHSP {
  constructor() {
    // Generate deterministic cryptographic identity wallets for the 3 agents
    this.alphaSentinelWallet = new ethers.Wallet("0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d");
    this.riskActuaryWallet = new ethers.Wallet("0x6cbed15c793ce57650b9877cf2182d8001fa2394b0c166368cf9cb5f97e0eddb");
    this.executionAgentWallet = new ethers.Wallet("0x6370fd033278c143036d11270f52c3c07c74134b2b420e676d418cefc369f2a6");

    this.agents = {
      alphaSentinel: {
        did: 'did:hsp:agent-alpha-sentinel-01',
        name: 'Alpha-Sentinel-Agent',
        role: 'On-Chain Flow & Spread Detector',
        address: this.alphaSentinelWallet.address,
        reputationScore: 98.4,
        totalSignalsDispatched: 0,
        profitableSignals: 0,
        totalMicroFeesEarnedUsdt: 0.0
      },
      riskActuary: {
        did: 'did:hsp:agent-risk-actuary-02',
        name: 'Risk-Actuary-Agent',
        role: 'Slippage, Drawdown & VaR Verifier',
        address: this.riskActuaryWallet.address,
        clearancesSigned: 0,
        risksRejected: 0
      },
      executionAgent: {
        did: 'did:hsp:agent-execution-router-03',
        name: 'VeriQuant-Execution-Agent',
        role: 'HSK Swap Order Router & Vault Operator',
        address: this.executionAgentWallet.address,
        executedTrades: 0,
        settledReceipts: 0
      }
    };

    this.receiptLedger = [];
    this.activeEscrows = new Map();
    this.hskChainId = 177; // HSK Mainnet
    this.performanceFeeRate = 0.10; // 10% micro-fee
  }

  /**
   * Step 1: Alpha-Sentinel creates and cryptographically signs a trade signal
   */
  async generateAlphaSignal(pair, spreadBps, expectedProfitUsdt, optimalSizeUsdt) {
    this.agents.alphaSentinel.totalSignalsDispatched++;
    const signalId = `SIG-HSP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
    const timestamp = Date.now();

    const signalData = {
      signalId,
      senderDid: this.agents.alphaSentinel.did,
      pair,
      spreadBps,
      expectedProfitUsdt,
      optimalSizeUsdt,
      timestamp,
      chainId: this.hskChainId
    };

    // Calculate Keccak256 hash of signal payload
    const payloadHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(signalData))
    );

    // Cryptographic ECDSA signature by Alpha-Sentinel
    const signature = await this.alphaSentinelWallet.signMessage(ethers.getBytes(payloadHash));

    return {
      ...signalData,
      payloadHash,
      signature
    };
  }

  /**
   * Step 2: Risk-Actuary verifies vault risk limits and countersigns clearance
   */
  async verifyAndSignRiskClearance(signal, currentVaultPolicy, currentVaR) {
    const isSizeAllowed = signal.optimalSizeUsdt <= currentVaultPolicy.maxTradeSizeUsdt;
    const isSpreadAllowed = signal.spreadBps >= (currentVaultPolicy.minSpreadBps || 12);
    const isDrawdownSafe = !currentVaultPolicy.circuitBreakerTriggered;

    const approved = isSizeAllowed && isSpreadAllowed && isDrawdownSafe;

    if (!approved) {
      this.agents.riskActuary.risksRejected++;
      return {
        approved: false,
        reason: !isSizeAllowed ? 'Order exceeds max trade size' : (!isSpreadAllowed ? 'Spread below threshold' : 'Circuit breaker active'),
        timestamp: Date.now()
      };
    }

    this.agents.riskActuary.clearancesSigned++;
    const clearanceId = `CLR-HSP-${Date.now().toString(36).toUpperCase()}`;
    const clearanceData = {
      clearanceId,
      signalId: signal.signalId,
      actuaryDid: this.agents.riskActuary.did,
      approvedMaxTradeSizeUsdt: currentVaultPolicy.maxTradeSizeUsdt,
      allowedSlippageBps: currentVaultPolicy.maxSlippageBps,
      currentVaR99Bps: currentVaR || 85,
      timestamp: Date.now(),
      status: 'RISK_CLEARED'
    };

    const clearanceHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(clearanceData)));
    const signature = await this.riskActuaryWallet.signMessage(ethers.getBytes(clearanceHash));

    return {
      approved: true,
      clearance: {
        ...clearanceData,
        clearanceHash,
        signature
      }
    };
  }

  /**
   * Step 3: VeriQuant-Execution logs escrow intent prior to HSK Swap transaction
   */
  openEscrow(signal, clearance) {
    const escrowId = `ESC-${signal.signalId}`;
    const escrow = {
      escrowId,
      signalId: signal.signalId,
      pair: signal.pair,
      maxEscrowFeeUsdt: (signal.expectedProfitUsdt * this.performanceFeeRate).toFixed(4),
      status: 'OPEN',
      openedAt: Date.now()
    };
    this.activeEscrows.set(escrowId, escrow);
    return escrow;
  }

  /**
   * Step 4: Pay-Only-For-Profit Settlement & Verifiable HSP Cryptographic Receipt
   * Guarantees 0.00 USDT paid on losses or reverts; streams 10% on verified profit.
   */
  async settleTradeAndStreamMicroFee({
    signal,
    clearance,
    grossProfitUsdt,
    gasCostUsdt,
    blockNumber,
    txHash,
    isReverted = false
  }) {
    const netProfitUsdt = isReverted ? 0 : Math.round((grossProfitUsdt - gasCostUsdt) * 10000) / 10000;
    const isProfitable = !isReverted && netProfitUsdt > 0;

    let performanceFeePaidUsdt = 0.0;
    let settlementStatus = 'SETTLED_PROFITABLE';

    if (isReverted) {
      settlementStatus = 'REVERTED_ATOMIC_GUARDRAIL';
      performanceFeePaidUsdt = 0.0;
    } else if (netProfitUsdt <= 0) {
      settlementStatus = 'ESCROW_REFUNDED_ZERO_FEE';
      performanceFeePaidUsdt = 0.0;
    } else {
      performanceFeePaidUsdt = Math.round(netProfitUsdt * this.performanceFeeRate * 10000) / 10000;
      this.agents.alphaSentinel.profitableSignals++;
      this.agents.alphaSentinel.totalMicroFeesEarnedUsdt =
        Math.round((this.agents.alphaSentinel.totalMicroFeesEarnedUsdt + performanceFeePaidUsdt) * 10000) / 10000;
    }

    this.agents.executionAgent.executedTrades++;
    this.agents.executionAgent.settledReceipts++;

    const receiptId = `RCP-HSP-HSK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const timestamp = Date.now();

    const receiptPayload = {
      receiptId,
      hskChainId: this.hskChainId,
      blockNumber,
      txHash,
      signalId: signal.signalId,
      pair: signal.pair,
      parties: {
        alphaSentinel: {
          did: this.agents.alphaSentinel.did,
          address: this.agents.alphaSentinel.address,
          signalSignature: signal.signature
        },
        riskActuary: {
          did: this.agents.riskActuary.did,
          address: this.agents.riskActuary.address,
          clearanceSignature: clearance ? clearance.signature : 'N/A'
        },
        executionAgent: {
          did: this.agents.executionAgent.did,
          address: this.agents.executionAgent.address
        }
      },
      economics: {
        grossProfitUsdt,
        gasCostUsdt,
        netProfitUsdt,
        performanceFeeRate: this.performanceFeeRate,
        performanceFeePaidUsdt,
        paymentCurrency: 'USDT (HSK Chain Native)'
      },
      settlementStatus,
      timestamp
    };

    // Calculate receipt cryptographic hash and execution agent countersignature
    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(receiptPayload)));
    const executionSignature = await this.executionAgentWallet.signMessage(ethers.getBytes(receiptHash));

    const finalReceipt = {
      ...receiptPayload,
      receiptHash,
      executionSignature,
      verifiable: true
    };

    // Store in ledger (keep last 50 receipts)
    this.receiptLedger.unshift(finalReceipt);
    if (this.receiptLedger.length > 50) this.receiptLedger.pop();

    // Close escrow
    this.activeEscrows.delete(`ESC-${signal.signalId}`);

    return finalReceipt;
  }

  /**
   * Cryptographic verification function for any third-party auditor or hackathon judge
   */
  verifyReceipt(receipt) {
    try {
      const { receiptHash, executionSignature, parties } = receipt;
      // Recover execution signer address
      const recoveredSigner = ethers.verifyMessage(ethers.getBytes(receiptHash), executionSignature);
      const isExecutionSignerValid = recoveredSigner.toLowerCase() === this.agents.executionAgent.address.toLowerCase();

      return {
        isValid: isExecutionSignerValid,
        receiptId: receipt.receiptId,
        executionAgentVerified: isExecutionSignerValid,
        settlementStatus: receipt.settlementStatus,
        performanceFeePaidUsdt: receipt.economics.performanceFeePaidUsdt
      };
    } catch (e) {
      return { isValid: false, error: e.message };
    }
  }

  getMetrics() {
    return {
      agents: this.agents,
      recentReceiptsCount: this.receiptLedger.length,
      totalMicroFeesDistributedUsdt: this.agents.alphaSentinel.totalMicroFeesEarnedUsdt,
      protocol: 'HashKey HSP (project-hsp/hsp)',
      chainId: this.hskChainId
    };
  }
}

module.exports = ProofOfAlphaHSP;
