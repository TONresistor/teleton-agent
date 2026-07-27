# Tools — 135 total

## Telegram — Messaging (15)

| Tool | Description |
|------|-------------|
| `telegram_send_message` | Send a text message to a chat |
| `telegram_edit_message` | Modify a previously sent message |
| `telegram_delete_message` | Delete messages from a chat |
| `telegram_forward_message` | Forward messages to another chat |
| `telegram_quote_reply` | Reply to a specific excerpt within a message |
| `telegram_get_replies` | Fetch all replies in a message thread |
| `telegram_search_messages` | Search messages by text query within one chat |
| `telegram_search_global` | Search live messages across all account chats |
| `telegram_search_posts` | Search posts across public Telegram channels |
| `telegram_schedule_message` | Queue a message for delayed delivery |
| `telegram_get_scheduled_messages` | List pending scheduled messages |
| `telegram_delete_scheduled_message` | Cancel scheduled messages |
| `telegram_send_scheduled_now` | Send scheduled messages immediately |
| `telegram_pin_message` | Pin a message in a chat |
| `telegram_unpin_message` | Unpin a message or all messages |

## Telegram — Chats (12)

| Tool | Description |
|------|-------------|
| `telegram_get_dialogs` | List all conversations with unread counts |
| `telegram_get_history` | Retrieve message history from a chat |
| `telegram_get_chat_info` | Get detailed info about a chat/group/channel/user |
| `telegram_mark_as_read` | Mark messages as read |
| `telegram_join_channel` | Join a channel or group |
| `telegram_leave_channel` | Leave a channel or group |
| `telegram_create_channel` | Create a new channel or megagroup |
| `telegram_edit_channel_info` | Edit channel/group title and description |
| `telegram_invite_to_channel` | Invite users to a channel or group |
| `telegram_get_admined_channels` | List channels where you have admin rights |
| `telegram_check_channel_username` | Check if a username is available for a channel |
| `telegram_set_channel_username` | Set or remove a channel's public username |

## Telegram — Contacts (5)

| Tool | Description |
|------|-------------|
| `telegram_get_user_info` | Inspect a user profile by username or ID |
| `telegram_check_username` | Resolve @username to entity; check availability |
| `telegram_get_common_chats` | Find shared groups/channels with a user |
| `telegram_block_user` | Block a user |
| `telegram_get_blocked` | List blocked users |

## Telegram — Groups (7)

| Tool | Description |
|------|-------------|
| `telegram_get_me` | Fetch your own account profile |
| `telegram_get_participants` | List participants of a group or channel |
| `telegram_kick_user` | Kick a user from a group |
| `telegram_ban_user` | Ban a user from a group |
| `telegram_unban_user` | Unban a user from a group |
| `telegram_create_group` | Create a new group chat |
| `telegram_set_chat_photo` | Set or delete a group/channel photo |

## Telegram — Media (7)

| Tool | Description |
|------|-------------|
| `telegram_send_photo` | Send a photo from a local file |
| `telegram_send_voice` | Send a voice message (file or TTS) |
| `telegram_send_sticker` | Send a sticker via pack or local file |
| `telegram_send_gif` | Send a GIF via search or local file |
| `telegram_download_media` | Download media from a message |
| `vision_analyze` | Analyze an image using the vision LLM |
| `telegram_transcribe_audio` | Transcribe voice/audio to text |

## Telegram — Memory (4)

| Tool | Description |
|------|-------------|
| `memory_write` | Save to agent memory (core, persistent, daily) |
| `memory_read` | Read agent memory |
| `memory_search` | Search memory/knowledge by keyword |
| `session_search` | Search past messages in this chat |

## Telegram — Interactive (5)

| Tool | Description |
|------|-------------|
| `telegram_create_poll` | Create a poll |
| `telegram_create_quiz` | Create a quiz (poll with correct answer) |
| `telegram_reply_keyboard` | Send a custom reply keyboard |
| `telegram_react` | Attach an emoji reaction to a message |
| `telegram_send_dice` | Roll an animated dice/game |

## Telegram — Folders (3)

| Tool | Description |
|------|-------------|
| `telegram_get_folders` | List all chat folders |
| `telegram_create_folder` | Create a new chat folder |
| `telegram_add_chat_to_folder` | Add a chat to a folder |

## Telegram — Profile (4)

| Tool | Description |
|------|-------------|
| `telegram_update_profile` | Update your name and bio |
| `telegram_set_bio` | Set your bio (max 70 chars) |
| `telegram_set_username` | Set your @username |
| `telegram_set_personal_channel` | Set personal channel on profile |

## Telegram — Stickers (4)

| Tool | Description |
|------|-------------|
| `telegram_search_stickers` | Search sticker packs by keyword/emoji |
| `telegram_search_gifs` | Search GIFs via @gif bot |
| `telegram_get_my_stickers` | List installed sticker packs |
| `telegram_add_sticker_set` | Install a sticker pack |

## Telegram — Stars (2)

| Tool | Description |
|------|-------------|
| `telegram_get_stars_balance` | Get your Stars balance |
| `telegram_get_stars_transactions` | Get Stars transaction history |

## Telegram — Gifts (13)

| Tool | Description |
|------|-------------|
| `telegram_get_available_gifts` | Browse Star Gift catalog |
| `telegram_send_gift` | Send a Star Gift to a user |
| `telegram_get_my_gifts` | Get received Star Gifts |
| `telegram_transfer_collectible` | Transfer a collectible gift |
| `telegram_set_collectible_price` | Price a collectible on resale marketplace |
| `telegram_get_resale_gifts` | Browse collectibles listed for resale |
| `telegram_buy_resale_gift` | Buy a collectible from resale marketplace |
| `telegram_set_gift_status` | Set a collectible as emoji status |
| `telegram_get_collectible_info` | Get Fragment collectible info |
| `telegram_get_unique_gift` | Look up a unique NFT gift by slug |
| `telegram_get_unique_gift_value` | Appraise a unique NFT gift |
| `telegram_send_gift_offer` | Send a buy offer on a unique NFT gift |
| `telegram_resolve_gift_offer` | Accept or decline a gift offer |

## Telegram — Stories & Tasks (2)

| Tool | Description |
|------|-------------|
| `telegram_send_story` | Post a disappearing story |
| `telegram_create_scheduled_task` | Schedule a task for future execution |

## Telegram — Bot (1)

| Tool | Description |
|------|-------------|
| `telegram_send_buttons` | Send inline keyboard buttons (bot mode) |

## TON Blockchain (16)

| Tool | Description |
|------|-------------|
| `ton_get_address` | Get your TON wallet address |
| `ton_get_balance` | Check your TON balance |
| `ton_price` | Fetch TON/USD market price |
| `ton_send` | Transfer TON to an address |
| `ton_get_transactions` | Fetch tx history for an address |
| `ton_my_transactions` | List your recent transactions |
| `ton_chart` | Display price chart for TON or a jetton |
| `nft_list` | Browse NFTs owned by a wallet |
| `jetton_send` | Transfer jetton tokens |
| `jetton_balances` | List all jetton balances |
| `jetton_info` | Look up jetton contract metadata |
| `jetton_price` | Fetch jetton spot price |
| `jetton_holders` | List top jetton holders |
| `jetton_history` | Fetch jetton market analytics |
| `dex_quote` | Compare DEX swap quotes (STON.fi vs DeDust) |

## TON DNS (8)

| Tool | Description |
|------|-------------|
| `dns_check` | Check .ton domain status |
| `dns_auctions` | List active .ton domain auctions |
| `dns_resolve` | Resolve .ton domain to wallet address |
| `dns_start_auction` | Start auction for unminted .ton domain |
| `dns_bid` | Place bid on .ton domain auction |
| `dns_link` | Link wallet to .ton domain |
| `dns_unlink` | Remove wallet link from .ton domain |
| `dns_set_site` | Set TON Site (ADNL) record |

## STON.fi DEX (5)

| Tool | Description |
|------|-------------|
| `stonfi_swap` | Execute a token swap |
| `stonfi_quote` | Get swap price quote |
| `stonfi_search` | Search jettons by name/symbol |
| `stonfi_trending` | Get trending jettons |
| `stonfi_pools` | List liquidity pools |

## DeDust DEX (5)

| Tool | Description |
|------|-------------|
| `dedust_swap` | Execute a token swap |
| `dedust_quote` | Get swap price quote |
| `dedust_pools` | List liquidity pools |
| `dedust_prices` | Get real-time token prices |
| `dedust_token_info` | Get token info by address/symbol |

## Trading Journal (3)

| Tool | Description |
|------|-------------|
| `journal_log` | Log a business operation with reasoning |
| `journal_query` | Query journal with filters and P&L summary |
| `journal_update` | Update entry with outcome/P&L/tx_hash |

## Workspace (6)

| Tool | Description |
|------|-------------|
| `workspace_list` | List files in workspace |
| `workspace_read` | Read a workspace file |
| `workspace_write` | Write a workspace file |
| `workspace_delete` | Delete a workspace file |
| `workspace_info` | Get workspace structure and usage |
| `workspace_rename` | Rename or move a workspace file |

## Web (2)

| Tool | Description |
|------|-------------|
| `web_search` | Search the web |
| `web_fetch` | Fetch and extract readable text from a URL |

## Bot Inline (1)

| Tool | Description |
|------|-------------|
| `bot_inline_send` | Send an inline bot result into a chat |

## Exec — System (4, plugin)

| Tool | Description |
|------|-------------|
| `exec_run` | Execute a bash command on the host |
| `exec_install` | Install packages (apt/pip/npm/docker) |
| `exec_service` | Manage systemd services |
| `exec_status` | Get server status (disk/RAM/CPU/uptime) |

## Deals — Escrow (5, plugin)

| Tool | Description |
|------|-------------|
| `deal_propose` | Create a trade deal with Accept/Decline buttons |
| `deal_verify_payment` | Verify payment for a deal; auto-executes on success |
| `deal_status` | Get deal details by ID |
| `deal_list` | List recent deals |
| `deal_cancel` | Cancel a deal |
