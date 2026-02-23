# Gong Story Engine — Claude MCP Plugin

Generate customer stories directly in Claude chat using your Gong call recordings. No separate AI API keys needed — Claude itself does the story generation.

## What It Does

This MCP (Model Context Protocol) server connects Claude to your Gong account, giving you access to:

- **Search calls** by company name, date range, or participant
- **Fetch full transcripts** with speaker names, timestamps, and call metadata
- **Generate any of 50+ story types** across the full B2B sales funnel
- **Extract exact quotes** with speaker, timestamp, date, and call name
- **Export quote spreadsheets** as CSV (open in Excel or Google Sheets)

### Supported Story Types

**Top of Funnel** — Industry trend validation, problem identification, digital transformation, regulatory compliance, market expansion, thought leadership

**Mid-Funnel** — Product deep-dives, competitive displacement, integration stories, implementation/onboarding, security/compliance, customization, cross-sell, partner ecosystem, TCO validation, pilot-to-production

**Bottom of Funnel** — ROI/financial outcomes, operational metrics, executive impact, risk mitigation, deployment speed, vendor selection, procurement experience

**Post-Sale** — Renewal stories, upsell/expansion, customer success, training/enablement, community participation, co-innovation, change management, org scaling, platform governance

**Internal** — Sales enablement, lessons learned, cross-functional collaboration, voice of customer, pricing validation, churn saves, deal anatomy, customer health, reference development, process improvements

**Vertical/Segment** — Industry-specific, company size, persona-specific, geographic, regulated vs. unregulated, public sector

**Format Variations** — Before/after transformation, day-in-the-life, by-the-numbers, executive soundbites, webinar content, peer reference guides, analyst-validated studies

## Prerequisites

1. **Gong API access** — You need a Gong API key pair (access key + secret). Get these from your Gong admin at: Settings → API → Create API Key
2. **Node.js 18+** installed
3. **Claude Desktop** or **Claude Code** for MCP support

## Installation

```bash
# Clone or navigate to the plugin directory
cd mcp-gong-stories

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GONG_ACCESS_KEY` | Yes | Your Gong API access key |
| `GONG_ACCESS_KEY_SECRET` | Yes | Your Gong API secret key |
| `GONG_BASE_URL` | No | Custom Gong API URL (default: `https://api.gong.io`) |

### Claude Desktop Setup

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gong-stories": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-gong-stories/dist/index.js"],
      "env": {
        "GONG_ACCESS_KEY": "your-access-key-here",
        "GONG_ACCESS_KEY_SECRET": "your-secret-key-here"
      }
    }
  }
}
```

### Claude Code Setup

Add to your project's `.claude/settings.json` or global settings:

```json
{
  "mcpServers": {
    "gong-stories": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-gong-stories/dist/index.js"],
      "env": {
        "GONG_ACCESS_KEY": "your-access-key-here",
        "GONG_ACCESS_KEY_SECRET": "your-secret-key-here"
      }
    }
  }
}
```

## Usage Examples

### Generate a Customer Story

```
"Generate a competitive displacement story for Acme Corp from our Gong calls"
```

Claude will:
1. Search for Acme Corp calls using `gong_search_calls`
2. Fetch transcripts with `gong_get_transcripts`
3. Generate a story with exact quotes, timestamps, and speaker attribution

### Extract Quotes as Spreadsheet

```
"Get all quotes from our last 10 calls with Acme Corp and export as a spreadsheet"
```

Claude will:
1. Search for Acme Corp calls
2. Use `gong_export_quotes_csv` to extract every utterance as CSV
3. Present the CSV for you to save as a .csv file

### Explore Story Types

```
"What types of customer stories can I generate from my Gong data?"
```

Claude will use the `list_story_types` prompt to show all 50+ story types with descriptions.

### Specific Story Configurations

```
"Generate a short executive brief about ROI outcomes for BigCo using the by-the-numbers format"
```

Story parameters:
- **story_type:** `roi_financial_outcomes`
- **story_length:** `EXECUTIVE`
- **story_outline:** `BY_THE_NUMBERS`
- **story_format:** `by_the_numbers_snapshot`

## Available Tools

| Tool | Description |
|------|-------------|
| `gong_search_calls` | Search calls by date range, company name, or participant email |
| `gong_get_transcripts` | Fetch full transcripts with speaker names, timestamps, and metadata |
| `gong_export_quotes_csv` | Extract all utterances from calls as CSV with full metadata |
| `gong_list_users` | List internal Gong workspace users |

## Available Prompts

| Prompt | Description |
|--------|-------------|
| `generate_story` | Master story generation with full taxonomy, writing guidelines, and quote rules |
| `extract_quotes` | Extract and categorize all notable quotes from transcripts |
| `list_story_types` | Browse all 50+ available story types, formats, lengths, and outlines |

## Development

```bash
# Run in development mode (auto-reloads)
npm run dev

# Build for production
npm run build

# Run the built server
npm start
```

## Architecture

```
src/
├── index.ts         # MCP server entry point — tool & prompt registration
├── gong-client.ts   # Gong API v2 client — auth, calls, transcripts, quotes
└── prompts.ts       # Story taxonomy, master prompts, and prompt builders
```

The server uses the MCP protocol over stdio. Claude communicates with it directly — no HTTP server, no database, no separate AI API. Your Gong subscription provides the data, Claude provides the intelligence.
