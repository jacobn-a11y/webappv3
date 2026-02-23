#!/usr/bin/env node

/**
 * Gong Story Engine — MCP Server
 *
 * A Model Context Protocol server that connects to the Gong API to fetch
 * call recordings and transcripts, enabling Claude to generate customer
 * stories directly in chat.
 *
 * Tools:
 *   - gong_search_calls      — Search for calls by date, company, or participant
 *   - gong_get_transcripts    — Fetch formatted transcripts with speaker names and timestamps
 *   - gong_export_quotes_csv  — Extract all quotes from calls as CSV
 *   - gong_list_users         — List internal Gong users
 *
 * Prompts:
 *   - generate_story          — Master story generation prompt with full taxonomy
 *   - extract_quotes          — Quote extraction and categorization prompt
 *   - list_story_types        — Reference of all available story types
 *
 * Configuration:
 *   Environment variables:
 *     GONG_ACCESS_KEY         — Gong API access key (required)
 *     GONG_ACCESS_KEY_SECRET  — Gong API secret key (required)
 *     GONG_BASE_URL           — Gong API base URL (optional, defaults to https://api.gong.io)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GongClient, quotesToCsv } from "./gong-client.js";
import {
  MASTER_STORY_SYSTEM_PROMPT,
  buildStoryPromptMessages,
  buildQuoteExtractionMessages,
  getFullTaxonomyReference,
  getAllStoryTypeKeys,
  getAllFormatKeys,
  getAllLengthKeys,
  getAllOutlineKeys,
} from "./prompts.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_ACCESS_KEY_SECRET = process.env.GONG_ACCESS_KEY_SECRET;
const GONG_BASE_URL = process.env.GONG_BASE_URL;

function getGongClient(): GongClient {
  if (!GONG_ACCESS_KEY || !GONG_ACCESS_KEY_SECRET) {
    throw new Error(
      "Missing Gong API credentials. Set GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET environment variables."
    );
  }
  return new GongClient({
    accessKey: GONG_ACCESS_KEY,
    accessKeySecret: GONG_ACCESS_KEY_SECRET,
    baseUrl: GONG_BASE_URL,
  });
}

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "gong-story-engine",
  version: "1.0.0",
});

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Search for calls in Gong.
 * Supports filtering by date range, company/account name, and participant email.
 */
server.tool(
  "gong_search_calls",
  "Search for calls in Gong by date range, company name, or participant email. Returns call metadata including title, date, duration, participants, and Gong URL.",
  {
    from_date: z
      .string()
      .optional()
      .describe(
        "Start date filter (ISO 8601 format, e.g. 2024-01-01T00:00:00Z). Defaults to 90 days ago."
      ),
    to_date: z
      .string()
      .optional()
      .describe(
        "End date filter (ISO 8601 format). Defaults to now."
      ),
    company_name: z
      .string()
      .optional()
      .describe(
        "Filter calls by company/account name (fuzzy matches against participant names, email domains, and CRM data)"
      ),
    speaker_email: z
      .string()
      .optional()
      .describe("Filter calls by a specific participant's email address"),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of calls to return (default 50, max 500)"),
  },
  async (args) => {
    try {
      const client = getGongClient();

      // Default date range: last 90 days
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const calls = await client.searchCalls({
        fromDate: args.from_date ?? ninetyDaysAgo.toISOString(),
        toDate: args.to_date ?? now.toISOString(),
        companyName: args.company_name,
        speakerEmail: args.speaker_email,
        maxResults: Math.min(args.max_results ?? 50, 500),
      });

      if (calls.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No calls found matching your search criteria. Try broadening your date range or search terms.",
            },
          ],
        };
      }

      // Format as readable markdown
      const lines: string[] = [
        `# Gong Calls Found: ${calls.length}\n`,
      ];

      for (const call of calls) {
        const participants = call.participants
          .map((p) => {
            const aff =
              p.affiliation === "INTERNAL"
                ? " [Internal]"
                : p.company
                  ? ` (${p.company})`
                  : "";
            return `${p.name}${aff}`;
          })
          .join(", ");

        lines.push(`## ${call.title} — ${call.date} (${call.durationMinutes} min)`);
        lines.push(`- **Call ID:** \`${call.id}\``);
        lines.push(`- **Participants:** ${participants}`);
        if (call.url) lines.push(`- **URL:** ${call.url}`);
        lines.push("");
      }

      lines.push(
        "\n---\n*Use `gong_get_transcripts` with the Call IDs above to fetch full transcripts for story generation.*"
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching Gong calls: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * Fetch formatted transcripts for specific calls.
 * Returns full transcript text with speaker names resolved, timestamps, and call metadata.
 */
server.tool(
  "gong_get_transcripts",
  "Fetch full transcripts for specific Gong calls. Returns speaker-attributed, timestamped transcript text in markdown format — ready for story generation. Each utterance includes [MM:SS] timestamp, speaker name, and affiliation.",
  {
    call_ids: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe("Array of Gong call IDs to fetch transcripts for (max 50)"),
  },
  async (args) => {
    try {
      const client = getGongClient();
      const transcripts = await client.getTranscripts(args.call_ids);

      if (transcripts.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No transcripts found for the provided call IDs. The calls may not have recordings or transcripts available yet.",
            },
          ],
        };
      }

      // Combine all transcript markdown
      const header = `# Transcripts for ${transcripts.length} Call${transcripts.length > 1 ? "s" : ""}\n`;
      const dateRange =
        transcripts.length > 1
          ? `*Date range: ${transcripts[0]!.callDate} to ${transcripts[transcripts.length - 1]!.callDate}*\n`
          : "";

      const totalUtterances = transcripts.reduce(
        (sum, t) => sum + t.entries.length,
        0
      );
      const stats = `*Total utterances: ${totalUtterances} across ${transcripts.length} call(s)*\n\n---\n`;

      const body = transcripts.map((t) => t.markdown).join("\n\n---\n\n");

      return {
        content: [
          { type: "text", text: header + dateRange + stats + body },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching transcripts: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * Export all utterances from calls as CSV.
 * Each row contains the quote text, speaker, timestamp, call date, and call title.
 */
server.tool(
  "gong_export_quotes_csv",
  "Extract every utterance from Gong calls and format as CSV. Each row includes: Quote, Speaker, Affiliation, Timestamp, Call Date, Call Title, Call ID. Returns CSV text that can be saved as a .csv file and opened in Excel or Google Sheets.",
  {
    call_ids: z
      .array(z.string())
      .min(1)
      .max(50)
      .describe("Array of Gong call IDs to extract quotes from (max 50)"),
    min_words: z
      .number()
      .optional()
      .describe(
        "Minimum word count per quote to include (filters out very short utterances like 'yes', 'okay'). Default: 5"
      ),
  },
  async (args) => {
    try {
      const client = getGongClient();
      const minWords = args.min_words ?? 5;

      const quotes = await client.extractAllQuotes(args.call_ids);
      const filtered = quotes.filter(
        (q) => q.quote_text.split(/\s+/).length >= minWords
      );

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No quotes found matching the criteria. Try lowering the min_words threshold or checking the call IDs.",
            },
          ],
        };
      }

      const csv = quotesToCsv(filtered);

      return {
        content: [
          {
            type: "text",
            text: `# Quote Export: ${filtered.length} quotes from ${args.call_ids.length} call(s)\n\nSave the CSV below as a \`.csv\` file to open in Excel or Google Sheets.\n\n\`\`\`csv\n${csv}\n\`\`\``,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting quotes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * List internal Gong users.
 */
server.tool(
  "gong_list_users",
  "List all internal users in your Gong workspace. Returns name, email, title, and active status.",
  {},
  async () => {
    try {
      const client = getGongClient();
      const users = await client.getUsers();

      if (users.length === 0) {
        return {
          content: [{ type: "text", text: "No users found in Gong." }],
        };
      }

      const lines: string[] = [
        `# Gong Users (${users.length})\n`,
        "| Name | Email | Title | Active |",
        "|------|-------|-------|--------|",
      ];

      for (const user of users) {
        const name = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(" ") || "Unknown";
        lines.push(
          `| ${name} | ${user.emailAddress ?? ""} | ${user.title ?? ""} | ${user.active ? "Yes" : "No"} |`
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing users: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Prompts ─────────────────────────────────────────────────────────────────

/**
 * Master story generation prompt.
 * Returns a system message with expert writing instructions and a user message
 * template for generating a specific story type.
 */
server.prompt(
  "generate_story",
  "Generate a customer story from Gong call transcripts. Includes the full B2B story taxonomy, writing guidelines, and quote attribution rules. Use after fetching transcripts with gong_get_transcripts.",
  {
    account_name: z.string().describe("Customer/account name for the story"),
    story_type: z
      .string()
      .optional()
      .describe(
        `Story type focus. Options: FULL_ACCOUNT_JOURNEY, ${getAllStoryTypeKeys().slice(0, 5).join(", ")}... Use list_story_types prompt for the full list.`
      ),
    story_length: z
      .string()
      .optional()
      .describe(
        `Target length: ${getAllLengthKeys().join(", ")}`
      ),
    story_outline: z
      .string()
      .optional()
      .describe(
        `Outline template: ${getAllOutlineKeys().join(", ")}`
      ),
    story_format: z
      .string()
      .optional()
      .describe(
        `Narrative format: ${getAllFormatKeys().join(", ")}`
      ),
    transcript_markdown: z
      .string()
      .describe(
        "The full transcript markdown (output from gong_get_transcripts tool)"
      ),
  },
  async (args) => {
    const messages = buildStoryPromptMessages({
      accountName: args.account_name,
      storyType: args.story_type,
      storyLength: args.story_length,
      storyOutline: args.story_outline,
      storyFormat: args.story_format,
      transcriptMarkdown: args.transcript_markdown,
    });

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: MASTER_STORY_SYSTEM_PROMPT +
              "\n\n---\n\n" +
              messages[0]!.content,
          },
        },
      ],
    };
  }
);

/**
 * Quote extraction and categorization prompt.
 * Extracts all notable quotes from transcripts, categorized by type.
 */
server.prompt(
  "extract_quotes",
  "Extract and categorize all notable quotes from Gong call transcripts. Returns quotes in a markdown table with speaker, timestamp, date, call name, and category.",
  {
    account_name: z.string().describe("Customer/account name"),
    transcript_markdown: z
      .string()
      .describe(
        "The full transcript markdown (output from gong_get_transcripts tool)"
      ),
    focus_area: z
      .string()
      .optional()
      .describe(
        "Optional focus area for quotes (e.g., 'ROI outcomes', 'competitive insights', 'implementation challenges')"
      ),
  },
  async (args) => {
    const messages = buildQuoteExtractionMessages({
      accountName: args.account_name,
      transcriptMarkdown: args.transcript_markdown,
      focusArea: args.focus_area,
    });

    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: messages[0]!.content,
          },
        },
      ],
    };
  }
);

/**
 * List all available story types.
 * Returns the complete taxonomy reference for the user to browse.
 */
server.prompt(
  "list_story_types",
  "Show all available customer story types, formats, lengths, and outline templates. Use this as a reference when choosing story parameters.",
  {},
  async () => {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Show me all available story types I can generate from Gong call data.\n\n${getFullTaxonomyReference()}\n\n---\n\nPlease present this taxonomy in a clear, browsable format. For each story type, explain when it's most useful and what kind of transcript evidence it needs.`,
          },
        },
      ],
    };
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gong Story Engine MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
