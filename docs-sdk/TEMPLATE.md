# HTML Template for SDK Reference Pages

Use this exact HTML structure for every page. Replace PLACEHOLDERS in CAPS.

## Sidebar HTML (same for ALL pages — add `active` class to the current page link)

```html
<div class="nav-section"><div class="nav-section-title">Start Here</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="/index.html" class="nav-link">Introduction</a></li><li><a href="installation.html" class="nav-link">Installation</a></li><li><a href="quickstart.html" class="nav-link">Quick Start</a></li><li><a href="configuration.html" class="nav-link">Configuration</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">Understand</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="architecture.html" class="nav-link">Architecture</a></li><li><a href="agentic-loop.html" class="nav-link">Agentic Loop</a></li><li><a href="memory-system.html" class="nav-link">Memory System</a></li><li><a href="security.html" class="nav-link">Security</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">Tools</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="tools-telegram.html" class="nav-link">Telegram (83)</a></li><li><a href="tools-ton.html" class="nav-link">TON Blockchain (15)</a></li><li><a href="tools-dex.html" class="nav-link">DEX Trading (10)</a></li><li><a href="tools-dns.html" class="nav-link">DNS &amp; Domains (8)</a></li><li><a href="tools-other.html" class="nav-link">Utilities</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">Configure</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="multi-llm.html" class="nav-link">Multi-LLM Providers</a></li><li><a href="scheduled-tasks.html" class="nav-link">Scheduled Tasks</a></li><li><a href="webui.html" class="nav-link">WebUI Dashboard</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">Build Plugins</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="plugin-sdk.html" class="nav-link">Plugin SDK</a></li><li><a href="create-plugin.html" class="nav-link">Create a Plugin</a></li><li><a href="api-events.html" class="nav-link">Plugin Lifecycle</a></li><li><a href="mcp-servers.html" class="nav-link">MCP Servers</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">SDK Reference</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="sdk-overview.html" class="nav-link">Overview</a></li><li><a href="sdk-ton.html" class="nav-link">TON Blockchain</a></li><li><a href="sdk-dex.html" class="nav-link">DEX Trading</a></li><li><a href="sdk-dns.html" class="nav-link">DNS &amp; Domains</a></li><li><a href="sdk-telegram.html" class="nav-link">Telegram</a></li><li><a href="sdk-bot.html" class="nav-link">Bot SDK</a></li><li><a href="sdk-utilities.html" class="nav-link">Utilities</a></li><li><a href="sdk-errors.html" class="nav-link">Error Handling</a></li><li><a href="tutorial-payment-bot.html" class="nav-link">Tutorial: Payment Bot</a></li><li><a href="tutorial-dex-bot.html" class="nav-link">Tutorial: DEX Bot</a></li><li><a href="tutorial-inline-bot.html" class="nav-link">Tutorial: Inline Bot</a></li></div></ul></div>
<div class="nav-section"><div class="nav-section-title">Deploy &amp; Manage</div><ul class="nav-list"><div class="nav-list-inner"><li><a href="deploy-docker.html" class="nav-link">Docker</a></li><li><a href="api-commands.html" class="nav-link">Admin Commands</a></li><li><a href="api-config.html" class="nav-link">Config Schema</a></li><li><a href="cli-reference.html" class="nav-link">CLI Reference</a></li></div></ul></div>
```

## Full Page Skeleton

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PAGE_TITLE - Teleton Agent Documentation</title>
    <meta name="description" content="PAGE_DESCRIPTION">
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
    <link href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" id="hljs-theme">
    <link rel="stylesheet" href="/css/style.css?v=5">
</head>
<body data-page="PAGE_ID">
    <div class="overlay" id="overlay"></div>
    <header class="header"><div class="header-inner">
        <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
        <a href="/index.html" class="logo"><svg viewBox="0 0 56 56" fill="none" width="28" height="28"><path d="M28 56C43.464 56 56 43.464 56 28C56 12.536 43.464 0 28 0C12.536 0 0 12.536 0 28C0 43.464 12.536 56 28 56Z" fill="#0098EA"/><path d="M37.5603 15.6277H18.4386C14.9228 15.6277 12.6944 19.4202 14.4632 22.4861L26.2644 42.9409C27.0345 44.2765 28.9644 44.2765 29.7345 42.9409L41.5381 22.4861C43.3045 19.4251 41.0761 15.6277 37.5627 15.6277H37.5603ZM26.2548 36.8068L23.6847 31.8327L17.4833 20.7414C17.0742 20.0315 17.5795 19.1218 18.4362 19.1218H26.2524V36.8092L26.2548 36.8068ZM38.5108 20.739L32.3118 31.8351L29.7417 36.8068V19.1194H37.5579C38.4146 19.1194 38.9199 20.0291 38.5108 20.739Z" fill="white"/></svg><span>Teleton Agent Docs</span></a>
        <div class="header-actions">
            <button class="search-btn" id="searchBtn" aria-label="Search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span class="search-hint">Search...</span><kbd>Ctrl+K</kbd></button>
            <button class="lang-toggle" id="langToggle" aria-label="Toggle language">EN</button>
            <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme"><svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg><svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></button>
            <a href="https://github.com/TONresistor/teleton-agent" class="github-link" target="_blank" rel="noopener" aria-label="GitHub"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></a>
        </div>
    </div></header>
    <div class="search-modal" id="searchModal"><div class="search-modal-content"><div class="search-input-wrapper"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><input type="text" id="searchInput" placeholder="Search documentation..." autocomplete="off"><kbd>ESC</kbd></div><div class="search-results" id="searchResults"><div class="search-empty">Start typing to search...</div></div></div></div>
    <div class="layout">
        <aside class="sidebar" id="sidebar"><nav class="sidebar-nav">
            SIDEBAR_HTML_HERE (with active class on current page)
        </nav></aside>
        <main class="main"><article class="content">

            PAGE_CONTENT_HERE

        </article></main>
    </div>
    <footer class="footer"><div class="footer-inner"><div class="footer-left"><p>Teleton Agent &copy; 2026</p></div><div class="footer-links"><a href="https://t.me/teletonagents" target="_blank">Telegram</a><a href="https://github.com/TONresistor/teleton-agent" target="_blank">GitHub</a><a href="https://teletonagent.dev" target="_blank">Website</a></div></div></footer>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
    <script src="/js/main.js?v=5"></script>
    <script src="/js/i18n.js?v=1"></script>
</body>
</html>
```

## Content Patterns

### Method table:
```html
<div class="table-wrapper"><table>
    <thead><tr><th>Method</th><th>Returns</th><th>Description</th></tr></thead>
    <tbody>
        <tr><td><code>methodName(params)</code></td><td><code>ReturnType</code></td><td>Description text.</td></tr>
    </tbody>
</table></div>
```

### Code example:
```html
<div class="code-block"><div class="code-header"><span>Title</span></div><pre><code class="language-typescript">// code here</code></pre></div>
```

### Section with ID (for anchor links):
```html
<section class="section" id="section-id">
    <h2>Section Title</h2>
    <p>Content...</p>
</section>
```

### Lead paragraph:
```html
<p class="lead">Intro text with <code>inline code</code>.</p>
```

## IMPORTANT HTML Escaping Rules
- Use `&lt;` for `<` and `&gt;` for `>` in type signatures inside HTML (e.g., `Promise&lt;string&gt;`)
- Use `&amp;` for `&`
- Use `&#x1F4B0;` etc. for emojis
- Backtick code in <code> tags, NOT raw backticks
