# Design: Move Model Selection Into Provider Step

**Date**: 2026-02-24
**Status**: Approved
**Scope**: CLI onboard wizard + WebUI setup wizard

## Problem

The setup wizard (CLI and WebUI) separates provider selection (Step 1) from model selection (Step 3 "Config"). Users expect to choose the model right after selecting the provider and entering the API key. The current flow forces them through unrelated steps (Telegram credentials) before reaching model selection, which is confusing.

## Decision

Move the model selector from Step 3 ("Config") into Step 1 ("Provider"), immediately after API key entry. This applies to advanced mode only; QuickStart continues to use the provider's default model.

## Changes

### CLI (`src/cli/commands/onboard.ts`)

- Move the model selection block (select + custom input) from Step 3 into Step 1, after API key entry
- Guard with `selectedFlow === "advanced"` and `provider !== "cocoon" && provider !== "local"` (unchanged)
- Update STEPS labels: Step 1 desc becomes `"LLM, key & model"`, Step 3 desc becomes `"Policies"`
- Step 3 retains: DM policy, group policy, require mention, max agentic iterations

### WebUI Frontend

- **`ProviderStep.tsx`**: Add model selector after API key input. Fetch `GET /models/:provider` when provider changes. Show dropdown with custom option.
- **`ConfigStep.tsx`**: Remove model selector section.
- **`SetupContext.tsx`**: Step 1 validation checks that model is set (or falls back to provider default).

### Backend (`src/webui/routes/setup.ts`)

No changes. Existing endpoints `GET /providers` and `GET /models/:provider` are sufficient.

## Flow After Change

```
Step 0: Agent     — name, mode (quick/advanced)
Step 1: Provider  — provider, API key, model (advanced only)
Step 2: Telegram  — API ID, hash, phone, user ID
Step 3: Config    — policies (DM, group, mention, max iterations)
Step 4: Modules   — deals bot, TonAPI, Tavily
Step 5: Wallet    — generate/import TON wallet
Step 6: Connect   — Telegram authentication
```

## Edge Cases

- **Providers without model selection** (cocoon, local): No model selector shown — unchanged
- **claude-code provider**: Uses `anthropic` model catalog — unchanged
- **Custom model**: "Custom" option with free text input — unchanged
- **QuickStart mode**: Skips model selection, uses provider default — unchanged
