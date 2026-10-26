# Windows SAPI Speech Generator for VeriQuant HSK Pitch
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Select David Desktop (deep institutional male voice)
try {
    $synth.SelectVoice("Microsoft David Desktop")
} catch {
    Write-Output "Defaulting to system voice"
}
$synth.Rate = 1 # Slightly fast, authoritative

$audioDir = Join-Path $PSScriptRoot "..\public\audio"
if (-not (Test-Path $audioDir)) {
    New-Item -ItemType Directory -Path $audioDir -Force | Out-Null
}

$stages = @{
    "stage1" = "Nobody in institutional DeFi is ever going to hand their private key to an AI trading bot. One bad slippage on a DEX or one model hallucination, and the entire treasury is wiped out. This is VeriQuant HSK, running live against HSK Chain Mainnet, Chain ID 177. We decoupled capital custody from AI execution. Withdrawal keys stay 100 percent locked to the human owner. The AI agent only gets a mathematically scoped session key - it cannot transfer funds out; it can only route swaps through HSK Swap within strict on-chain slippage and drawdown bounds."
    "stage2" = "Watch how fast a desk operator reconfigures the vault. Triggering a Mumbai Hinglish command right now - setting a 300 USDT whale-backrun and CCIP spread policy with a tight 1 percent stop-loss floor. Look at the bottom-left: it does not just chat back. It compiles deterministic EVM ABI hex calldata for HSK Chain and locks the on-chain risk sliders in real time. In the center, before any order hits HSK Swap, our engine runs a 1,000-path Monte Carlo stochastic simulation for 99 percent Value-at-Risk and forces three adversarial agents - Alpha Hunter, CCIP Macro Oracle, and Risk Guard - to reach cryptographic consensus in 28 milliseconds."
    "stage3" = "Now let us hit the HSK Swap constant-product pools with real stress. First: a 15,000 dollar whale dump hits the HSK USDT pool. Instead of getting sandwiched, our calculus router calculates the exact optimal input delta and fires an Atomic Backrun - restoring the pool peg and harvesting pure reserve surplus. Second: a 15 percent Black-Swan crash hits. The on-chain Circuit Breaker immediately trips, evacuating volatile exposure back into USDT before drawdown breaches the floor. Third: using Chainlink CCIP, we monitor cross-chain basis against Ethereum, Arbitrum, and Base - firing a cross-chain hedge the moment spreads cross 35 basis points."
    "stage4" = "Finally, we killed fake signal fees using HashKey's HSP protocol. In our settlement stream, the execution agent pays a 10 percent micro-fee to the signal agent only when a trade closes in verified net USDT profit. Losing signal? Zero payout. One click on Export Institutional Audit pulls the full cryptographic proof bundle - compiled vault artifacts, HSK Mainnet state, CCIP message receipts, and HSP settlement ledgers - ready for deployment straight to HSK Chain Mainnet."
}

foreach ($key in $stages.Keys) {
    $wavPath = Join-Path $audioDir "$key.wav"
    Write-Output "Synthesizing SAPI WAV: $wavPath"
    $synth.SetOutputToWaveFile($wavPath)
    $synth.Speak($stages[$key])
    $synth.SetOutputToNull()
    Write-Output "Generated $wavPath"
}

Write-Output "All SAPI WAV voiceover files generated successfully."
