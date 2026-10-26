import asyncio
import os
import sys
import edge_tts

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

AUDIO_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio')
os.makedirs(AUDIO_DIR, exist_ok=True)

VOICE = "en-US-ChristopherNeural"  # Deep, authoritative institutional tone

STAGES = {
    "stage1": {
        "text": (
            "Nobody in institutional DeFi is ever going to hand their private key to an AI trading bot. "
            "One bad slippage on a DEX or one model hallucination, and the entire treasury is wiped out. "
            "This is VeriQuant HSK, running live against HSK Chain Mainnet, Chain ID 177. "
            "We decoupled capital custody from AI execution. "
            "Withdrawal keys stay 100 percent locked to the human owner. "
            "The AI agent only gets a mathematically scoped session key—it cannot transfer funds out; "
            "it can only route swaps through HSK Swap within strict on-chain slippage and drawdown bounds."
        ),
        "rate": "+35%"
    },
    "stage2": {
        "text": (
            "Watch how fast a desk operator reconfigures the vault. "
            "Triggering a Mumbai Hinglish command right now—setting a 300 USDT whale-backrun and CCIP spread policy "
            "with a tight 1 percent stop-loss floor. "
            "Look at the bottom-left: it doesn't just chat back. "
            "It compiles deterministic EVM ABI hex calldata for HSK Chain and locks the on-chain risk sliders in real time. "
            "In the center, before any order hits HSK Swap, our engine runs a 1,000-path Monte Carlo stochastic simulation "
            "for 99 percent Value-at-Risk and forces three adversarial agents—Alpha Hunter, CCIP Macro Oracle, and Risk Guard—to "
            "reach cryptographic consensus in 28 milliseconds."
        ),
        "rate": "+19%"
    },
    "stage3": {
        "text": (
            "Now let's hit the HSK Swap constant-product pools with real stress. "
            "First: a 15,000 dollar whale dump hits the HSK USDT pool. "
            "Instead of getting sandwiched, our calculus router calculates the exact optimal input delta and fires an Atomic Backrun—restoring "
            "the pool peg and harvesting pure reserve surplus. "
            "Second: a 15 percent Black-Swan crash hits. The on-chain Circuit Breaker immediately trips, "
            "evacuating volatile exposure back into USDT before drawdown breaches the floor. "
            "Third: using Chainlink CCIP, we monitor cross-chain basis against Ethereum, Arbitrum, and Base—firing "
            "a cross-chain hedge the moment spreads cross 35 basis points."
        ),
        "rate": "+22%"
    },
    "stage4": {
        "text": (
            "Finally, we killed fake signal fees using HashKey's HSP protocol. "
            "In our settlement stream, the execution agent pays a 10 percent micro-fee to the signal agent only "
            "when a trade closes in verified net USDT profit. Losing signal? Zero payout. "
            "One click on Export Institutional Audit pulls the full cryptographic proof bundle—compiled vault artifacts, "
            "HSK Mainnet state, CCIP message receipts, and HSP settlement ledgers—ready for deployment straight to HSK Chain Mainnet."
        ),
        "rate": "+20%"
    }
}

async def generate():
    print(f"🎙️ Generating Neural Voiceover using voice: {VOICE}...")
    for stage_id, data in STAGES.items():
        mp3_path = os.path.join(AUDIO_DIR, f"{stage_id}.mp3")
        print(f"Generating {stage_id} -> {mp3_path}...")
        communicate = edge_tts.Communicate(data["text"], VOICE, rate=data["rate"])
        await communicate.save(mp3_path)
        print(f"✅ Generated {stage_id}.mp3 ({os.path.getsize(mp3_path)} bytes)")

if __name__ == "__main__":
    asyncio.run(generate())
