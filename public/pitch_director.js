/**
 * VeriQuant HSK - Cinema Auto-Director & Ultra-HD Institutional Pitch Recorder
 * Specialized for HSK Chain Horizon Hackathon (Mumbai Edition)
 *
 * Implements:
 * 1. Synchronized 4-Stage Institutional Voiceover (Neural Edge-TTS / Windows SAPI dual stream).
 * 2. Visual Choreographer: Smooth virtual cursor, neon panel spotlights, lower-third cinema captions.
 * 3. Autonomous UI interaction: Clicks Mumbai Hinglish, Whale Backrun, Circuit Breaker, CCIP, and Audit Export.
 * 4. High-bitrate Ultra-HD MediaRecorder capturing video + synchronized voiceover directly to disk.
 */

class CinemaPitchDirector {
  constructor() {
    this.isPlaying = false;
    this.currentStage = 0;
    this.stageTimer = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.audioContext = null;
    this.audioDestination = null;
    this.activeAudio = null;
    this.totalDurationSec = 140; // ~2:20 total duration
    this.elapsedSec = 0;
    this.timerInterval = null;

    // Strict 4-Stage Script & Timing
    this.stages = [
      {
        id: 1,
        title: "STAGE 1/4: CUSTODY & ARCHITECTURE",
        timeRange: "[0:00 - 0:30]",
        durationSec: 30,
        audioFile: "/audio/stage1.mp3",
        wavFile: "/audio/stage1.wav",
        fullText: "Nobody in institutional DeFi is ever going to hand their private key to an AI trading bot. One bad slippage on a DEX or one model hallucination, and the entire treasury is wiped out. This is VeriQuant HSK, running live against HSK Chain Mainnet, Chain ID 177. We decoupled capital custody from AI execution. Withdrawal keys stay 100 percent locked to the human owner. The AI agent only gets a mathematically scoped session key—it cannot transfer funds out; it can only route swaps through HSK Swap within strict on-chain slippage and drawdown bounds."
      },
      {
        id: 2,
        title: "STAGE 2/4: MUMBAI HINGLISH INTENT & MONTE CARLO",
        timeRange: "[0:30 - 1:10]",
        durationSec: 40,
        audioFile: "/audio/stage2.mp3",
        wavFile: "/audio/stage2.wav",
        fullText: "Watch how fast a desk operator reconfigures the vault. Triggering a Mumbai Hinglish command right now—setting a 300 USDT whale-backrun and CCIP spread policy with a tight 1 percent stop-loss floor. Look at the bottom-left: it doesn't just chat back. It compiles deterministic EVM ABI hex calldata for HSK Chain and locks the on-chain risk sliders in real time. In the center, before any order hits HSK Swap, our engine runs a 1,000-path Monte Carlo stochastic simulation for 99 percent Value-at-Risk and forces three adversarial agents—Alpha Hunter, CCIP Macro Oracle, and Risk Guard—to reach cryptographic consensus in 28 milliseconds."
      },
      {
        id: 3,
        title: "STAGE 3/4: WHALE BACKRUN, CIRCUIT BREAKER & CCIP",
        timeRange: "[1:10 - 1:50]",
        durationSec: 40,
        audioFile: "/audio/stage3.mp3",
        wavFile: "/audio/stage3.wav",
        fullText: "Now let's hit the HSK Swap constant-product pools with real stress. First: a 15,000 dollar whale dump hits the HSK USDT pool. Instead of getting sandwiched, our calculus router calculates the exact optimal input delta and fires an Atomic Backrun—restoring the pool peg and harvesting pure reserve surplus. Second: a 15 percent Black-Swan crash hits. The on-chain Circuit Breaker immediately trips, evacuating volatile exposure back into USDT before drawdown breaches the floor. Third: using Chainlink CCIP, we monitor cross-chain basis against Ethereum, Arbitrum, and Base—firing a cross-chain hedge the moment spreads cross 35 basis points."
      },
      {
        id: 4,
        title: "STAGE 4/4: HSP PROOF-OF-ALPHA & HASHKEY AUDIT",
        timeRange: "[1:50 - 2:20]",
        durationSec: 30,
        audioFile: "/audio/stage4.mp3",
        wavFile: "/audio/stage4.wav",
        fullText: "Finally, we killed fake signal fees using HashKey's HSP protocol. In our settlement stream, the execution agent pays a 10 percent micro-fee to the signal agent only when a trade closes in verified net USDT profit. Losing signal? Zero payout. One click on Export Institutional Audit pulls the full cryptographic proof bundle—compiled vault artifacts, HSK Mainnet state, CCIP message receipts, and HSP settlement ledgers—ready for deployment straight to HSK Chain Mainnet."
      }
    ];

    this.initElements();
  }

  initElements() {
    // Virtual cursor element
    if (!document.getElementById('virtual-cursor')) {
      const cursor = document.createElement('div');
      cursor.id = 'virtual-cursor';
      cursor.className = 'virtual-cursor';
      cursor.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="#00e599" stroke="#ffffff" stroke-width="1.5"/>
        </svg>
        <div class="cursor-glow"></div>
        <div class="cursor-ripple"></div>
      `;
      document.body.appendChild(cursor);
    }

    // Cinema lower-third caption box
    if (!document.getElementById('cinema-captions')) {
      const captions = document.createElement('div');
      captions.id = 'cinema-captions';
      captions.className = 'cinema-captions';
      captions.innerHTML = `
        <div class="captions-inner">
          <div class="captions-header">
            <span class="captions-tag" id="captions-stage-tag">STAGE 1/4: CUSTODY & ARCHITECTURE</span>
            <div class="captions-audio-pill">
              <span class="audio-wave-bar"></span>
              <span class="audio-wave-bar"></span>
              <span class="audio-wave-bar"></span>
              <span id="captions-voice-label">NEURAL VOICE • en-US-Christopher</span>
            </div>
          </div>
          <div class="captions-text" id="captions-text-display">
            Initializing VeriQuant HSK Cinema Director...
          </div>
        </div>
      `;
      document.body.appendChild(captions);
    }

    // Floating Cinema Director HUD
    if (!document.getElementById('cinema-hud')) {
      const hud = document.createElement('div');
      hud.id = 'cinema-hud';
      hud.className = 'cinema-hud';
      hud.innerHTML = `
        <div class="hud-left">
          <div class="hud-rec-badge">
            <span class="rec-dot-live"></span>
            <span>REC 60FPS</span>
          </div>
          <div class="hud-timer" id="hud-timer-display">00:00 / 02:20</div>
        </div>
        <div class="hud-stage-dots">
          <span class="hud-dot active" id="dot-1">1</span>
          <span class="hud-dot" id="dot-2">2</span>
          <span class="hud-dot" id="dot-3">3</span>
          <span class="hud-dot" id="dot-4">4</span>
        </div>
        <div class="hud-actions">
          <button class="btn btn-hud-stop" onclick="cinemaDirector.stopPitch()">
            ⏹ Stop Pitch
          </button>
        </div>
      `;
      document.body.appendChild(hud);
    }
  }

  async startPitch() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStage = 0;
    this.elapsedSec = 0;
    this.recordedChunks = [];

    console.log("🎬 VeriQuant HSK Cinema Auto-Director Starting...");

    // Show overlays
    document.body.classList.add('cinema-mode-active');
    document.getElementById('cinema-captions').classList.add('visible');
    document.getElementById('cinema-hud').classList.add('visible');

    // Update Director Button
    const btn = document.getElementById('btn-auto-pitch');
    if (btn) {
      btn.innerHTML = `<span class="rec-dot-live"></span><span>Recording Pitch (Click to Stop)...</span>`;
      btn.classList.add('recording-btn');
    }

    // Start Audio Context & Media Recording
    await this.initRecording();

    // Start elapsed timer
    this.timerInterval = setInterval(() => {
      this.elapsedSec++;
      const min = String(Math.floor(this.elapsedSec / 60)).padStart(2, '0');
      const sec = String(this.elapsedSec % 60).padStart(2, '0');
      const timerEl = document.getElementById('hud-timer-display');
      if (timerEl) timerEl.textContent = `${min}:${sec} / 02:20`;
    }, 1000);

    this.timeouts = [];

    // Master Timeline Choreography:
    // Stage 1 [0:00 - 0:30]
    this.runStage(1);

    // Stage 2 [0:30 - 1:10] (at exactly 30s)
    this.timeouts.push(setTimeout(() => {
      if (this.isPlaying) this.runStage(2);
    }, 30000));

    // Stage 3 [1:10 - 1:50] (at exactly 70s)
    this.timeouts.push(setTimeout(() => {
      if (this.isPlaying) this.runStage(3);
    }, 70000));

    // Stage 4 [1:50 - 2:20] (at exactly 110s)
    this.timeouts.push(setTimeout(() => {
      if (this.isPlaying) this.runStage(4);
    }, 110000));

    // Pitch Finish [2:20] (at exactly 140s)
    this.timeouts.push(setTimeout(() => {
      if (this.isPlaying) this.finishPitch();
    }, 140000));
  }

  async runStage(stageNum) {
    if (!this.isPlaying) return;
    this.currentStage = stageNum;
    const stageData = this.stages[stageNum - 1];
    this.updateHUDStage(stageNum);

    // Play Voiceover Audio & Animate Captions
    this.playVoiceover(stageData);

    // Execute Visual Choreography for this Stage
    if (stageNum === 1) {
      await this.choreographStage1(stageData);
    } else if (stageNum === 2) {
      await this.choreographStage2(stageData);
    } else if (stageNum === 3) {
      await this.choreographStage3(stageData);
    } else if (stageNum === 4) {
      await this.choreographStage4(stageData);
    }
  }

  updateHUDStage(stageNum) {
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) {
        dot.className = `hud-dot ${i === stageNum ? 'active' : (i < stageNum ? 'completed' : '')}`;
      }
    }
    const tag = document.getElementById('captions-stage-tag');
    if (tag) {
      tag.textContent = this.stages[stageNum - 1].title;
    }
  }

  playVoiceover(stageData) {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio = null;
    }

    const audio = new Audio(stageData.audioFile);
    audio.crossOrigin = "anonymous";
    this.activeAudio = audio;

    // Connect to Web Audio recorder destination
    if (this.audioContext && this.audioDestination) {
      try {
        const source = this.audioContext.createMediaElementSource(audio);
        source.connect(this.audioDestination);
        source.connect(this.audioContext.destination);
      } catch (_) {}
    }

    // Live Subtitles stream
    this.streamCaptions(stageData.fullText, stageData.durationSec);

    audio.onended = () => {
      console.log(`✅ Stage ${this.currentStage} Audio Completed`);
      setTimeout(() => this.runNextStage(), 600);
    };

    audio.onerror = () => {
      console.warn(`Audio ${stageData.audioFile} failed, falling back to Web Speech API...`);
      this.playSpeechSynthesisFallback(stageData);
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        this.playSpeechSynthesisFallback(stageData);
      });
    }
  }

  playSpeechSynthesisFallback(stageData) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(stageData.fullText);
      utter.rate = 1.05;
      utter.pitch = 0.95; // Authoritative tone

      const voices = window.speechSynthesis.getVoices();
      const maleVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('Male') || v.name.includes('Guy')));
      if (maleVoice) utter.voice = maleVoice;

      utter.onend = () => {
        setTimeout(() => this.runNextStage(), 600);
      };

      window.speechSynthesis.speak(utter);
    } else {
      setTimeout(() => this.runNextStage(), stageData.durationSec * 1000);
    }
  }

  streamCaptions(fullText, durationSec) {
    const display = document.getElementById('captions-text-display');
    if (!display) return;

    display.innerHTML = '';
    const words = fullText.split(' ');
    const intervalMs = (durationSec * 1000) / words.length;

    let idx = 0;
    if (this.captionInterval) clearInterval(this.captionInterval);

    this.captionInterval = setInterval(() => {
      if (idx < words.length && this.isPlaying) {
        const span = document.createElement('span');
        span.className = 'caption-word active-word';
        span.textContent = words[idx] + ' ';
        display.appendChild(span);
        display.scrollTop = display.scrollHeight;
        idx++;
      } else {
        clearInterval(this.captionInterval);
      }
    }, intervalMs);
  }

  // -------------------------------------------------------------
  // Visual Choreography: Smooth Cursor & Neon Spotlights
  // -------------------------------------------------------------

  async glideCursor(targetX, targetY, durationMs = 800) {
    const cursor = document.getElementById('virtual-cursor');
    if (!cursor) return;

    cursor.style.display = 'block';
    cursor.style.transition = `transform ${durationMs}ms cubic-bezier(0.25, 1, 0.5, 1)`;
    cursor.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;

    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  async glideToElement(selectorOrEl, durationMs = 800) {
    const el = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    await this.glideCursor(x, y, durationMs);
  }

  async clickTarget(selectorOrEl) {
    const el = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
    if (!el) return;

    await this.glideToElement(el, 600);

    const cursor = document.getElementById('virtual-cursor');
    if (cursor) {
      cursor.classList.add('cursor-clicking');
      setTimeout(() => cursor.classList.remove('cursor-clicking'), 300);
    }

    // Trigger visual and functional click
    el.classList.add('spotlight-pulse');
    setTimeout(() => el.classList.remove('spotlight-pulse'), 400);

    if (typeof el.click === 'function') {
      el.click();
    }
    await this.sleep(400);
  }

  setSpotlight(panelSelector) {
    // Remove previous spotlight
    document.querySelectorAll('.spotlight-focus').forEach(el => el.classList.remove('spotlight-focus'));

    if (panelSelector) {
      const panel = document.querySelector(panelSelector);
      if (panel) {
        panel.classList.add('spotlight-focus');
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------
  // Stage 1 Choreography: Custody & Architecture [0:00 - 0:30]
  // -------------------------------------------------------------
  async choreographStage1(stage) {
    console.log("🎯 Stage 1 Visual Choreography Running [0:00 - 0:30]...");
    this.setSpotlight('.telemetry-bar');

    // 0:01 - Glide cursor to HSK Mainnet Telemetry badge
    await this.sleep(1000);
    await this.glideToElement('#top-block-num', 800);
    await this.sleep(6000);

    // 0:08 - Glide to right panel custody proof (100% Owner Custody)
    this.setSpotlight('.vault-proof-card');
    await this.glideToElement('.user-role', 900);
    await this.sleep(8000);

    // 0:17 - Highlight AI Session operator firewall
    await this.glideToElement('.ai-role', 800);
    await this.sleep(5000);

    // 0:23 - Highlight vault USDT balance
    await this.glideToElement('#vault-usdt', 700);
    await this.sleep(4000);

    // 0:28 - Glide towards left panel for Stage 2
    await this.glideToElement('.panel-left', 800);
  }

  // -------------------------------------------------------------
  // Stage 2 Choreography: Mumbai Hinglish & Monte Carlo [0:30 - 1:10]
  // -------------------------------------------------------------
  async choreographStage2(stage) {
    console.log("🎯 Stage 2 Visual Choreography Running [0:30 - 1:10]...");
    this.setSpotlight('.panel-left');

    // 0:30 (At exactly 30s) - Click Mumbai Quant Desk Hinglish button
    await this.clickTarget('.special-mumbai-btn');
    await this.sleep(4000);

    // 0:35 - Spotlight & highlight Compiled EVM Calldata Box (setAISessionPolicy)
    this.setSpotlight('.calldata-inspector');
    await this.glideToElement('#calldata-hex-display', 800);
    await this.sleep(6000);

    // 0:42 - Glide to Right panel risk sliders and animate them to 300 USDT
    this.setSpotlight('.sliders-section');
    await this.glideToElement('#slider-size', 700);
    const sliderSize = document.getElementById('slider-size');
    if (sliderSize) {
      sliderSize.value = 300;
      if (typeof onSliderChange === 'function') onSliderChange('size', 300);
    }
    await this.sleep(4000);

    // 0:48 - Spotlight Center Panel & Switch to Monte Carlo 1,000-Path Fan Chart
    this.setSpotlight('.chart-section');
    await this.clickTarget('#tab-mc');
    await this.sleep(7000);

    // 0:57 - Spotlight 3-Agent Adversarial Consensus Matrix & Latency
    this.setSpotlight('.consensus-matrix-card');
    await this.glideToElement('#cm-score-badge', 800);
    await this.sleep(8000);

    // 1:07 - Glide towards left panel for Stage 3
    await this.glideToElement('.panel-left', 800);
  }

  // -------------------------------------------------------------
  // Stage 3 Choreography: Whale Dump & Circuit Breaker [1:10 - 1:50]
  // -------------------------------------------------------------
  async choreographStage3(stage) {
    console.log("🎯 Stage 3 Visual Choreography Running [1:10 - 1:50]...");
    this.setSpotlight('.panel-left');

    // 1:10 (At exactly 1:10 / 70s) - Click Whale Dump & Atomic Backrun
    await this.clickTarget('.whale-btn');
    
    // 1:13 - Spotlight pool reserves & calculus delta calculation
    this.setSpotlight('.pools-section');
    await this.glideToElement('#pool-card-hsk-usdt', 800);
    await this.sleep(4000);
    await this.glideToElement('#opt-size-hsk', 700);
    // Wait until 1:26 (86s total: 70 + 16 = 86)
    await this.sleep(8000);

    // 1:26 (At exactly 1:26 / 86s) - Click Black-Swan Crash (-15%)
    this.setSpotlight('.panel-left');
    await this.clickTarget('.alert-scenario');

    // 1:28 - Highlight autonomous on-chain circuit breaker visual state
    this.setSpotlight('.vault-proof-card');
    await this.glideToElement('#cb-status', 800);
    await this.sleep(4000);
    await this.glideToElement('#cb-alert-box', 700);
    await this.sleep(4000);

    // 1:36 - Reset circuit breaker smoothly via API
    try {
      await fetch('/api/circuit-breaker/reset', { method: 'POST' });
      if (typeof fetchInitialStatus === 'function') fetchInitialStatus();
    } catch (_) {}
    await this.sleep(1000);

    // 1:38 (At exactly 1:38 / 98s) - Click Chainlink CCIP Cross-Chain Hedge
    this.setSpotlight('.ccip-telemetry-section');
    await this.clickTarget('.btn-micro');

    // 1:40 - Focus on cross-chain basis panel & Ethereum spread
    await this.glideToElement('#ccip-eth-spread', 800);
    await this.sleep(7000);

    // 1:48 - Glide towards bottom-right for Stage 4
    await this.glideToElement('.hsp-stream-section', 800);
  }

  // -------------------------------------------------------------
  // Stage 4 Choreography: HSP Proof-of-Alpha & HashKey Audit [1:50 - 2:20]
  // -------------------------------------------------------------
  async choreographStage4(stage) {
    console.log("🎯 Stage 4 Visual Choreography Running [1:50 - 2:20]...");

    // 1:50 (At exactly 1:50 / 110s) - Spotlight HSP Settlement stream
    this.setSpotlight('.hsp-stream-section');
    await this.glideToElement('.hsp-rule-banner', 800);
    await this.sleep(4000);

    // 1:55 - Highlight verifiable cryptographic receipts & 10% fee payout
    await this.glideToElement('#hsp-receipts-stream', 800);
    // Wait until 2:05 (125s total: 110 + 15 = 125)
    await this.sleep(8000);

    // 2:05 (At exactly 2:05 / 125s) - Click Export HashKey Institutional Audit (.json)
    this.setSpotlight('.telemetry-bar');
    await this.clickTarget('#btn-export-dossier');

    // 2:07 - Display modal dialog & inspect cryptographic proof bundle
    await this.sleep(2000);
    await this.glideToElement('#audit-dossier-id', 800);
    await this.sleep(3000);
    await this.glideToElement('#audit-vault-hash', 700);
    await this.sleep(4000);

    // 2:16 - Hover on Download Signed Audit JSON button inside modal
    await this.glideToElement('.audit-actions-row button:first-child', 700);
    await this.sleep(3000);

    // 2:20 - Finish pitch
    this.setSpotlight(null);
  }

  // -------------------------------------------------------------
  // Pitch Completion & Ultra-HD Video Export
  // -------------------------------------------------------------
  finishPitch() {
    console.log("🏁 Institutional Pitch Completed!");
    this.isPlaying = false;
    if (this.captionInterval) clearInterval(this.captionInterval);
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.timeouts) {
      this.timeouts.forEach(t => clearTimeout(t));
      this.timeouts = [];
    }

    // Reset UI
    document.body.classList.remove('cinema-mode-active');
    document.getElementById('cinema-captions').classList.remove('visible');
    document.getElementById('cinema-hud').classList.remove('visible');
    const cursor = document.getElementById('virtual-cursor');
    if (cursor) cursor.style.display = 'none';
    this.setSpotlight(null);

    const btn = document.getElementById('btn-auto-pitch');
    if (btn) {
      btn.innerHTML = `<span class="rec-dot"></span><span>🎬 Auto-Play & Record Institutional Pitch (HD + Voice)</span>`;
      btn.classList.remove('recording-btn');
    }

    // Stop MediaRecorder and trigger download
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      setTimeout(() => this.downloadPitchVideo(), 800);
    } else {
      this.showPitchCompletedModal(null);
    }
  }

  stopPitch() {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.finishPitch();
  }

  downloadPitchVideo() {
    if (this.recordedChunks.length === 0) {
      this.showPitchCompletedModal(null);
      return;
    }

    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const videoUrl = URL.createObjectURL(blob);

    // Trigger auto-download
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `VeriQuant_HSK_Institutional_Pitch_UltraHD_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    this.showPitchCompletedModal(videoUrl);
  }

  showPitchCompletedModal(videoUrl) {
    let modal = document.getElementById('pitch-complete-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pitch-complete-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal-card cinema-modal-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="badge-dot pulse-emerald"></span>
            <span class="modal-title">Institutional Pitch Video & Voiceover Complete</span>
          </div>
          <button class="modal-close-btn" onclick="document.getElementById('pitch-complete-modal').style.display='none'">&times;</button>
        </div>
        <div class="modal-body">
          <div class="pitch-success-banner">
            <div class="ps-title">🏆 4-Stage Pitch Video Generated & Synchronized</div>
            <div class="ps-desc">Ultra-HD recorded pitch with Neural voiceover en-US-Christopher & HSK Chain Mainnet proof.</div>
          </div>
          ${videoUrl ? `
            <div class="video-preview-wrapper">
              <video src="${videoUrl}" controls autoplay style="width: 100%; border-radius: 4px; border: 1px solid var(--border-subtle);"></video>
            </div>
          ` : `
            <div class="video-preview-wrapper" style="padding: 20px; text-align: center; color: var(--text-secondary);">
              Voiceover and automated institutional choreography completed across all 4 stages.
            </div>
          `}
          <div class="modal-actions" style="display: flex; gap: 8px;">
            ${videoUrl ? `
              <a href="${videoUrl}" download="VeriQuant_HSK_Institutional_Pitch_UltraHD.webm" class="btn btn-primary btn-full" style="text-decoration: none; text-align: center;">
                ⬇️ Download Ultra-HD Video (.webm)
              </a>
            ` : ''}
            <button class="btn btn-outline btn-full" onclick="cinemaDirector.startPitch()">
              🔄 Re-Play Pitch
            </button>
          </div>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
  }
}

// Global director singleton
const cinemaDirector = new CinemaPitchDirector();

function toggleCinemaPitch() {
  if (cinemaDirector.isPlaying) {
    cinemaDirector.stopPitch();
  } else {
    cinemaDirector.startPitch();
  }
}
