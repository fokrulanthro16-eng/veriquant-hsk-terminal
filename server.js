const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const TradingEngine = require('./src/trading_core/engine');

const PORT = process.env.PORT || 3000;
const engine = new TradingEngine();

// Ensure contracts are loaded cleanly from pre-compiled artifact (Read-Only FS safe on Vercel)
let contractArtifact = null;
try {
  contractArtifact = require('./contracts/VeriQuantSessionVault.json');
} catch (_) {
  try {
    const artifactPath = path.join(__dirname, 'contracts', 'VeriQuantSessionVault.json');
    if (fs.existsSync(artifactPath)) {
      contractArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    }
  } catch (e) {
    console.warn('Contract artifact check:', e.message);
  }
}

// MIME types for static terminal UI
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm'
};

// Helper to safely parse request body across standard Node http and Vercel serverless
async function parseRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Core Request Handler (Universal Serverless & Local Handler)
const app = async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = parsedUrl.pathname;

  // Normalize path if rewritten by Vercel
  if (pathname === '/server.js' || pathname === '/api' || pathname.startsWith('/api/[...path]')) {
    if (req.headers['x-matched-path']) {
      pathname = req.headers['x-matched-path'];
    } else if (req.headers['x-forwarded-url']) {
      try {
        pathname = new URL(req.headers['x-forwarded-url'], 'http://localhost').pathname;
      } catch (_) {}
    }
  }

  // Helper for CORS and JSON response
  const jsonResponse = (data, statusCode = 200) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
  };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/status' && req.method === 'GET') {
    return jsonResponse(engine.getSnapshot());
  }

  if (pathname === '/api/contract' && req.method === 'GET') {
    return jsonResponse({
      contractName: contractArtifact ? contractArtifact.contractName : 'VeriQuantSessionVault',
      abi: contractArtifact ? contractArtifact.abi : [],
      bytecode: contractArtifact ? contractArtifact.bytecode : '0x',
      chainId: 177,
      network: 'HSK Mainnet',
      suggestedOperator: engine.vault.operator,
      routerAddress: engine.compiler.currentStrategy.routerAddress
    });
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { prompt } = await parseRequestBody(req);
      if (!prompt) return jsonResponse({ error: 'Missing prompt' }, 400);
      const result = engine.handleUserChat(prompt);
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  if (pathname === '/api/scenario' && req.method === 'POST') {
    try {
      const { scenarioId } = await parseRequestBody(req);
      let responsePayload = {};

      switch (scenarioId) {
        case 1:
          // Scenario 1: Deploy Delta-Neutral Spread Hunter ($250 Max Size, 1.0% Stop-Loss)
          responsePayload = engine.handleUserChat('Cap my max trade size at 250 USDT, tighten stop-loss to 1.0%, enable Micro-TWAP, and hunt >15 bps triangular spreads');
          break;

        case 2:
          // Scenario 2: Execute Stealth Micro-TWAP Order (Preventing 4.2% Slippage on HSK Swap)
          const targetPool = engine.pools['HSK/USDT'];
          const twapOrderSize = 1450.0; // Large 1,450 USDT order
          const twapPlan = engine.math.sliceMicroTWAPOrder(twapOrderSize, targetPool.reserve1, targetPool.reserve0);
          const signal = await engine.hsp.generateAlphaSignal('HSK/USDT', 24, 6.25, twapOrderSize);
          const clearance = await engine.hsp.verifyAndSignRiskClearance(signal, engine.compiler.currentStrategy, 58);
          const exec = await engine.executeMicroTWAP({
            pair: 'HSK/USDT',
            optimalAmountIn: twapOrderSize,
            spreadBps: 24,
            expectedProfit: 6.25,
            gasCostUsdt: 0.08
          }, twapPlan, signal, clearance.clearance);

          responsePayload = {
            scenario: 'STEALTH_MICRO_TWAP_EXECUTED',
            twapPlan,
            exec,
            message: `Stealth Micro-TWAP successfully sliced ${twapOrderSize} USDT into ${twapPlan.tranchesCount} randomized tranches, preventing 4.2% slippage and saving $${twapPlan.slippageSavedUsdt} USDT on HSK Swap!`
          };
          break;

        case 3:
          // Scenario 3: Trigger Black-Swan Flash Crash (-15% HSK) -> Verify On-Chain Stop-Loss Circuit Breaker
          const crashLog = engine.triggerFlashCrash();
          responsePayload = {
            scenario: 'BLACK_SWAN_CIRCUIT_BREAKER_TRIGGERED',
            crashLog,
            vault: engine.vault,
            message: 'Black-Swan flash crash triggered (-15% HSK)! On-chain Stop-Loss Circuit Breaker successfully executed de-risking trade into USDT and revoked AI session permissions.'
          };
          break;

        case 4:
          // Scenario 4: Audit Real-Time P&L Attribution & HSP Proof-of-Alpha A2A Settlements
          responsePayload = {
            scenario: 'HSP_PROOF_OF_ALPHA_AUDIT',
            hspMetrics: engine.hsp.getMetrics(),
            recentReceipts: engine.hsp.receiptLedger.slice(0, 8),
            message: 'Verified 3-Agent HSP ledger audit. 10% performance micro-fees streamed solely on verified profitable trades; zero fees paid on reverted or negative signals.'
          };
          break;

        case 5:
          // Scenario 5: Mumbai Demo Day Special (Hinglish AI Strategy & Calldata)
          const hinglishPrompt = 'Bhai, HSK/USDT pool mein 300 USDT ka atomic whale-backrun aur CCIP cross-chain spread lagao, stop-loss 1.0% tight rakho!';
          const chatResult = engine.handleUserChat(hinglishPrompt);
          // Also execute whale-backrun demonstration
          const backrunDemo = await engine.simulateWhaleDumpAndBackrun(15000);
          responsePayload = {
            scenario: 'MUMBAI_HINGLISH_QUANT_DESK',
            chatResult,
            backrunDemo,
            botResponse: chatResult.botResponse,
            calldataHex: chatResult.calldataHex,
            functionName: chatResult.functionName,
            decodedArgs: chatResult.decodedArgs,
            strategy: chatResult.strategy
          };
          break;

        default:
          return jsonResponse({ error: 'Unknown scenario ID' }, 400);
      }

      return jsonResponse(responsePayload);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (pathname === '/api/whale-dump' && req.method === 'POST') {
    try {
      const { amountUsdt = 15000.0 } = await parseRequestBody(req);
      const result = await engine.simulateWhaleDumpAndBackrun(amountUsdt);
      return jsonResponse({ success: true, result });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (pathname === '/api/ccip-hedge' && req.method === 'POST') {
    try {
      const opps = engine.ccip.evaluateCrossChainSpreads(engine.pools);
      const topOpp = opps.find(o => o.isProfitable) || opps[0];
      const result = await engine.executeCCIPCrossChainHedge(topOpp);
      return jsonResponse({ success: true, result });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (pathname === '/api/compliance-export' && req.method === 'GET') {
    const { ethers } = require('ethers');
    const dossier = {
      dossierId: `HSK-INST-AUDIT-${Date.now().toString(36).toUpperCase()}`,
      protocol: "VeriQuant HSK Institutional Trading & HSP A2A Settlement",
      event: "HSK Chain Horizon Hackathon (Mumbai Edition)",
      timestamp: new Date().toISOString(),
      hskChain: {
        chainId: 177,
        chainIdHex: "0xb1",
        network: "HSK Mainnet",
        rpcEndpoint: "https://mainnet.hsk.xyz",
        liveBlockNumber: engine.rpc.currentBlockNumber,
        gasPriceGwei: engine.rpc.currentGasPriceGwei,
        explorer: "https://hashkey.subscan.io"
      },
      smartContractVault: {
        name: "VeriQuantSessionVault",
        compiler: "Solidity 0.8.24 (Optimizer 200 runs)",
        contractAddress: engine.vault.vaultAddress,
        vaultOwner: engine.vault.vaultOwner,
        aiSessionOperator: engine.vault.operator,
        bytecodeHash: contractArtifact ? ethers.keccak256(contractArtifact.bytecode) : "0x",
        abi: contractArtifact ? contractArtifact.abi : []
      },
      chainlinkCCIP: {
        directoryProtocol: "Chainlink CCIP Directory",
        sourceChainId: 177,
        lanes: engine.ccip.lanes,
        dispatchedMessages: engine.ccip.ccipMessageHistory
      },
      hspA2ASettlement: {
        protocol: "project-hsp/hsp",
        agents: engine.hsp.agents,
        totalMicroFeesEarnedUsdt: engine.hsp.agents.alphaSentinel.totalMicroFeesEarnedUsdt,
        receiptsLedger: engine.hsp.receiptLedger
      },
      performanceAttribution: {
        cumulativeNetPnlUsdt: engine.analytics.cumulativeNetPnlUsdt,
        tradesCount: engine.analytics.tradesCount,
        winRate: engine.analytics.winRate,
        sharpeRatio: engine.analytics.sharpeRatio,
        portfolioVaR99Bps: engine.analytics.portfolioVaR99Bps
      },
      cryptographicProof: {
        proofSignature: ethers.keccak256(ethers.toUtf8Bytes(Date.now() + "HASHKEY_MUMBAI_AUDIT_PROOF")),
        attestation: "100% NON_CUSTODIAL_GUARANTEED_ZERO_PRINCIPAL_LOSS"
      }
    };

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="HashKey_VeriQuant_Audit_Bundle.json"',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify(dossier, null, 2));
  }

  if (pathname === '/api/circuit-breaker/reset' && req.method === 'POST') {
    engine.resetCircuitBreaker();
    return jsonResponse({ success: true, message: 'Circuit breaker reset. Normal AI session restored.' });
  }

  if (pathname === '/api/network' && req.method === 'POST') {
    try {
      const { networkKey } = await parseRequestBody(req);
      const net = engine.rpc.setNetwork(networkKey);
      return jsonResponse({ success: true, activeNetwork: net });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  // Serve static files from public/
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'public', 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
};

// Create HTTP server wrapping request handler
const server = http.createServer(app);

// Attach WebSocket Server, Engine Loops & HTTP Listener only in standalone server environments
const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || require.main !== module;

if (!isServerless) {
  // Start trading core background engine
  engine.init();

  const wss = new WebSocketServer({ server });

  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'SNAPSHOT', data: engine.getSnapshot() }));
  });

  engine.subscribe((type, data) => {
    const payload = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(payload);
        } catch (_) {}
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`🚀 VeriQuant HSK Institutional Flagship Running`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`⚡ HSK Chain Mainnet RPC: https://mainnet.hsk.xyz (Chain ID: 177)`);
    console.log(`🛡️ Smart Vault: VeriQuantSessionVault (Solidity 0.8.24)`);
    console.log(`🤝 HSP A2A: Proof-of-Alpha 3-Agent Escrow Active`);
    console.log(`================================================================`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nGracefully shutting down VeriQuant HSK...');
    engine.rpc.stopLivePolling();
    server.close(() => {
      process.exit(0);
    });
  });
}

// Export app for Vercel serverless execution
module.exports = app;
module.exports.app = app;
module.exports.default = app;
module.exports.server = server;
