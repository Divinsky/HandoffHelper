const STORAGE_KEY = "handoff.v1";
const HUMAN = { id: "human", name: "Jordan Hale", role: "Support Lead", initial: "J" };
const AGENT = { id: "agent", name: "Handoff", role: "Ops agent", initial: "H" };

const STATUS_OPTIONS = [
  "open",
  "waiting_on_customer",
  "in_progress",
  "resolved",
  "refund_pending",
  "refunded",
];

const TOOL_NAMES = [
  "get_workspace",
  "get_case",
  "update_case_status",
  "add_comment",
  "draft_customer_reply",
  "send_customer_reply",
  "propose_refund",
  "issue_refund",
  "page_oncall",
  "list_pending_approvals",
  "resolve_case",
];

let state = loadState();
let activeApprovalId = null;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindUi();
  render();
  void registerWebMcpTools();
});

function cacheElements() {
  els.caseCount = document.querySelector("#caseCount");
  els.caseList = document.querySelector("#caseList");
  els.caseSummary = document.querySelector("#caseSummary");
  els.pendingApprovals = document.querySelector("#pendingApprovals");
  els.draftReply = document.querySelector("#draftReply");
  els.draftState = document.querySelector("#draftState");
  els.draftChars = document.querySelector("#draftChars");
  els.timeline = document.querySelector("#timeline");
  els.registeredTools = document.querySelector("#registeredTools");
  els.toolLog = document.querySelector("#toolLog");
  els.webmcpBanner = document.querySelector("#webmcpBanner");
  els.agentPulse = document.querySelector("#agentPulse");
  els.replayDemo = document.querySelector("#replayDemo");
  els.humanComposer = document.querySelector("#humanComposer");
  els.humanComment = document.querySelector("#humanComment");
  els.commentVisibility = document.querySelector("#commentVisibility");
  els.askStatus = document.querySelector("#askStatus");
  els.approvalModal = document.querySelector("#approvalModal");
  els.modalTitle = document.querySelector("#modalTitle");
  els.modalBody = document.querySelector("#modalBody");
  els.modalDetails = document.querySelector("#modalDetails");
  els.modalApprove = document.querySelector("#modalApprove");
  els.modalReject = document.querySelector("#modalReject");
}

function bindUi() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  els.caseList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-case-id]");
    if (!button) return;
    state.selectedCaseId = button.dataset.caseId;
    const selectedCase = getCase(state.selectedCaseId);
    selectedCase.unread = false;
    saveState();
    render();
  });

  els.caseSummary.addEventListener("change", (event) => {
    if (event.target.id !== "statusSelect") return;
    const selectedCase = getSelectedCase();
    const nextStatus = event.target.value;
    selectedCase.status = nextStatus;
    addTimeline(selectedCase, {
      actor: "human",
      text: `Changed status to ${formatStatus(nextStatus)}.`,
      stateChange: `Status: ${formatStatus(nextStatus)}`,
    });
    saveState();
    render();
  });

  els.pendingApprovals.addEventListener("click", (event) => {
    const action = event.target.closest("[data-approval-action]");
    if (!action) return;
    const approvalId = action.dataset.approvalId;
    if (action.dataset.approvalAction === "approve") {
      approveApproval(approvalId);
    } else {
      rejectApproval(approvalId);
    }
  });

  els.draftReply.addEventListener("input", () => {
    const selectedCase = getSelectedCase();
    selectedCase.draftReply = els.draftReply.value;
    saveState();
    renderDraftMeta(selectedCase);
  });

  els.humanComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = els.humanComment.value.trim();
    if (!body) return;
    const selectedCase = getSelectedCase();
    addTimeline(selectedCase, {
      actor: "human",
      text: `${els.commentVisibility.value === "internal" ? "Internal note" : "Customer-visible note"}: ${body}`,
      stateChange: "Jordan added context",
    });
    els.humanComment.value = "";
    saveState();
    render();
  });

  document.querySelectorAll("[data-agent-ask]").forEach((button) => {
    button.addEventListener("click", async () => {
      const prompt = button.dataset.agentAsk;
      els.humanComment.value = prompt;
      els.humanComment.focus();
      try {
        await navigator.clipboard.writeText(prompt);
        els.askStatus.textContent = "Copied";
      } catch {
        els.askStatus.textContent = "Ready";
      }
      window.setTimeout(() => {
        els.askStatus.textContent = "";
      }, 1800);
    });
  });

  els.replayDemo.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });

  els.modalApprove.addEventListener("click", () => {
    if (activeApprovalId) approveApproval(activeApprovalId);
  });

  els.modalReject.addEventListener("click", () => {
    if (activeApprovalId) rejectApproval(activeApprovalId);
  });

  els.approvalModal.addEventListener("click", (event) => {
    if (event.target === els.approvalModal) {
      closeApprovalModal();
    }
  });
}

function createSeedState() {
  return {
    selectedCaseId: "CASE-1042",
    filter: "all",
    registeredTools: [],
    toolCalls: [],
    pendingApprovals: [],
    cases: [
      {
        id: "CASE-1042",
        title: "Duplicate charge on Pro annual plan",
        customer: {
          name: "Maya Chen",
          company: "Acme Robotics",
          email: "maya@acmerobotics.com",
        },
        plan: "Pro Annual $2,388",
        issue:
          "Charged twice on Sep 1 after failed webhook retry. Customer in Slack thread 14 minutes, threatening chargeback.",
        description:
          "Maya reports two Pro Annual charges after the Sep 1 billing webhook retried a failed confirmation. The account remains active, finance has one duplicate invoice in review, and the Slack escalation is still warm.",
        status: "open",
        severity: "P1",
        moneyAtRisk: 2388,
        refund: {
          state: "requested",
          requestedAmount: 2388,
          reason: "Duplicate annual plan charge after webhook retry.",
          issuedAt: null,
        },
        unread: true,
        policy:
          "First duplicate charge may be refunded after human approval. Chargebacks are worse than refunds.",
        suggestedNext:
          "Verify invoice, draft apology, request refund approval, then send reply.",
        draftReply: "",
        timeline: [
          event("human", "Slack thread opened by Maya Chen after a duplicate annual charge appeared on the card statement.", "Customer waiting", "2026-09-03T12:42:00-04:00", null, "EVT-1042-001"),
          event("human", "Billing webhook retry matched invoice INV-8841 twice; finance tagged the second charge as likely duplicate.", "Invoice verified", "2026-09-03T12:47:00-04:00", null, "EVT-1042-002"),
          event("human", "Jordan marked this P1 because Maya mentioned chargeback risk in the shared channel.", "Severity: P1", "2026-09-03T12:51:00-04:00", null, "EVT-1042-003"),
          event("human", "Policy check: first duplicate annual charge can be refunded once a human approves the money movement.", "Refund approval required", "2026-09-03T12:55:00-04:00", null, "EVT-1042-004"),
        ],
      },
      {
        id: "CASE-1041",
        title: "SSO login loop after Okta cert rotation",
        customer: {
          name: "Devon Park",
          company: "Northstar Health",
          email: "devon@northstarhealth.example",
        },
        plan: "Enterprise SSO",
        issue: "Okta certificate rotation completed, but users loop between identity provider and dashboard.",
        description:
          "Northstar rotated the Okta signing certificate overnight. Their admin can reach settings, but eight end users bounce back to the sign-in screen after SAML assertion.",
        status: "waiting_on_customer",
        severity: "P2",
        moneyAtRisk: 0,
        refund: { state: "none", requestedAmount: 0, reason: "", issuedAt: null },
        unread: false,
        policy: "SSO incidents need customer metadata before on-call escalation.",
        suggestedNext: "Ask for the SAML trace and confirm the new certificate thumbprint.",
        draftReply:
          "Hi Devon,\n\nThanks for the trace details so far. Could you send the latest SAML response from one affected user and confirm the SHA-256 thumbprint for the new Okta certificate?\n\nJordan",
        timeline: [
          event("human", "Customer reported SSO loop for eight users after Okta certificate rotation.", "Case opened", "2026-09-03T10:15:00-04:00", null, "EVT-1041-001"),
          event("human", "Jordan confirmed admin access still works and requested the SAML trace.", "Waiting on customer", "2026-09-03T10:22:00-04:00", null, "EVT-1041-002"),
          event("human", "Customer sent screenshot but not the assertion payload.", "More evidence needed", "2026-09-03T10:38:00-04:00", null, "EVT-1041-003"),
        ],
      },
      {
        id: "CASE-1038",
        title: "Export CSV missing created_at",
        customer: {
          name: "Priya Shah",
          company: "Lumen Analytics",
          email: "priya@lumenanalytics.example",
        },
        plan: "Team",
        issue: "CSV export for workspace events omits the created_at column introduced in the new schema.",
        description:
          "Priya needs created_at included in the events export for a compliance handoff. Backend has the field; the export mapper is suspected.",
        status: "in_progress",
        severity: "P3",
        moneyAtRisk: 0,
        refund: { state: "none", requestedAmount: 0, reason: "", issuedAt: null },
        unread: false,
        policy: "Data export defects can be resolved with a patch note and replayed export.",
        suggestedNext: "Confirm mapper patch ETA and offer to regenerate the affected export.",
        draftReply: "",
        timeline: [
          event("human", "Priya attached a CSV missing created_at from the workspace events export.", "Case opened", "2026-09-03T09:04:00-04:00", null, "EVT-1038-001"),
          event("human", "Engineering found the API response includes created_at, but the CSV mapper drops it.", "Root cause narrowed", "2026-09-03T09:31:00-04:00", null, "EVT-1038-002"),
          event("human", "Jordan promised a replayed export once the mapper patch is verified.", "Work in progress", "2026-09-03T09:44:00-04:00", null, "EVT-1038-003"),
        ],
      },
    ],
  };
}

function event(actor, text, stateChange, at, toolName = null, id = null) {
  return {
    id: id || crypto.randomUUID(),
    actor,
    actorName: actor === "agent" ? AGENT.name : HUMAN.name,
    role: actor === "agent" ? AGENT.role : HUMAN.role,
    text,
    stateChange,
    at,
    toolName,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw);
    if (!parsed.cases || !Array.isArray(parsed.cases)) return createSeedState();
    return {
      ...createSeedState(),
      ...parsed,
      registeredTools: Array.isArray(parsed.registeredTools) ? parsed.registeredTools : [],
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
      pendingApprovals: Array.isArray(parsed.pendingApprovals) ? parsed.pendingApprovals : [],
    };
  } catch {
    return createSeedState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderBanner();
  renderCaseList();
  renderCaseSummary();
  renderApprovals();
  renderDraft();
  renderTimeline();
  renderInspector();
}

function renderBanner() {
  const count = state.registeredTools.length;
  els.webmcpBanner.classList.remove("is-ready", "is-unavailable", "is-checking");
  if (count === TOOL_NAMES.length) {
    els.webmcpBanner.textContent = `WebMCP ready. ${count} tools registered.`;
    els.webmcpBanner.classList.add("is-ready");
  } else if (state.webMcpUnavailable) {
    els.webmcpBanner.textContent =
      "WebMCP not detected. Enable chrome://flags/#enable-webmcp-testing or open this URL in ChatGPT’s in-app browser. Human UI still works.";
    els.webmcpBanner.classList.add("is-unavailable");
  } else {
    els.webmcpBanner.textContent = "Checking WebMCP...";
    els.webmcpBanner.classList.add("is-checking");
  }
}

function renderCaseList() {
  const filteredCases = getFilteredCases();
  els.caseCount.textContent = `${state.cases.length} seeded cases`;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });

  els.caseList.innerHTML = filteredCases
    .map((item) => {
      const selected = item.id === state.selectedCaseId ? " is-active" : "";
      const pending = state.pendingApprovals.some((approval) => approval.case_id === item.id);
      return `
        <button class="case-button${selected}" type="button" data-case-id="${escapeHtml(item.id)}">
          <span class="case-button-header">
            <span class="case-id">${escapeHtml(item.id)}</span>
            ${item.unread ? '<span class="unread-dot" aria-label="Unread"></span>' : ""}
          </span>
          <span class="case-title">${escapeHtml(item.title)}</span>
          <span class="case-customer">${escapeHtml(item.customer.name)} · ${escapeHtml(item.customer.company)}</span>
          <span class="case-meta">
            ${pill(item.severity, `severity-${item.severity.toLowerCase()}`, "severity-pill")}
            ${pill(formatStatus(item.status), `status-${item.status.replaceAll("_", "-")}`, "status-pill")}
            ${pending ? pill("approval", "status-refund-pending", "status-pill") : ""}
          </span>
        </button>
      `;
    })
    .join("");

  if (filteredCases.length === 0) {
    els.caseList.innerHTML = '<div class="empty-state">No cases match this filter.</div>';
  }
}

function renderCaseSummary() {
  const selectedCase = getSelectedCase();
  els.caseSummary.innerHTML = `
    <div class="summary-header">
      <div class="summary-toolbar">
        <div>
          <div class="summary-kicker">
            <span class="case-id">${escapeHtml(selectedCase.id)}</span>
            ${pill(selectedCase.severity, `severity-${selectedCase.severity.toLowerCase()}`, "severity-pill")}
            ${pill(formatStatus(selectedCase.status), `status-${selectedCase.status.replaceAll("_", "-")}`, "status-pill")}
          </div>
          <h2>${escapeHtml(selectedCase.title)}</h2>
        </div>
        <div class="summary-actions">
          <label for="statusSelect">Status</label>
          <select id="statusSelect">
            ${STATUS_OPTIONS.map(
              (status) =>
                `<option value="${status}" ${selectedCase.status === status ? "selected" : ""}>${formatStatus(status)}</option>`,
            ).join("")}
          </select>
        </div>
      </div>
      <p class="description">${escapeHtml(selectedCase.description)}</p>
    </div>
    <div class="info-grid">
      <div class="info-tile">
        <span class="info-label">Customer</span>
        <span class="info-value">${escapeHtml(selectedCase.customer.name)}</span>
        <span class="info-subvalue">${escapeHtml(selectedCase.customer.company)}</span>
      </div>
      <div class="info-tile">
        <span class="info-label">Plan</span>
        <span class="info-value">${escapeHtml(selectedCase.plan)}</span>
        <span class="info-subvalue">${escapeHtml(selectedCase.customer.email)}</span>
      </div>
      <div class="info-tile">
        <span class="info-label">Money at risk</span>
        <span class="info-value money">${formatMoney(selectedCase.moneyAtRisk)}</span>
        <span class="info-subvalue">Refund: ${formatRefund(selectedCase.refund.state)}</span>
      </div>
      <div class="info-tile">
        <span class="info-label">Current issue</span>
        <span class="info-value">${escapeHtml(selectedCase.issue)}</span>
      </div>
    </div>
    <div class="policy-strip">
      <div>
        <strong>Policy</strong>
        <span>${escapeHtml(selectedCase.policy)}</span>
      </div>
      <div>
        <strong>Suggested next</strong>
        <span>${escapeHtml(selectedCase.suggestedNext)}</span>
      </div>
    </div>
  `;
}

function renderApprovals() {
  const selectedCase = getSelectedCase();
  const approvals = state.pendingApprovals.filter((approval) => approval.case_id === selectedCase.id);

  if (approvals.length === 0) {
    els.pendingApprovals.innerHTML =
      '<div class="empty-state">No pending approval. Agent proposals will appear here before money, pages, replies, or resolution changes commit.</div>';
    return;
  }

  els.pendingApprovals.innerHTML = approvals
    .map(
      (approval) => `
      <article class="approval-card">
        <div class="approval-title-row">
          <strong>${escapeHtml(approvalTitle(approval))}</strong>
          <span class="approval-kind">${escapeHtml(approval.kind)}</span>
        </div>
        <p>${escapeHtml(approvalSummary(approval))}</p>
        <div class="approval-actions">
          <button class="primary-button" type="button" data-approval-action="approve" data-approval-id="${escapeHtml(approval.id)}">Approve</button>
          <button class="secondary-button danger" type="button" data-approval-action="reject" data-approval-id="${escapeHtml(approval.id)}">Reject</button>
        </div>
      </article>
    `,
    )
    .join("");
}

function renderDraft() {
  const selectedCase = getSelectedCase();
  if (document.activeElement !== els.draftReply) {
    els.draftReply.value = selectedCase.draftReply || "";
  }
  renderDraftMeta(selectedCase);
}

function renderDraftMeta(selectedCase) {
  const length = selectedCase.draftReply ? selectedCase.draftReply.length : 0;
  els.draftState.textContent = length > 0 ? "Draft ready for approval-gated send" : "No draft yet";
  els.draftChars.textContent = `${length} chars`;
}

function renderTimeline() {
  const selectedCase = getSelectedCase();
  const events = selectedCase.timeline.slice(-20).reverse();
  els.timeline.innerHTML = events
    .map((item) => {
      const identityClass = item.actor === "agent" ? "agent" : "human";
      const initial = item.actor === "agent" ? AGENT.initial : HUMAN.initial;
      return `
        <li class="timeline-event">
          <span class="avatar ${identityClass}">${initial}</span>
          <div class="event-card">
            <div class="timeline-meta">
              <strong>${escapeHtml(item.actorName)}</strong>
              <span>${escapeHtml(formatTimestamp(item.at))}</span>
            </div>
            <p>${escapeHtml(item.text)}</p>
            ${item.toolName ? `<span class="tool-name">tool: ${escapeHtml(item.toolName)}</span>` : ""}
            ${item.stateChange ? `<span class="state-change">${escapeHtml(item.stateChange)}</span>` : ""}
          </div>
        </li>
      `;
    })
    .join("");
}

function renderInspector() {
  const toolNames = state.registeredTools.length ? state.registeredTools : TOOL_NAMES;
  els.registeredTools.innerHTML = toolNames
    .map((name) => `<span class="tool-pill">${escapeHtml(name)}</span>`)
    .join("");

  const calls = state.toolCalls.slice(0, 10);
  if (calls.length === 0) {
    els.toolLog.innerHTML = '<div class="empty-state">No tool calls yet.</div>';
    return;
  }

  els.toolLog.innerHTML = calls
    .map(
      (call) => `
        <article class="tool-call">
          <div class="tool-call-head">
            <strong>${escapeHtml(call.name)}</strong>
            <span>${escapeHtml(formatTimestamp(call.at))}</span>
          </div>
          <pre>${escapeHtml(JSON.stringify(call.args, null, 2))}</pre>
          <pre>${escapeHtml(call.resultText)}</pre>
        </article>
      `,
    )
    .join("");
}

function getFilteredCases() {
  if (state.filter === "open") {
    return state.cases.filter((item) => item.status === "open" || item.status === "refund_pending");
  }
  if (state.filter === "p1") {
    return state.cases.filter((item) => item.severity === "P1");
  }
  if (state.filter === "approvals") {
    return state.cases.filter((item) =>
      state.pendingApprovals.some((approval) => approval.case_id === item.id),
    );
  }
  return state.cases;
}

function getSelectedCase() {
  return getCase(state.selectedCaseId) || state.cases[0];
}

function getCase(caseId) {
  return state.cases.find((item) => item.id === caseId);
}

function addTimeline(targetCase, { actor, text, stateChange = "", toolName = null }) {
  targetCase.timeline.push(
    event(actor, text, stateChange, new Date().toISOString(), toolName),
  );
}

async function registerWebMcpTools() {
  const modelContext = document.modelContext || navigator.modelContext;

  if (!modelContext || typeof modelContext.registerTool !== "function") {
    state.webMcpUnavailable = true;
    state.registeredTools = [];
    saveState();
    renderBanner();
    renderInspector();
    return;
  }

  state.webMcpUnavailable = false;
  state.registeredTools = [];
  saveState();
  renderBanner();

  const controller = new AbortController();
  for (const tool of webMcpTools()) {
    try {
      const registration = modelContext.registerTool(
        {
          ...tool,
          execute: async (input = {}, client = {}) => runTool(tool, input, client),
        },
        { signal: controller.signal },
      );
      if (registration && typeof registration.then === "function") {
        await registration;
      }
      state.registeredTools.push(tool.name);
      saveState();
      renderBanner();
      renderInspector();
    } catch (error) {
      recordToolCall(tool.name, {}, `Registration failed: ${error.message || String(error)}`);
    }
  }

  if (state.registeredTools.length !== TOOL_NAMES.length) {
    state.webMcpUnavailable = true;
    saveState();
    renderBanner();
  }
}

function webMcpTools() {
  return [
    {
      name: "get_workspace",
      description:
        "Use this read-only tool at the start of a HANDOFF session to inspect the live case queue, unread flags, severity, status, and refund state. Do not use it to change a case or infer full case details; call get_case for a specific case before acting.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true },
      execute: handleGetWorkspace,
    },
    {
      name: "get_case",
      description:
        "Use this read-only tool when you need the full details for one support case, including timeline context, pending approvals, and any draft reply. Do not use it to modify state; choose an update or proposal tool for changes.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
      }, ["case_id"]),
      annotations: { readOnlyHint: true },
      execute: handleGetCase,
    },
    {
      name: "update_case_status",
      description:
        "Use this tool to update a case workflow status after you have enough context and can explain why in a note. Do not use it for money movement, sending customer replies, on-call paging, or resolving a gated case; those have dedicated approval tools.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        status: {
          type: "string",
          enum: STATUS_OPTIONS,
          description: "New case status.",
        },
        note: {
          type: "string",
          description: "Short operational note explaining why the status changed.",
        },
      }, ["case_id", "status", "note"]),
      execute: handleUpdateCaseStatus,
    },
    {
      name: "add_comment",
      description:
        "Use this tool to add an agent-authored note to the current case timeline for human review. Public-to-customer visibility means the note is customer-visible context only; it never sends a customer message. Do not use this tool to send replies or change money state.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        body: { type: "string", description: "Comment body to add to the timeline." },
        visibility: {
          type: "string",
          enum: ["public_to_customer", "internal"],
          description: "Whether this is internal context or a customer-visible note. Neither option sends a reply.",
        },
      }, ["case_id", "body", "visibility"]),
      execute: handleAddComment,
    },
    {
      name: "draft_customer_reply",
      description:
        "Use this tool to create or replace a visible customer reply draft after reviewing the case. This is safe because it does not send anything. Do not use it when the current draft should be sent; call send_customer_reply after human approval is appropriate.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        goal: { type: "string", description: "Goal for the reply, such as apologize and explain the refund path." },
        tone: {
          type: "string",
          enum: ["calm", "apologetic", "firm"],
          description: "Reply tone.",
        },
      }, ["case_id", "goal", "tone"]),
      execute: handleDraftCustomerReply,
    },
    {
      name: "send_customer_reply",
      description:
        "Use this destructive tool only after a draft reply exists and the customer message is ready to send. It requests human approval and does not commit until Jordan approves. Do not use it to draft, edit, or add internal comments.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
      }, ["case_id"]),
      execute: handleSendCustomerReply,
    },
    {
      name: "propose_refund",
      description:
        "Use this tool to propose a refund amount and reason for human review. It creates a visible pending approval and does not move money by itself. Do not use it if there is no refund policy basis or if the amount is unknown.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        amount_usd: { type: "number", minimum: 0, description: "Refund amount in USD." },
        reason: { type: "string", description: "Operational reason for the proposed refund." },
      }, ["case_id", "amount_usd", "reason"]),
      execute: handleProposeRefund,
    },
    {
      name: "issue_refund",
      description:
        "Use this destructive tool only after propose_refund has established a prior refund proposal. It requests human approval before money state changes. Do not use it to create the first refund proposal or to send a customer message.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
      }, ["case_id"]),
      execute: handleIssueRefund,
    },
    {
      name: "page_oncall",
      description:
        "Use this destructive tool only when billing-primary or incident response needs to be interrupted for the case. It requests human approval and does not page until approved. Do not use it for routine notes, status changes, or customer replies.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        message: { type: "string", description: "Concise page message for billing-primary." },
      }, ["case_id", "message"]),
      execute: handlePageOncall,
    },
    {
      name: "list_pending_approvals",
      description:
        "Use this read-only tool to inspect all pending human approval gates across HANDOFF. Do not use it to approve, reject, or apply side effects; the human must approve in the UI.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true },
      execute: handleListPendingApprovals,
    },
    {
      name: "resolve_case",
      description:
        "Use this destructive tool only when the case is truly ready to close and you can provide a concise resolution summary. It requires human approval and refuses to resolve a P1 with an unissued requested refund pending. Do not use it while customer, refund, or on-call work remains unresolved.",
      inputSchema: schema({
        case_id: { type: "string", description: "Case identifier such as CASE-1042." },
        resolution_summary: { type: "string", description: "Short summary of the final resolution." },
      }, ["case_id", "resolution_summary"]),
      execute: handleResolveCase,
    },
  ];
}

function schema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

async function runTool(tool, input, client) {
  setAgentWorking(true);
  let response;
  try {
    response = await tool.execute(input, client);
    recordToolCall(tool.name, input, getResultText(response));
    return response;
  } catch (error) {
    response = textResult(`Error: ${error.message || String(error)}`);
    recordToolCall(tool.name, input, getResultText(response));
    return response;
  } finally {
    saveState();
    render();
    setAgentWorking(false);
  }
}

function setAgentWorking(isWorking) {
  els.agentPulse.hidden = !isWorking;
}

function recordToolCall(name, args, resultText) {
  state.toolCalls.unshift({
    id: crypto.randomUUID(),
    name,
    args,
    resultText,
    at: new Date().toISOString(),
  });
  state.toolCalls = state.toolCalls.slice(0, 10);
  saveState();
  renderInspector();
}

function handleGetWorkspace() {
  return textResult(
    JSON.stringify(
      state.cases.map((item) => ({
        id: item.id,
        title: item.title,
        severity: item.severity,
        status: item.status,
        refund_state: item.refund.state,
        unread: item.unread,
        pending_approval_count: state.pendingApprovals.filter(
          (approval) => approval.case_id === item.id,
        ).length,
      })),
      null,
      2,
    ),
  );
}

function handleGetCase({ case_id }) {
  const targetCase = requireCase(case_id);
  state.selectedCaseId = targetCase.id;
  targetCase.unread = false;
  const pendingApprovals = state.pendingApprovals.filter(
    (approval) => approval.case_id === targetCase.id,
  );
  return textResult(
    JSON.stringify(
      {
        ...targetCase,
        timeline: targetCase.timeline.slice(-20),
        pending_approvals: pendingApprovals,
        current_draft_reply: targetCase.draftReply || "",
      },
      null,
      2,
    ),
  );
}

function handleUpdateCaseStatus({ case_id, status, note }) {
  const targetCase = requireCase(case_id);
  if (!STATUS_OPTIONS.includes(status)) {
    return textResult(`Error: status must be one of ${STATUS_OPTIONS.join(", ")}.`);
  }
  targetCase.status = status;
  addTimeline(targetCase, {
    actor: "agent",
    text: `Updated status to ${formatStatus(status)}. ${note}`,
    stateChange: `Status: ${formatStatus(status)}`,
    toolName: "update_case_status",
  });
  return textResult(`${case_id} status updated to ${status}.`);
}

function handleAddComment({ case_id, body, visibility }) {
  const targetCase = requireCase(case_id);
  if (!["public_to_customer", "internal"].includes(visibility)) {
    return textResult("Error: visibility must be public_to_customer or internal.");
  }
  const prefix = visibility === "internal" ? "Internal note" : "Customer-visible note";
  addTimeline(targetCase, {
    actor: "agent",
    text: `${prefix}: ${body}`,
    stateChange: "Agent comment added",
    toolName: "add_comment",
  });
  return textResult(`${prefix} added to ${case_id}. No customer reply was sent.`);
}

function handleDraftCustomerReply({ case_id, goal, tone }) {
  const targetCase = requireCase(case_id);
  if (!["calm", "apologetic", "firm"].includes(tone)) {
    return textResult("Error: tone must be calm, apologetic, or firm.");
  }
  targetCase.draftReply = buildDraftReply(targetCase, goal, tone);
  if (targetCase.status === "open") {
    targetCase.status = "in_progress";
  }
  const article = tone === "apologetic" ? "an" : "a";
  addTimeline(targetCase, {
    actor: "agent",
    text: `Drafted ${article} ${tone} customer reply for Jordan to review.`,
    stateChange: "Draft reply ready",
    toolName: "draft_customer_reply",
  });
  return textResult(`Draft reply created for ${case_id}. It has not been sent.`);
}

async function handleSendCustomerReply({ case_id }, client) {
  const targetCase = requireCase(case_id);
  if (!targetCase.draftReply || !targetCase.draftReply.trim()) {
    return textResult("Error: no draft exists. Call draft_customer_reply before send_customer_reply.");
  }
  const approval = createOrReuseApproval({
    case_id,
    kind: "send_reply",
    payload: {
      draft: targetCase.draftReply,
      customer_name: targetCase.customer.name,
    },
  });
  await requestBrowserInteraction(
    client,
    `Send reply to ${targetCase.customer.name}?`,
    approval.id,
  );
  return textResult(`Human approval requested to send the current draft for ${case_id}.`);
}

function handleProposeRefund({ case_id, amount_usd, reason }) {
  const targetCase = requireCase(case_id);
  if (!Number.isFinite(amount_usd) || amount_usd <= 0) {
    return textResult("Error: amount_usd must be a positive number.");
  }
  targetCase.refund.state = "requested";
  targetCase.refund.requestedAmount = amount_usd;
  targetCase.refund.reason = reason;
  targetCase.status = "refund_pending";
  const approval = createOrReuseApproval({
    case_id,
    kind: "issue_refund",
    payload: {
      amount_usd,
      reason,
      customer_name: targetCase.customer.name,
    },
  });
  addTimeline(targetCase, {
    actor: "agent",
    text: `Proposed ${formatMoney(amount_usd)} refund for human approval. Reason: ${reason}`,
    stateChange: "Refund approval pending",
    toolName: "propose_refund",
  });
  return textResult(`Refund proposal ${approval.id} created for ${formatMoney(amount_usd)}. No money moved.`);
}

async function handleIssueRefund({ case_id }, client) {
  const targetCase = requireCase(case_id);
  if (targetCase.refund.state === "issued") {
    return textResult(`${case_id} refund is already issued.`);
  }
  if (!targetCase.refund.requestedAmount || targetCase.refund.state === "none") {
    return textResult("Error: propose_refund must be called before issue_refund.");
  }
  const approval = createOrReuseApproval({
    case_id,
    kind: "issue_refund",
    payload: {
      amount_usd: targetCase.refund.requestedAmount,
      reason: targetCase.refund.reason || "Previously proposed refund.",
      customer_name: targetCase.customer.name,
    },
  });
  await requestBrowserInteraction(
    client,
    `Refund ${formatMoney(approval.payload.amount_usd)} to ${targetCase.customer.name}?`,
    approval.id,
  );
  return textResult(`Human approval requested to issue ${formatMoney(approval.payload.amount_usd)} for ${case_id}.`);
}

async function handlePageOncall({ case_id, message }, client) {
  const targetCase = requireCase(case_id);
  const approval = createOrReuseApproval({
    case_id,
    kind: "page_oncall",
    payload: {
      message,
      rotation: "billing-primary",
    },
  });
  await requestBrowserInteraction(client, "Page billing-primary?", approval.id);
  return textResult(`Human approval requested to page billing-primary for ${targetCase.id}.`);
}

function handleListPendingApprovals() {
  return textResult(JSON.stringify(state.pendingApprovals, null, 2));
}

async function handleResolveCase({ case_id, resolution_summary }, client) {
  const targetCase = requireCase(case_id);
  const unresolvedRefund =
    targetCase.severity === "P1" &&
    ["requested", "approved"].includes(targetCase.refund.state) &&
    targetCase.refund.state !== "issued";
  if (unresolvedRefund) {
    return textResult(
      "Error: cannot resolve a P1 with an unissued requested refund still pending.",
    );
  }
  const approval = createOrReuseApproval({
    case_id,
    kind: "resolve_case",
    payload: {
      resolution_summary,
    },
  });
  await requestBrowserInteraction(client, `Resolve ${case_id}?`, approval.id);
  return textResult(`Human approval requested to resolve ${case_id}.`);
}

function requireCase(caseId) {
  const targetCase = getCase(caseId);
  if (!targetCase) {
    throw new Error(`Unknown case_id ${caseId}. Call get_workspace to see valid cases.`);
  }
  return targetCase;
}

function createOrReuseApproval({ case_id, kind, payload }) {
  const existing = state.pendingApprovals.find(
    (approval) => approval.case_id === case_id && approval.kind === kind,
  );
  if (existing) {
    existing.payload = payload;
    existing.created_at = new Date().toISOString();
    return existing;
  }
  const approval = {
    id: `APR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    case_id,
    kind,
    payload,
    requested_by: "agent",
    created_at: new Date().toISOString(),
  };
  state.pendingApprovals.push(approval);
  return approval;
}

async function requestBrowserInteraction(client, message, approvalId) {
  openApprovalModal(approvalId);
  if (!client || typeof client.requestUserInteraction !== "function") return;
  try {
    await client.requestUserInteraction(async () => {
      openApprovalModal(approvalId);
      return { message, approval_id: approvalId };
    });
  } catch {
    return;
  }
}

function openApprovalModal(approvalId) {
  const approval = state.pendingApprovals.find((item) => item.id === approvalId);
  if (!approval) return;
  activeApprovalId = approvalId;
  const targetCase = getCase(approval.case_id);
  els.modalTitle.textContent =
    approval.kind === "issue_refund"
      ? `Refund ${formatMoney(approval.payload.amount_usd)} to ${targetCase.customer.name}?`
      : approvalTitle(approval);
  els.modalBody.textContent = approvalSummary(approval);
  els.modalDetails.innerHTML = Object.entries({
    Case: approval.case_id,
    Customer: targetCase.customer.name,
    Requested: formatTimestamp(approval.created_at),
    Action: approval.kind,
  })
    .map(([term, detail]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd>`)
    .join("");
  els.approvalModal.hidden = false;
}

function closeApprovalModal() {
  activeApprovalId = null;
  els.approvalModal.hidden = true;
}

function approveApproval(approvalId) {
  const approval = state.pendingApprovals.find((item) => item.id === approvalId);
  if (!approval) return;
  const targetCase = getCase(approval.case_id);

  if (approval.kind === "send_reply") {
    addTimeline(targetCase, {
      actor: "agent",
      text: `Reply sent to ${targetCase.customer.name}.`,
      stateChange: "Customer reply sent",
      toolName: "send_customer_reply",
    });
    targetCase.replySentAt = new Date().toISOString();
    targetCase.status = targetCase.refund.state === "issued" ? "refunded" : "waiting_on_customer";
  }

  if (approval.kind === "issue_refund") {
    targetCase.refund.state = "issued";
    targetCase.refund.issuedAt = new Date().toISOString();
    targetCase.refund.requestedAmount = approval.payload.amount_usd;
    targetCase.status = "refunded";
    addTimeline(targetCase, {
      actor: "agent",
      text: `Ledger event: issued ${formatMoney(approval.payload.amount_usd)} refund to ${targetCase.customer.name}.`,
      stateChange: "Refund issued",
      toolName: "issue_refund",
    });
  }

  if (approval.kind === "page_oncall") {
    addTimeline(targetCase, {
      actor: "agent",
      text: `Paged on-call: billing-primary. ${approval.payload.message}`,
      stateChange: "On-call paged",
      toolName: "page_oncall",
    });
  }

  if (approval.kind === "resolve_case") {
    targetCase.status = "resolved";
    addTimeline(targetCase, {
      actor: "agent",
      text: `Resolved case. ${approval.payload.resolution_summary}`,
      stateChange: "Case resolved",
      toolName: "resolve_case",
    });
  }

  state.pendingApprovals = state.pendingApprovals.filter((item) => item.id !== approvalId);
  closeApprovalModal();
  saveState();
  render();
}

function rejectApproval(approvalId) {
  const approval = state.pendingApprovals.find((item) => item.id === approvalId);
  if (!approval) return;
  const targetCase = getCase(approval.case_id);
  if (approval.kind === "issue_refund") {
    targetCase.refund.state = "rejected";
    targetCase.status = "open";
  }
  addTimeline(targetCase, {
    actor: "human",
    text: `Rejected agent request: ${approvalSummary(approval)}`,
    stateChange: "Approval rejected",
  });
  state.pendingApprovals = state.pendingApprovals.filter((item) => item.id !== approvalId);
  closeApprovalModal();
  saveState();
  render();
}

function approvalTitle(approval) {
  if (approval.kind === "send_reply") return "Send customer reply";
  if (approval.kind === "issue_refund") return "Issue refund";
  if (approval.kind === "page_oncall") return "Page billing-primary";
  if (approval.kind === "resolve_case") return "Resolve case";
  return "Approval required";
}

function approvalSummary(approval) {
  if (approval.kind === "send_reply") {
    return `Send the current draft reply to ${approval.payload.customer_name}.`;
  }
  if (approval.kind === "issue_refund") {
    return `Refund ${formatMoney(approval.payload.amount_usd)} to ${approval.payload.customer_name}. Reason: ${approval.payload.reason}`;
  }
  if (approval.kind === "page_oncall") {
    return `Page ${approval.payload.rotation}: ${approval.payload.message}`;
  }
  if (approval.kind === "resolve_case") {
    return `Close the case with summary: ${approval.payload.resolution_summary}`;
  }
  return "Agent requested approval.";
}

function buildDraftReply(targetCase, goal, tone) {
  const opener =
    tone === "apologetic"
      ? "I am sorry for the duplicate charge and the time this has taken today."
      : tone === "firm"
        ? "I reviewed the billing record and have a clear path to resolve this."
        : "Thanks for flagging this. I reviewed the account and the billing record.";
  const refundLine =
    targetCase.refund.requestedAmount > 0
      ? `I am preparing a ${formatMoney(targetCase.refund.requestedAmount)} refund for the duplicate annual charge, pending Jordan's approval.`
      : "I am checking the next action with Jordan before making any account changes.";
  return `Hi ${targetCase.customer.name},\n\n${opener} ${refundLine}\n\nGoal: ${goal}\n\nWe will keep the Slack thread updated and make sure you have a clear confirmation before this is closed.\n\nJordan`;
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function getResultText(response) {
  if (!response || !Array.isArray(response.content)) return "";
  return response.content
    .filter((item) => item && item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function formatStatus(status) {
  return status.replaceAll("_", " ");
}

function formatRefund(refundState) {
  return refundState.replaceAll("_", " ");
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function pill(text, modifier, baseClass) {
  return `<span class="${baseClass} ${modifier}">${escapeHtml(text)}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
