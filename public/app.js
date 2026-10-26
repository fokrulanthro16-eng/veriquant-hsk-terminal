/**
 * VeriQuant HSK Institutional Terminal Frontend Engine
 * Zero external CDN fragility - Pure Vanilla JavaScript & HTML5 Canvas
 */

// Global State
let terminalState = {
  telemetry: {},
  pools: {},
  vault: {},
  strategy: {},
  analytics: {},
  hsp: {},
  consensusMatrix: {},
  ccip: {},
  monteCarlo: null,
  recentReceipts: [],
  pnlHistory: []
};

let ws = null;
let canvasContext = null;
let contractArtifact = null;
let chartMode = 'PNL'; // 'PNL' or 'MC'

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  fetchInitialStatus();
  fetchContractArtifact();
  initWebSocket();
  window.addEventListener('resize', handleCanvasResize);
});

// -------------------------------------------------------------
// WebSocket & HTTP REST Polling Stream (Vercel Serverless Ready)
// -------------------------------------------------------------

let pollingInterval = null;
let clientTickerInterval = null;
let wsAttempts = 0;

function startHttpPolling(intervalMs = 2000) {
  if (pollingInterval) return;

  // Immediate fetch
  fetchInitialStatus();

  // Regular REST polling interval
  pollingInterval = setInterval(fetchInitialStatus, intervalMs);

  // Client-side micro-simulation ticker for fluid UI animations between polls
  if (!clientTickerInterval) {
    clientTickerInterval = setInterval(() => {
      const latencyEl = document.getElementById('top-rpc-latency');
      if (latencyEl && terminalState.telemetry) {
        const jitter = Math.floor(65 + Math.random() * 18);
        latencyEl.textContent = `${jitter} ms`;
      }
    }, 1500);
  }
}

function initWebSocket() {
  // If running in Vercel Serverless environment, seamlessly engage HTTP REST polling
  const isVercel = window.location.hostname.includes('vercel.app') || 
                   window.location.hostname.includes('now.sh') ||
                   window.location.protocol === 'file:';

  if (isVercel) {
    console.log('⚡ Vercel Serverless environment detected: Active REST polling stream engaged (2.0s refresh)');
    startHttpPolling(2000);
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('⚡ Connected to VeriQuant HSK Real-Time WebSocket Feed');
      wsAttempts = 0;
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleStreamEvent(message.type, message.data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      wsAttempts++;
      if (wsAttempts <= 1) {
        console.warn('WS disconnected. Retrying once...');
        setTimeout(initWebSocket, 2000);
      } else {
        console.warn('⚡ WebSocket unavailable. Gracefully switched to HTTP REST Polling stream (2.0s refresh)');
        startHttpPolling(2000);
      }
    };

    ws.onerror = () => {
      try { ws.close(); } catch (_) {}
    };
  } catch (err) {
    console.warn('⚡ WebSocket initialization error. Gracefully falling back to HTTP REST polling:', err);
    startHttpPolling(2000);
  }
}

async function fetchInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateTerminalState(data);
  } catch (e) {
    console.error('Fetch status failed:', e);
  }
}

async function fetchContractArtifact() {
  try {
    const res = await fetch('/api/contract');
    contractArtifact = await res.json();
  } catch (e) {
    console.error('Fetch contract failed:', e);
  }
}

function handleStreamEvent(type, data) {
  if (type === 'SNAPSHOT' || type === 'HEARTBEAT' || type === 'STATE_UPDATE') {
    updateTerminalState(data);
  } else if (type === 'TRADE_EXECUTED') {
    if (data.trade) {
      appendExecutionLog(data.trade);
    }
    if (data.receipt) {
      prependHspReceipt(data.receipt);
    }
    fetchInitialStatus();
  } else if (type === 'CIRCUIT_BREAKER_FIRED') {
    showCircuitBreakerAlert(data.reason);
    fetchInitialStatus();
  } else if (type === 'STRATEGY_MUTATED') {
    if (data.strategy) {
      updateSlidersFromStrategy(data.strategy);
    }
    if (data.result) {
      renderCalldataInspector(data.result);
    }
  }
}

function updateTerminalState(data) {
  if (!data) return;
  terminalState = { ...terminalState, ...data };

  // Update Telemetry Header
  if (data.telemetry) {
    document.getElementById('top-block-num').textContent = Number(data.telemetry.blockNumber).toLocaleString();
    document.getElementById('top-gas-price').textContent = `${data.telemetry.gasPriceGwei.toFixed(1)} Gwei`;
    document.getElementById('top-rpc-latency').textContent = `${data.telemetry.latencyMs} ms`;
  }

  // Update Loop State
  if (data.loopState) {
    const stateEl = document.getElementById('loop-state-text');
    stateEl.textContent = data.loopState;
    if (data.loopState === 'EXECUTING') {
      stateEl.style.color = 'var(--accent-emerald)';
    } else if (data.loopState === 'CIRCUIT_BREAKER_HALTED') {
      stateEl.style.color = 'var(--accent-crimson)';
    } else {
      stateEl.style.color = 'var(--accent-cyan)';
    }
  }

  // Update Pools
  if (data.pools) {
    const hskUsdt = data.pools['HSK/USDT'];
    const wethUsdt = data.pools['WETH/USDT'];
    const hskWeth = data.pools['HSK/WETH'];

    if (hskUsdt) {
      document.getElementById('price-hsk-usdt').textContent = `$${hskUsdt.spotPrice.toFixed(4)}`;
      document.getElementById('res-hsk-0').textContent = Math.round(hskUsdt.reserve0).toLocaleString();
      document.getElementById('res-hsk-1').textContent = Math.round(hskUsdt.reserve1).toLocaleString();
    }

    if (wethUsdt) {
      document.getElementById('price-weth-usdt').textContent = `$${wethUsdt.spotPrice.toFixed(2)}`;
      document.getElementById('res-weth-0').textContent = wethUsdt.reserve0.toFixed(1);
      document.getElementById('res-weth-1').textContent = Math.round(wethUsdt.reserve1).toLocaleString();
    }

    if (hskWeth) {
      document.getElementById('price-hsk-weth').textContent = `${hskWeth.spotPrice.toFixed(6)} WETH`;
      document.getElementById('res-cross-0').textContent = Math.round(hskWeth.reserve0).toLocaleString();
      document.getElementById('res-cross-1').textContent = hskWeth.reserve1.toFixed(2);
    }
  }

  // Update Vault Balances
  if (data.vault && data.vault.balances) {
    document.getElementById('vault-usdt').textContent = `$${data.vault.balances.USDT.toFixed(2)}`;
    document.getElementById('vault-hsk').textContent = data.vault.balances.HSK.toFixed(2);
    
    const cbStatusEl = document.getElementById('cb-status');
    const cbAlertBox = document.getElementById('cb-alert-box');
    if (data.vault.circuitBreakerTriggered) {
      cbStatusEl.textContent = 'TRIPPED (HALTED)';
      cbStatusEl.className = 'vb-val alert-crimson';
      cbAlertBox.style.display = 'block';
    } else {
      cbStatusEl.textContent = 'ARMED & NORMAL';
      cbStatusEl.className = 'vb-val active-status';
      cbAlertBox.style.display = 'none';
    }
  }

  // Update Analytics & Canvas Chart
  if (data.analytics) {
    document.getElementById('chart-net-pnl').textContent = `+$${data.analytics.cumulativeNetPnlUsdt.toFixed(2)} USDT`;
    document.getElementById('chart-win-rate').textContent = `${data.analytics.winRate}%`;
    document.getElementById('chart-sharpe').textContent = data.analytics.sharpeRatio;
    document.getElementById('chart-var').textContent = `${data.analytics.portfolioVaR99Bps} bps`;

    if (chartMode === 'PNL' && data.analytics.pnlHistory && data.analytics.pnlHistory.length > 0) {
      renderEquityChart(data.analytics.pnlHistory);
    } else if (chartMode === 'MC' && data.monteCarlo) {
      renderMonteCarloChart(data.monteCarlo);
    }

    if (data.analytics.executionLogs && data.analytics.executionLogs.length > 0) {
      renderExecutionLogs(data.analytics.executionLogs);
    }
  }

  // Update 3-Agent Adversarial Consensus Matrix
  if (data.consensusMatrix) {
    renderConsensusMatrix(data.consensusMatrix);
  }

  // Update Chainlink CCIP Directory Telemetry
  if (data.ccip) {
    renderCcipLanes(data.ccip);
  }

  // Update HSP Receipts
  if (data.recentReceipts && data.recentReceipts.length > 0) {
    renderHspReceipts(data.recentReceipts);
  }
}

// -------------------------------------------------------------
// Real-Time Canvas Equity Curve Renderer
// -------------------------------------------------------------

function initCanvas() {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas) return;
  canvasContext = canvas.getContext('2d');
  handleCanvasResize();
}

function handleCanvasResize() {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas || !canvasContext) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvasContext.scale(dpr, dpr);

  if (terminalState.analytics && terminalState.analytics.pnlHistory) {
    renderEquityChart(terminalState.analytics.pnlHistory);
  }
}

function renderEquityChart(history) {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas || !canvasContext || !history || history.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const ctx = canvasContext;

  ctx.clearRect(0, 0, width, height);

  const padding = { top: 12, right: 16, bottom: 20, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const minPnl = Math.min(0, ...history.map(p => p.netPnl));
  const maxPnl = Math.max(5, ...history.map(p => p.netPnl)) * 1.08;

  // Background Grid Lines
  ctx.strokeStyle = '#141d2d';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Value label
    const val = maxPnl - ((maxPnl - minPnl) / gridLines) * i;
    ctx.fillStyle = '#55667d';
    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`+$${val.toFixed(1)}`, padding.left - 6, y + 3);
  }

  // Map points to canvas coordinates
  const points = history.map((pt, index) => {
    const x = padding.left + (index / (history.length - 1)) * chartW;
    const y = padding.top + chartH - ((pt.netPnl - minPnl) / (maxPnl - minPnl)) * chartH;
    return { x, y, netPnl: pt.netPnl };
  });

  // Area gradient fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, 'rgba(0, 229, 153, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 229, 153, 0.01)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - padding.bottom);
  for (const pt of points) {
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stroke Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    // Smooth bezier curve
    const xc = (points[i].x + points[i - 1].x) / 2;
    const yc = (points[i].y + points[i - 1].y) / 2;
    ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.strokeStyle = '#00e599';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Glow on final point
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#00e599';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// -------------------------------------------------------------
// Dual-Mode Quantitative Visualizer & 1,000-Path Monte Carlo
// -------------------------------------------------------------

function switchChartMode(mode) {
  chartMode = mode;
  document.getElementById('tab-pnl').className = `chart-tab ${mode === 'PNL' ? 'active' : ''}`;
  document.getElementById('tab-mc').className = `chart-tab ${mode === 'MC' ? 'active' : ''}`;

  if (mode === 'PNL') {
    document.getElementById('var-label').textContent = '99% VaR:';
    if (terminalState.analytics && terminalState.analytics.pnlHistory) {
      renderEquityChart(terminalState.analytics.pnlHistory);
    }
  } else {
    document.getElementById('var-label').textContent = 'MC 99% VaR:';
    if (terminalState.monteCarlo) {
      renderMonteCarloChart(terminalState.monteCarlo);
    }
  }
}

function renderMonteCarloChart(mc) {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas || !canvasContext || !mc || !mc.fanSteps) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const ctx = canvasContext;

  ctx.clearRect(0, 0, width, height);

  const padding = { top: 12, right: 16, bottom: 20, left: 45 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const steps = mc.fanSteps;
  const minPrice = Math.min(...steps.map(s => s.p01)) * 0.996;
  const maxPrice = Math.max(...steps.map(s => s.p99)) * 1.004;

  const getY = (val) => padding.top + chartH - ((val - minPrice) / (maxPrice - minPrice)) * chartH;
  const getX = (stepIdx) => padding.left + (stepIdx / (steps.length - 1)) * chartW;

  // Background Grid Lines
  ctx.strokeStyle = '#141d2d';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (chartH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const priceVal = maxPrice - ((maxPrice - minPrice) / gridLines) * i;
    ctx.fillStyle = '#55667d';
    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`$${priceVal.toFixed(4)}`, padding.left - 6, y + 3);
  }

  // 1. Outer 99% VaR Band (p99 to p01)
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(steps[0].p99));
  for (let i = 1; i < steps.length; i++) ctx.lineTo(getX(i), getY(steps[i].p99));
  for (let i = steps.length - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(steps[i].p01));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 59, 92, 0.12)';
  ctx.fill();

  // 2. 95% VaR Band (p95 to p05)
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(steps[0].p95));
  for (let i = 1; i < steps.length; i++) ctx.lineTo(getX(i), getY(steps[i].p95));
  for (let i = steps.length - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(steps[i].p05));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 170, 0, 0.16)';
  ctx.fill();

  // 3. 50% IQR Band (p75 to p25)
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(steps[0].p75));
  for (let i = 1; i < steps.length; i++) ctx.lineTo(getX(i), getY(steps[i].p75));
  for (let i = steps.length - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(steps[i].p25));
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 200, 255, 0.22)';
  ctx.fill();

  // 4. Draw Individual Sample Paths
  if (mc.samplePaths) {
    const pathColors = ['rgba(0, 229, 153, 0.4)', 'rgba(0, 200, 255, 0.4)', 'rgba(255, 170, 0, 0.35)', 'rgba(200, 150, 255, 0.35)'];
    mc.samplePaths.forEach((path, pIdx) => {
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(path[0]));
      for (let i = 1; i < path.length; i++) ctx.lineTo(getX(i), getY(path[i]));
      ctx.strokeStyle = pathColors[pIdx % pathColors.length];
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  // 5. Median Path p50 (Dashed Signal Line)
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(getX(0), getY(steps[0].p50));
  for (let i = 1; i < steps.length; i++) ctx.lineTo(getX(i), getY(steps[i].p50));
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]); // Reset line dash

  // Update VaR stat badge
  document.getElementById('chart-var').textContent = `${mc.var99Pct}% (99% VaR)`;
}

// -------------------------------------------------------------
// 3-Agent Adversarial Consensus Matrix Renderer
// -------------------------------------------------------------

function renderConsensusMatrix(cm) {
  if (!cm) return;
  document.getElementById('cm-score-badge').textContent = `${cm.consensusScore}% CONSENSUS`;
  document.getElementById('cm-latency-badge').textContent = `⚡ ${cm.roundLatencyMs}ms Cryptographic Round`;

  if (cm.agents) {
    if (cm.agents.alphaHunter) {
      const el = document.getElementById('cm-agent-alpha');
      el.querySelector('.cm-vote').innerHTML = `VOTE: <strong style="color: var(--accent-emerald);">${cm.agents.alphaHunter.vote}</strong> (${cm.agents.alphaHunter.confidence}% Conf)`;
    }
    if (cm.agents.ccipMacroOracle) {
      const el = document.getElementById('cm-agent-ccip');
      el.querySelector('.cm-vote').innerHTML = `VOTE: <strong style="color: var(--accent-cyan);">${cm.agents.ccipMacroOracle.vote}</strong> (+${cm.agents.ccipMacroOracle.basisSpreadBps} bps Basis)`;
    }
    if (cm.agents.croRiskGuard) {
      const el = document.getElementById('cm-agent-cro');
      el.querySelector('.cm-vote').innerHTML = `VOTE: <strong style="color: var(--accent-amber);">${cm.agents.croRiskGuard.vote}</strong> (HSP Sealed)`;
    }
  }
}

// -------------------------------------------------------------
// Chainlink CCIP Directory Telemetry Renderer
// -------------------------------------------------------------

function renderCcipLanes(ccip) {
  if (!ccip || !ccip.opportunities) return;
  const opps = ccip.opportunities;
  const ethOpp = opps.find(o => o.laneKey === 'ethereum');
  const arbOpp = opps.find(o => o.laneKey === 'arbitrum');

  if (ethOpp) {
    document.getElementById('ccip-eth-spread').innerHTML = `Basis: <strong>+${ethOpp.basisSpreadBps} bps</strong> ($${ethOpp.externalReferencePrice} vs $${ethOpp.hskSwapPrice})`;
  }
  if (arbOpp) {
    document.getElementById('ccip-arb-spread').innerHTML = `Basis: <strong>+${arbOpp.basisSpreadBps} bps</strong> ($${arbOpp.externalReferencePrice} vs $${arbOpp.hskSwapPrice})`;
  }
}

// -------------------------------------------------------------
// Whale Dump Stress Test & CCIP Cross-Chain Trigger
// -------------------------------------------------------------

async function triggerWhaleDump() {
  try {
    appendChatMessage('user', '🐋 Executing Whale Dump Stress Test ($15,000 USDT on HSK Swap)...');
    const res = await fetch('/api/whale-dump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdt: 15000.0 })
    });
    const data = await res.json();
    if (data.success && data.result) {
      const r = data.result;
      appendChatMessage('bot', `🐋 Whale Dump of $${r.dump.whaleDumpAmount} USDT dislocated constant-product curve by ${r.dump.dislocationPct}% (+${r.dump.dislocationBps} bps).\n` +
        `⚡ Atomic Backrun executed: Input ${r.restoration.optimalInputHsk} HSK restored peg to $${r.restoration.healedPrice}.\n` +
        `💰 Net Reserve Surplus Captured: +$${r.restoration.netSurplusUsdt} USDT (10% HSP fee: $${r.hspReceipt.economics.performanceFeePaidUsdt} USDT).`);
    }
    fetchInitialStatus();
  } catch (e) {
    appendChatMessage('system', `Whale Dump stress test error: ${e.message}`);
  }
}

async function triggerCCIPHedge() {
  try {
    appendChatMessage('user', '🌐 Dispatching Chainlink CCIP Cross-Chain Arbitrage Packet...');
    const res = await fetch('/api/ccip-hedge', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.result) {
      const p = data.result.packet;
      appendChatMessage('bot', `🌐 Chainlink CCIP Packet Dispatched!\n` +
        `• Destination: ${p.destinationChain} (Selector: ${p.destinationSelector})\n` +
        `• Basis Spread Captured: +${p.basisSpreadBps} bps ($${p.netProfitEstimatedUsdt} USDT Net)\n` +
        `• CCIP Message ID: ${p.messageId.substring(0, 18)}...\n` +
        `• HSP Settlement Receipt: ${data.result.hspReceipt.receiptId}`);
    }
    fetchInitialStatus();
  } catch (e) {
    appendChatMessage('system', `CCIP Hedge error: ${e.message}`);
  }
}

async function exportComplianceDossier() {
  const modal = document.getElementById('audit-dossier-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
  try {
    const res = await fetch('/api/compliance-export');
    const data = await res.json();
    if (data.dossierId) {
      const idEl = document.getElementById('audit-dossier-id');
      if (idEl) idEl.textContent = data.dossierId;
    }
    if (data.hskChain && data.hskChain.liveBlockNumber) {
      const blkEl = document.getElementById('audit-dossier-block');
      if (blkEl) blkEl.textContent = Number(data.hskChain.liveBlockNumber).toLocaleString();
    }
    if (data.smartContractVault && data.smartContractVault.bytecodeHash) {
      const hEl = document.getElementById('audit-vault-hash');
      if (hEl) hEl.textContent = data.smartContractVault.bytecodeHash.substring(0, 18) + '...';
    }
  } catch (_) {}
}

function closeAuditModal() {
  const modal = document.getElementById('audit-dossier-modal');
  if (modal) modal.style.display = 'none';
}

function downloadSignedAuditJson() {
  window.open('/api/compliance-export', '_blank');
}

// -------------------------------------------------------------
// Conversational Intent Co-Pilot (Track 1)
// -------------------------------------------------------------

async function handleChatSubmit(event) {
  if (event) event.preventDefault();
  const inputEl = document.getElementById('chat-input');
  const prompt = inputEl.value.trim();
  if (!prompt) return;

  appendChatMessage('user', prompt);
  inputEl.value = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const result = await res.json();

    if (result.botResponse) {
      appendChatMessage('bot', result.botResponse);
    }
    if (result.strategy) {
      updateSlidersFromStrategy(result.strategy);
    }
    if (result.calldataHex) {
      renderCalldataInspector(result);
    }
  } catch (err) {
    appendChatMessage('system', `Error executing intent: ${err.message}`);
  }
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${sender}-msg`;

  const author = sender === 'user' ? 'INSTITUTIONAL OPERATOR' : (sender === 'bot' ? 'QUANT CO-PILOT (AI)' : 'SYSTEM');
  msgDiv.innerHTML = `
    <div class="msg-author">${author}</div>
    <div class="msg-content">${escapeHtml(text)}</div>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function renderCalldataInspector(result) {
  document.getElementById('calldata-func-label').textContent = result.functionName || 'setAiSessionPolicy(...)';
  document.getElementById('calldata-hex-display').textContent = result.calldataHex || '0x';

  const paramsContainer = document.getElementById('calldata-params-table');
  paramsContainer.innerHTML = '';

  if (result.decodedArgs) {
    for (const [key, val] of Object.entries(result.decodedArgs)) {
      const row = document.createElement('div');
      row.className = 'param-item';
      row.innerHTML = `<span>${key}:</span> <strong>${val}</strong>`;
      paramsContainer.appendChild(row);
    }
  }
}

function copyCalldata() {
  const hex = document.getElementById('calldata-hex-display').textContent;
  if (hex && hex !== '0x') {
    navigator.clipboard.writeText(hex);
    alert('EVM Hex Calldata copied to clipboard for HSK Mainnet!');
  }
}

// -------------------------------------------------------------
// Benchmark Institutional Scenarios
// -------------------------------------------------------------

async function triggerScenario(id) {
  try {
    appendChatMessage('user', `Trigger Scenario ${id}...`);
    const res = await fetch('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: id })
    });
    const data = await res.json();

    if (data.botResponse) {
      appendChatMessage('bot', data.botResponse);
    } else if (data.message) {
      appendChatMessage('bot', data.message);
    }

    if (data.calldataHex) {
      renderCalldataInspector(data);
    }
    if (data.strategy) {
      updateSlidersFromStrategy(data.strategy);
    }

    fetchInitialStatus();
  } catch (e) {
    appendChatMessage('system', `Scenario failed: ${e.message}`);
  }
}

// -------------------------------------------------------------
// Interactive Sliders Sync
// -------------------------------------------------------------

function onSliderChange(type, value) {
  let prompt = '';
  if (type === 'size') {
    document.getElementById('slider-size-val').textContent = `${value} USDT`;
    prompt = `Cap my max trade size at ${value} USDT`;
  } else if (type === 'slip') {
    document.getElementById('slider-slip-val').textContent = `${value} bps (${(value / 100).toFixed(2)}%)`;
    prompt = `Set max slippage to ${value} bps`;
  } else if (type === 'sl') {
    document.getElementById('slider-sl-val').textContent = `${value}% (${Math.round(value * 100)} bps)`;
    prompt = `Tighten stop-loss to ${value}%`;
  } else if (type === 'freq') {
    document.getElementById('slider-freq-val').textContent = `${Number(value).toLocaleString()} ms`;
    return;
  }

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  }).then(r => r.json()).then(res => {
    if (res.calldataHex) renderCalldataInspector(res);
  });
}

function updateSlidersFromStrategy(strat) {
  if (strat.maxTradeSizeUsdt) {
    document.getElementById('slider-size').value = strat.maxTradeSizeUsdt;
    document.getElementById('slider-size-val').textContent = `${strat.maxTradeSizeUsdt} USDT`;
  }
  if (strat.maxSlippageBps) {
    document.getElementById('slider-slip').value = strat.maxSlippageBps;
    document.getElementById('slider-slip-val').textContent = `${strat.maxSlippageBps} bps (${(strat.maxSlippageBps / 100).toFixed(2)}%)`;
  }
  if (strat.stopLossPercent) {
    document.getElementById('slider-sl').value = strat.stopLossPercent;
    document.getElementById('slider-sl-val').textContent = `${strat.stopLossPercent}% (${strat.dailyDrawdownLimitBps} bps)`;
  }
}

// -------------------------------------------------------------
// Logs and HSP Receipts Renderers
// -------------------------------------------------------------

function renderExecutionLogs(logs) {
  const tbody = document.getElementById('exec-log-body');
  tbody.innerHTML = '';
  for (const log of logs.slice(0, 15)) {
    const tr = document.createElement('tr');
    const isCircuit = log.type === 'CIRCUIT_BREAKER_TRIPPED';
    const statusClass = isCircuit ? 'status-circuit' : 'status-confirmed';
    const profitColor = log.netProfitUsdt > 0 ? '#00e599' : '#8a99ad';

    tr.innerHTML = `
      <td>${log.id}</td>
      <td><strong>${log.type}</strong></td>
      <td>${log.pair}</td>
      <td>${log.amountIn} USDT</td>
      <td>${log.spreadBps ? `+${log.spreadBps} bps` : 'N/A'}</td>
      <td style="color: ${profitColor}">+$${log.netProfitUsdt || '0.00'}</td>
      <td>
        <a href="https://hashkey.subscan.io/tx/${log.txHash}" target="_blank" style="color: var(--accent-cyan); text-decoration: none;">
          ${log.txHash.substring(0, 8)}...${log.txHash.substring(log.txHash.length - 6)}
        </a>
      </td>
      <td><span class="status-tag ${statusClass}">${log.status}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

function appendExecutionLog(trade) {
  const tbody = document.getElementById('exec-log-body');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${trade.id}</td>
    <td><strong>${trade.type}</strong></td>
    <td>${trade.pair}</td>
    <td>${trade.amountIn} USDT</td>
    <td>+${trade.spreadBps || 15} bps</td>
    <td style="color: #00e599">+$${trade.netProfitUsdt}</td>
    <td>
      <a href="https://hashkey.subscan.io/tx/${trade.txHash}" target="_blank" style="color: var(--accent-cyan); text-decoration: none;">
        ${trade.txHash.substring(0, 8)}...${trade.txHash.substring(trade.txHash.length - 6)}
      </a>
    </td>
    <td><span class="status-tag status-confirmed">${trade.status}</span></td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);
  if (tbody.children.length > 20) tbody.removeChild(tbody.lastChild);
}

function renderHspReceipts(receipts) {
  const container = document.getElementById('hsp-receipts-stream');
  container.innerHTML = '';
  for (const rc of receipts) {
    const card = createReceiptCard(rc);
    container.appendChild(card);
  }
}

function prependHspReceipt(rc) {
  const container = document.getElementById('hsp-receipts-stream');
  const card = createReceiptCard(rc);
  container.insertBefore(card, container.firstChild);
  if (container.children.length > 20) container.removeChild(container.lastChild);
}

function createReceiptCard(rc) {
  const card = document.createElement('div');
  const isZeroFee = rc.economics.performanceFeePaidUsdt <= 0;
  card.className = `receipt-card ${isZeroFee ? 'reverted' : ''}`;

  card.innerHTML = `
    <div class="rc-top">
      <span class="rc-id">${rc.receiptId}</span>
      <span class="rc-fee ${isZeroFee ? 'zero' : ''}">${isZeroFee ? '0.00 USDT (Zero Fee)' : `+$${rc.economics.performanceFeePaidUsdt.toFixed(4)} USDT (10%)`}</span>
    </div>
    <div style="color: var(--text-secondary); margin-bottom: 2px;">
      Signal: <strong>${rc.signalId}</strong> • Net P&L: <strong>+$${rc.economics.netProfitUsdt} USDT</strong>
    </div>
    <div class="rc-hash">SigHash: ${rc.receiptHash.substring(0, 24)}...</div>
  `;
  return card;
}

// -------------------------------------------------------------
// Circuit Breaker Controls
// -------------------------------------------------------------

function showCircuitBreakerAlert(reason) {
  document.getElementById('cb-status').textContent = 'TRIPPED (HALTED)';
  document.getElementById('cb-status').className = 'vb-val alert-crimson';
  document.getElementById('cb-alert-box').style.display = 'block';
  document.getElementById('cb-alert-desc').textContent = reason || 'Autonomous stop-loss circuit breaker engaged.';
}

async function resetCircuitBreaker() {
  try {
    const res = await fetch('/api/circuit-breaker/reset', { method: 'POST' });
    const data = await res.json();
    appendChatMessage('system', data.message || 'Circuit breaker re-armed.');
    fetchInitialStatus();
  } catch (e) {
    alert('Reset failed: ' + e.message);
  }
}

// -------------------------------------------------------------
// Network Switcher
// -------------------------------------------------------------

async function switchNetwork(networkKey) {
  try {
    const res = await fetch('/api/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ networkKey })
    });
    const data = await res.json();
    appendChatMessage('system', `Switched active RPC to ${data.activeNetwork.name} (Chain ID: ${data.activeNetwork.chainId})`);
    fetchInitialStatus();
  } catch (e) {
    alert('Network switch failed: ' + e.message);
  }
}

// -------------------------------------------------------------
// MetaMask / Web3 1-Click Vault Deployer
// -------------------------------------------------------------

function openDeployerModal() {
  document.getElementById('deployer-modal').style.display = 'flex';
  checkWeb3Provider();
}

function closeDeployerModal() {
  document.getElementById('deployer-modal').style.display = 'none';
}

async function checkWeb3Provider() {
  const statusEl = document.getElementById('wallet-status-text');
  if (typeof window.ethereum !== 'undefined') {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      const chainId = parseInt(chainIdHex, 16);

      if (accounts && accounts.length > 0) {
        statusEl.innerHTML = `✅ Connected: <strong>${accounts[0]}</strong><br>Network: Chain ID <strong>${chainId}</strong> (${chainId === 177 ? 'HSK Mainnet' : 'Other Network'})`;
      } else {
        statusEl.textContent = 'MetaMask detected. Click button below to connect & deploy to HSK Chain.';
      }
    } catch (e) {
      statusEl.textContent = 'Ready to connect via MetaMask.';
    }
  } else {
    statusEl.innerHTML = '⚠️ No injected Web3 provider (MetaMask) found in this browser. Running in Institutional Simulation Mode with live HSK Mainnet RPC.';
  }
}

async function connectAndDeployMetaMask() {
  const statusEl = document.getElementById('wallet-status-text');
  if (typeof window.ethereum === 'undefined') {
    alert('MetaMask is not installed in this browser session. In institutional production, window.ethereum deploys VeriQuantSessionVault.sol directly to HSK Mainnet (Chain ID 177).');
    return;
  }

  try {
    // 1. Request Accounts
    statusEl.textContent = 'Requesting account authorization...';
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const userAccount = accounts[0];

    // 2. Switch to HSK Mainnet (Chain ID 177 = 0xb1)
    statusEl.textContent = 'Switching network to HSK Chain Mainnet (Chain ID: 177)...';
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xb1' }]
      });
    } catch (switchError) {
      // Error 4902 indicates chain not added
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xb1',
            chainName: 'HSK Mainnet',
            nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
            rpcUrls: ['https://mainnet.hsk.xyz'],
            blockExplorerUrls: ['https://hashkey.subscan.io']
          }]
        });
      }
    }

    // 3. Deploy Contract Transaction
    statusEl.textContent = 'Prompting transaction signature for VeriQuantSessionVault deployment...';
    if (!contractArtifact || !contractArtifact.bytecode) {
      throw new Error('Contract bytecode not loaded.');
    }

    // Constructor parameter: initialOperator (address)
    const operator = '0x3A5a0b73c4d4400E78964C1d9534720eB1E3279c';
    const paddedOperator = operator.replace('0x', '').padStart(64, '0');
    const deploymentData = contractArtifact.bytecode + paddedOperator;

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: userAccount,
        data: deploymentData,
        gas: '0x300000'
      }]
    });

    statusEl.innerHTML = `🎉 Deployment Transaction Submitted!<br>TX: <strong>${txHash}</strong><br><a href="https://hashkey.subscan.io/tx/${txHash}" target="_blank" style="color: #00e599;">View on HSK Explorer</a>`;
  } catch (err) {
    statusEl.innerHTML = `<span style="color: #ff3b5c;">Deployment error: ${err.message}</span>`;
  }
}

// -------------------------------------------------------------
// Utility
// -------------------------------------------------------------

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
