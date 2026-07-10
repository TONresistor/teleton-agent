Deploy Your Own AI Agent on Telegram in 5 Minutes


Teleton is an autonomous AI agent that runs as a real Telegram user account. Not a bot. It thinks, calls tools, remembers everything, and integrates the TON blockchain natively. 128 base tools plus 5 optional system tools, 16 LLM providers, open source.

3 steps. Let's go.


What You Need

- Node.js 22.22.2+ LTS (Node 24 requires 24.15.0+; nodejs.org)
- Telegram API credentials from my.telegram.org/apps (API ID + API Hash)
- Your Telegram user ID (send /start to @userinfobot)
- An LLM API key (Anthropic, OpenAI, Google, xAI, Groq, Mistral, or any other)

[IMAGE - my.telegram.org/apps page]


Step 1 - Install

npm install -g teleton@latest

[IMAGE - terminal install]


Step 2 - Setup

teleton setup --ui

This opens a wizard in your browser. 6 screens:

- Pick your LLM provider, paste your API key, choose a model
- Set your admin ID and access policies
- Save your auto-generated TON wallet seed phrase
- Enter your Telegram API ID, API Hash, and phone number
- Connect to Telegram (enter the code sent to your phone)
- Click Start Agent

Done. The agent is running.

[IMAGE - wizard provider screen]
[IMAGE - wizard connect success]
[IMAGE - dashboard with green checks]


Step 3 - Bootstrap

Send /boot to your agent on Telegram.

The agent starts a first-contact conversation. It asks your name, preferences, timezone, what you want to use it for. You pick a name and personality for it together. It explains what it can do: Telegram messaging, TON wallet and DEX trading, web search, file management, scheduling, and more.

Everything is saved to memory. You only do this once.

[IMAGE - Telegram bootstrap conversation]


That's it. Your agent is live.


Links

github.com/TONresistor/teleton-agent
docs.teletonagent.dev
teletonagent.dev
@teletonagents on Telegram
