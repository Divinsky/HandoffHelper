# HANDOFF 90-Second Demo Script

Live URL: https://handoffhelper.com

Use ChatGPT's in-app browser, or Chrome with `chrome://flags/#enable-webmcp-testing` enabled. Click **Reset demo** before recording so CASE-1042 starts open with no pending approvals.

Suggested agent prompt:

```text
Use HANDOFF's WebMCP tools to inspect CASE-1042, draft an apologetic customer reply, propose a $2,388 refund, wait for human approval to issue the refund, then wait for human approval to send the reply.
```

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
