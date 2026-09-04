# HANDOFF

HANDOFF is a live multiplayer ops room where a human support lead and an AI agent work the same support or incident case on the same page. The agent does not click the DOM. It calls WebMCP tools, and Jordan, the human support lead, sees every agent action in the timeline and keeps approval control over money-moving or outbound-customer actions.

Live app: https://handoffhelper.com  
Public repository: https://github.com/Divinsky/HandoffHelper

The app is a single static page with deterministic demo data, no backend, no auth, and local persistence under `localStorage` key `handoff.v1`.

## Why WebMCP

WebMCP is the right surface for HANDOFF because the human and agent share one live browser state. The agent gets structured tools with clear schemas instead of guessing at buttons, and the human gets visible state changes, a tool log, and approval gates for consequential work.

In our words, the YC Multiplayer AI idea is that agent work should not be trapped in private one-person threads: it should feel like a live shared session teammates can watch, redirect, and hand off, the way they already collaborate in Figma or Google Docs. HANDOFF uses support as the first vertical because the stakes are legible, but the product is the shared live agent session itself.

## Tools

| Tool | Read-only | Purpose |
| --- | --- | --- |
| `get_workspace` | Yes | List cases, severity, status, refund state, unread flags, and approval counts. |
| `get_case` | Yes | Read one full case, recent timeline, pending approvals, and draft reply. |
| `update_case_status` | No | Change a case status with an agent-authored timeline note. |
| `add_comment` | No | Add an internal or customer-visible note without sending a reply. |
| `draft_customer_reply` | No | Create or replace a visible draft reply. |
| `send_customer_reply` | No | Request human approval before sending the current draft. |
| `propose_refund` | No | Propose a refund and create a pending approval without moving money. |
| `issue_refund` | No | Request human approval to issue a previously proposed refund. |
| `page_oncall` | No | Request human approval before paging `billing-primary`. |
| `list_pending_approvals` | Yes | List the full pending approval queue. |
| `resolve_case` | No | Request human approval to close a case; refuses unresolved P1 refund work. |

## Run Locally

Serve the folder from localhost for the human UI and WebMCP testing:

```sh
python -m http.server 8080
```

Then open `http://localhost:8080`.

Cloudflare Pages should serve the contents of `dist/`. Keep these source files synced before redeploying:

- `dist/index.html`
- `dist/app.js`
- `dist/styles.css`

## Test In ChatGPT Or Chrome

In ChatGPT's in-app browser, open the deployed HANDOFF URL and inspect Site tools from the browser address bar. Use GPT-5.6 Sol or GPT-5.6 Terra for site tools.

For local Chrome testing:

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set the flag to Enabled.
3. Relaunch Chrome.
4. Serve this folder from localhost and open the local URL.

If WebMCP is unavailable, HANDOFF still runs as a human-only ops room and shows the banner: “WebMCP not detected. Enable chrome://flags/#enable-webmcp-testing or open this URL in ChatGPT’s in-app browser. Human UI still works.”

## Judge Demo Script

1. Open Handoff. Point at CASE-1042: duplicate $2,388 charge, P1, customer waiting.
2. Point at two identities: Jordan (human) and Handoff (agent).
3. Show WebMCP ready banner and the tool list.
4. Say: “I’m going to ask the agent, in ChatGPT’s browser, to handle this case with tools instead of clicking.”
5. Agent calls get_case, then draft_customer_reply apologetic, then propose_refund 2388.
6. Show the draft appear and the refund approval card appear live.
7. Human rejects nothing yet. Human clicks Approve on the refund. Status becomes refunded / issued.
8. Agent calls send_customer_reply. Approval modal appears. Human approves. Timeline shows reply sent.
9. Human posts an internal comment: “Good. Watch the chargeback window.”
10. Close on the line: “Same page, two identities, structured tools, human keeps the kill switch.”

## Challenge Submission Checklist

- Working live URL: `https://handoffhelper.com`
- Public code repository: `https://github.com/Divinsky/HandoffHelper`
- Open source license: MIT in `LICENSE`
- Run instructions: this README
- Demo script: `DEMO.md`
- WebMCP implementation: imperative `document.modelContext.registerTool(...)` calls in `app.js`
- Safety model: `issue_refund`, `send_customer_reply`, `page_oncall`, and `resolve_case` require visible human approval before side effects

## License

MIT. See `LICENSE`.
