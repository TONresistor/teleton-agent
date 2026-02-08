#!/bin/bash
# Patch GramJS TL schema to support KeyboardButtonStyle (Telegram layer 222)
# This adds colored button support for inline keyboards via MTProto.
#
# New constructors:
#   keyboardButtonStyle#4fdd3430 - button color/style (bg_success, bg_danger, bg_primary)
#   keyboardButtonCallback#e62bc960 - updated callback button with optional style field

set -euo pipefail

# Resolve path: works for both local dev and global npm install
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(dirname "$SCRIPT_DIR")"
APITL="$PKG_ROOT/node_modules/telegram/tl/apiTl.js"

# Check if already patched
if grep -q "keyboardButtonStyle#4fdd3430" "$APITL" 2>/dev/null; then
  echo "✅ GramJS TL schema already patched"
  exit 0
fi

# Check if file exists
if [ ! -f "$APITL" ]; then
  echo "⚠️  GramJS not found at $APITL, skipping patch"
  exit 0
fi

# Verify the old constructor exists (guards against GramJS version changes)
if ! grep -q "keyboardButtonCallback#35bbdb6b" "$APITL"; then
  echo "⚠️  Old keyboardButtonCallback#35bbdb6b not found, GramJS version may have changed"
  exit 0
fi

# Patch: replace old keyboardButtonCallback with:
# 1. keyboardButtonStyle type (new)
# 2. keyboardButtonCallbackLegacy (old constructor kept for deserialization)
# 3. keyboardButtonCallback (new constructor with style field)
sed -i 's|keyboardButtonCallback#35bbdb6b flags:# requires_password:flags.0?true text:string data:bytes = KeyboardButton;|keyboardButtonStyle#4fdd3430 flags:# bg_primary:flags.0?true bg_danger:flags.1?true bg_success:flags.2?true icon:flags.3?long = KeyboardButtonStyle;\nkeyboardButtonCallbackLegacy#35bbdb6b flags:# requires_password:flags.0?true text:string data:bytes = KeyboardButton;\nkeyboardButtonCallback#e62bc960 flags:# requires_password:flags.0?true style:flags.10?KeyboardButtonStyle text:string data:bytes = KeyboardButton;|' "$APITL"

# Verify patch was applied
if grep -q "keyboardButtonStyle#4fdd3430" "$APITL"; then
  echo "✅ GramJS TL schema patched (KeyboardButtonStyle + styled KeyboardButtonCallback)"
else
  echo "❌ Failed to patch GramJS TL schema"
  exit 1
fi
