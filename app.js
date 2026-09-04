const STORAGE_KEY = "handoff.v1";
const HUMAN = { id: "human", name: "Jordan Hale", role: "Support Lead", initial: "J" };
const AGENT = { id: "agent", name: "Handoff", role: "Ops agent", initial: "H" };
const PARTICIPANTS = {
  jordan: { id: "jordan", name: "Jordan Hale", role: "Support Lead", initial: "J" },
  sam: { id: "sam", name: "Sam Chen", role: "Support", initial: "S" },
};

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
  "get_session",
  "list_watchers",
  "redirect_agent",
  "handoff_session",
];

let state = loadState();
let activeApprovalId = null;
const approvalWaiters = new Map();

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  exposeJudgeApi();
  bindUi();
  render();
  void registerWebMcpTools();
});

function cacheElements() {
  els.caseCount = document.querySelector("#caseCount");
  els.presenceRail = document.querySelector("#presenceRail");
  els.liveSession = document.querySelector("#liveSession");
  els.caseList = document.querySelector("#caseList");
  els.caseSummary = document.querySelector("#caseSummary");
  els.pendingApprovals = document.querySelector("#pendingApprovals");
  els.draftReply = document.querySelector("#draftReply");
  els.draftState = document.querySelector("#draftState");
  els.draftChars = document.querySelector("#draftChars");
  els.timeline = document.querySelector("#timeline");
  els.registeredTools = document.querySelector("#registeredTools");
  els.toolLog = document.querySelector("#toolLog");
  els.judgeModelContext = document.querySelector("#judgeModelContext");
  els.judgeRegisteredTools = document.querySelector("#judgeRegisteredTools");
  els.judgeLastToolCall = document.querySelector("#judgeLastToolCall");
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
    if (!body) {
      els.humanComment.placeholder = "Add a note before posting...";
      els.humanComment.focus();
      return;
    }
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
      const selectedCase = getSelectedCase();
      const action = button.dataset.agentTool || button.dataset.agentAsk;
      const toolCall = agentAskToToolCall(action, selectedCase);
      if (!toolCall) {
        els.askStatus.textContent = "Unavailable";
        return;
      }
      els.askStatus.textContent = `Running ${toolCall.name}`;
      try {
        const result = await callLocalTool(toolCall.name, toolCall.input);
        els.askStatus.textContent = getResultText(result).replace(/^Error:\s*/, "") || "Done";
      } catch (error) {
        els.askStatus.textContent = error.message || "Tool failed";
      }
      window.setTimeout(() => {
        els.askStatus.textContent = "";
      }, 2800);
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

  [els.presenceRail, els.liveSession].forEach((container) => {
    container.addEventListener("click", handleSessionActionClick);
  });
}

function handleSessionActionClick(event) {
  const action = event.target.closest("[data-session-action]");
  if (!action) return;
  if (action.dataset.sessionAction === "join-sam") {
    joinSessionAsSam();
  }
  if (action.dataset.sessionAction === "redirect") {
    redirectAgentFromPrompt();
  }
  if (action.dataset.sessionAction === "handoff-sam") {
    handoffSessionTo("sam");
  }
}

function createSeedState() {
  return {
    selectedCaseId: "CASE-1042",
    filter: "all",
    registeredTools: [],
    toolCalls: [],
    pendingApprovals: [],
    session: createSeedSession(),
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

function createSeedSession() {
  return {
    id: "SES-1042",
    case_id: "CASE-1042",
    status: "running",
    owner: "jordan",
    watchers: [],
    agentState: "working",
    elapsedLabel: "running 14m",
    currentStepId: "propose_refund",
    lastRedirectInstruction: "",
  };
}

function normalizeSession(session) {
  const seed = createSeedSession();
  if (!session || typeof session !== "object") return seed;
  const owner = PARTICIPANTS[session.owner] ? session.owner : seed.owner;
  const status = ["running", "redirected", "handed_off", "waiting_on_human"].includes(session.status)
    ? session.status
    : seed.status;
  const currentStepId = ["inspect", "draft_apology", "propose_refund", "wait_human"].includes(session.currentStepId)
    ? session.currentStepId
    : seed.currentStepId;
  const watchers = Array.isArray(session.watchers)
    ? [...new Set(session.watchers.filter((id) => PARTICIPANTS[id] && id !== owner))]
    : seed.watchers;
  return {
    ...seed,
    ...session,
    case_id: "CASE-1042",
    status,
    owner,
    watchers,
    agentState: session.agentState === "idle" ? "idle" : "working",
    currentStepId,
    lastRedirectInstruction:
      typeof session.lastRedirectInstruction === "string" ? session.lastRedirectInstruction : "",
  };
}

function event(actor, text, stateChange, at, toolName = null, id = null, identity = null) {
  const actorProfile =
    actor === "agent"
      ? AGENT
      : identity || HUMAN;
  return {
    id: id || crypto.randomUUID(),
    actor,
    actorName: actorProfile.name,
    role: actorProfile.role,
    actorInitial: actorProfile.initial,
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
    const seed = createSeedState();
    const registeredTools =
      Array.isArray(parsed.registeredTools) && parsed.registeredTools.length === TOOL_NAMES.length
        ? parsed.registeredTools
        : [];
    return {
      ...seed,
      ...parsed,
      session: normalizeSession(parsed.session),
      registeredTools,
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
  renderPresenceRail();
  renderCaseList();
  renderLiveSession();
  renderCaseSummary();
  renderApprovals();
  renderDraft();
  renderTimeline();
  renderInspector();
  renderJudgeConsole();
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

function renderPresenceRail() {
  const session = getSession();
  const rows = [
    presenceRow(PARTICIPANTS.jordan),
    presenceRow(PARTICIPANTS.sam),
    {
      name: AGENT.name,
      role: "agent",
      badges: [session.agentState === "working" ? "working" : "idle"],
      initial: AGENT.initial,
      className: "agent",
      action: "",
    },
  ];
  els.presenceRail.innerHTML = rows
    .map(
      (row) => `
        <div class="presence-person">
          <span class="avatar ${row.className}">${escapeHtml(row.initial)}</span>
          <span class="presence-copy">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.role)}</span>
          </span>
          <span class="presence-badges">
            ${row.badges.map((badge) => `<span class="session-badge">${escapeHtml(badge)}</span>`).join("")}
          </span>
          ${row.action}
        </div>
      `,
    )
    .join("");
}

function presenceRow(participant) {
  const session = getSession();
  const isOwner = session.owner === participant.id;
  const isWatcher = session.watchers.includes(participant.id);
  const badges = [];
  if (isOwner) badges.push("owner", "steering");
  if (isWatcher) badges.push("watching");
  const action =
    participant.id === "sam" && !isOwner && !isWatcher
      ? '<button type="button" data-session-action="join-sam">Join as Sam</button>'
      : "";
  return {
    name: participant.name,
    role: isOwner ? `${participant.role} - session owner` : participant.role,
    badges,
    initial: participant.initial,
    className: "human",
    action,
  };
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

function renderLiveSession() {
  const session = getSession();
  const owner = getParticipant(session.owner);
  const watchers = getWatcherNames();
  const steps = getSessionPlanSteps();
  const canJoinSam = session.owner !== "sam" && !session.watchers.includes("sam");
  els.liveSession.innerHTML = `
    <div class="panel-heading compact">
      <div>
        <h2>Live agent session</h2>
        <p>Teammates can watch, redirect, and hand off the same agent run.</p>
      </div>
      <span class="session-id">${escapeHtml(session.id)}</span>
    </div>
    <div class="session-body">
      <div class="session-facts">
        <span><strong>Status</strong>${escapeHtml(formatSessionStatus(session.status))}</span>
        <span><strong>Owner</strong>${escapeHtml(owner.name)}</span>
        <span><strong>Elapsed</strong>${escapeHtml(session.elapsedLabel)}</span>
      </div>
      <ol class="session-plan" aria-label="Current plan steps">
        ${steps
          .map(
            (step) => `
              <li class="${step.id === session.currentStepId ? "is-current" : ""} ${step.state}">
                <span>${escapeHtml(step.label)}</span>
                <small>${escapeHtml(step.state)}</small>
              </li>
            `,
          )
          .join("")}
      </ol>
      <div class="session-watchers">
        <strong>Watchers</strong>
        <span>${escapeHtml(watchers.length ? watchers.join(", ") : "none yet")}</span>
      </div>
      ${session.lastRedirectInstruction ? `<p class="session-redirect">Redirect: ${escapeHtml(session.lastRedirectInstruction)}</p>` : ""}
      <div class="session-actions">
        <button class="secondary-button" type="button" data-session-action="join-sam" ${canJoinSam ? "" : "disabled"}>Join as Sam</button>
        <button class="secondary-button" type="button" data-session-action="redirect">Redirect...</button>
        <button class="primary-button" type="button" data-session-action="handoff-sam" ${session.owner === "sam" ? "disabled" : ""}>Hand off to Sam</button>
      </div>
    </div>
  `;
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
      const initial = item.actorInitial || (item.actor === "agent" ? AGENT.initial : HUMAN.initial);
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

function renderJudgeConsole() {
  if (!els.judgeModelContext) return;
  const modelContext = getModelContext();
  const lastCall = state.toolCalls[0];
  const toolNames = state.registeredTools.length ? state.registeredTools : TOOL_NAMES;
  els.judgeModelContext.textContent = modelContext ? "yes" : "no";
  els.judgeRegisteredTools.textContent = toolNames.join(", ");
  els.judgeLastToolCall.textContent = lastCall
    ? `${lastCall.name} ${JSON.stringify(lastCall.args)} -> ${lastCall.resultText}`
    : "none";
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

function getSessionPlanSteps() {
  const session = getSession();
  const selectedCase = getCase(session.case_id) || getSelectedCase();
  const hasDraft = Boolean(selectedCase.draftReply && selectedCase.draftReply.trim());
  const hasPendingRefund = state.pendingApprovals.some(
    (approval) => approval.case_id === selectedCase.id && approval.kind === "issue_refund",
  );
  const currentId = hasPendingRefund || session.status === "waiting_on_human"
    ? "wait_human"
    : session.currentStepId;
  return [
    { id: "inspect", label: "Inspect", state: currentId === "inspect" ? "current" : "done" },
    {
      id: "draft_apology",
      label: "Draft apology",
      state: currentId === "draft_apology" ? "current" : hasDraft ? "done" : "queued",
    },
    {
      id: "propose_refund",
      label: "Propose refund",
      state: currentId === "propose_refund" ? "current" : hasPendingRefund ? "done" : "queued",
    },
    {
      id: "wait_human",
      label: "Wait for human",
      state: currentId === "wait_human" ? "current" : "queued",
    },
  ];
}

function agentAskToToolCall(action, selectedCase) {
  if (action === "inspect_case" || action.includes("Inspect")) {
    return {
      name: "get_case",
      input: { case_id: selectedCase.id },
    };
  }
  if (action === "draft_apology" || action.includes("Draft")) {
    return {
      name: "draft_customer_reply",
      input: {
        case_id: selectedCase.id,
        goal: "Apologize for the duplicate charge and explain the refund approval path.",
        tone: "apologetic",
      },
    };
  }
  if (action === "propose_refund" || action.includes("Propose")) {
    return {
      name: "propose_refund",
      input: {
        case_id: selectedCase.id,
        amount_usd: 2388,
        reason: "Duplicate Pro Annual charge after failed webhook retry.",
      },
    };
  }
  if (action === "send_reply" || action.includes("Send")) {
    return {
      name: "send_customer_reply",
      input: { case_id: selectedCase.id },
    };
  }
  return null;
}

function callLocalTool(name, input = {}, client = {}) {
  const tool = webMcpTools().find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Unknown HANDOFF tool: ${name}`);
  }
  return runTool(tool, input, client);
}

function getSelectedCase() {
  return getCase(state.selectedCaseId) || state.cases[0];
}

function getCase(caseId) {
  return state.cases.find((item) => item.id === caseId);
}

function getSession() {
  state.session = normalizeSession(state.session);
  return state.session;
}

function getParticipant(participantId) {
  return PARTICIPANTS[participantId] || PARTICIPANTS.jordan;
}

function getWatcherNames() {
  return getSession().watchers.map((id) => getParticipant(id).name);
}

function getActiveParticipant() {
  return getParticipant(getSession().owner);
}

function sessionSnapshot() {
  const session = getSession();
  const owner = getParticipant(session.owner);
  return {
    id: session.id,
    case_id: session.case_id,
    status: session.status,
    owner,
    agent: {
      name: AGENT.name,
      role: "agent",
      state: session.agentState,
    },
    watchers: session.watchers.map((id) => getParticipant(id)),
    elapsed: session.elapsedLabel,
    current_step: session.currentStepId,
    plan: getSessionPlanSteps(),
    last_redirect_instruction: session.lastRedirectInstruction,
  };
}

function addTimeline(targetCase, { actor, text, stateChange = "", toolName = null, identity = null }) {
  targetCase.timeline.push(
    event(actor, text, stateChange, new Date().toISOString(), toolName, null, identity),
  );
}

function addSessionTimeline({ participantId, text, stateChange, toolName = null }) {
  addTimeline(getCase(getSession().case_id) || getSelectedCase(), {
    actor: "human",
    identity: getParticipant(participantId),
    text,
    stateChange,
    toolName,
  });
}

function joinSessionAsSam() {
  const result = joinSessionWatcher("sam", "sam");
  els.askStatus.textContent = result;
  window.setTimeout(() => {
    els.askStatus.textContent = "";
  }, 2400);
  saveState();
  render();
}

function joinSessionWatcher(participantId, actorId) {
  const session = getSession();
  const participant = getParticipant(participantId);
  if (session.owner === participantId) {
    return `${participant.name} already owns ${session.id}.`;
  }
  if (!session.watchers.includes(participantId)) {
    session.watchers.push(participantId);
    addSessionTimeline({
      participantId: actorId,
      text: `${participant.name} joined ${session.id} as a watcher.`,
      stateChange: "Session watcher joined",
    });
    return `${participant.name} is now watching ${session.id}.`;
  }
  return `${participant.name} is already watching ${session.id}.`;
}

function redirectAgentFromPrompt() {
  const instruction = window.prompt("Redirect Handoff with a short instruction:");
  if (!instruction || !instruction.trim()) return;
  const result = redirectAgentSession(instruction, getSession().owner, null);
  els.askStatus.textContent = result;
  window.setTimeout(() => {
    els.askStatus.textContent = "";
  }, 2400);
  saveState();
  render();
}

function redirectAgentSession(instruction, participantId, toolName) {
  const session = getSession();
  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    return "Error: instruction is required.";
  }
  const actor = getParticipant(participantId);
  session.status = "redirected";
  session.agentState = "working";
  session.lastRedirectInstruction = trimmedInstruction;
  addSessionTimeline({
    participantId: actor.id,
    text: `${actor.name} redirected Handoff: ${trimmedInstruction}`,
    stateChange: "Session redirected",
    toolName,
  });
  return `${session.id} redirected: ${trimmedInstruction}`;
}

function handoffSessionTo(participantId, toolName = null) {
  const session = getSession();
  const nextOwner = getParticipant(participantId);
  const previousOwnerId = session.owner;
  const previousOwner = getParticipant(previousOwnerId);
  if (previousOwnerId === participantId) {
    return `${nextOwner.name} already owns ${session.id}.`;
  }
  session.owner = participantId;
  session.status = "handed_off";
  session.agentState = "working";
  session.watchers = session.watchers
    .filter((id) => id !== participantId && id !== previousOwnerId);
  session.watchers.push(previousOwnerId);
  addSessionTimeline({
    participantId: previousOwnerId,
    text: `${previousOwner.name} handed ${session.id} to ${nextOwner.name}. ${previousOwner.name} is now watching.`,
    stateChange: "Session handed off",
    toolName,
  });
  saveState();
  render();
  return `${session.id} owner is now ${nextOwner.name}.`;
}

async function registerWebMcpTools() {
  const modelContext = getModelContext();

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
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: handleGetWorkspace,
    },
    {
      name: "get_case",
      description:
        "Use this read-only tool first for the judge demo case: call get_case with case_id CASE-1042, then draft_customer_reply with tone apologetic, then propose_refund with amount_usd 2388, then issue_refund, then send_customer_reply. Do not use it to modify state; choose an update or proposal tool for changes.",
      inputSchema: schema({
        case_id: caseIdParam(),
      }, ["case_id"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: handleGetCase,
    },
    {
      name: "update_case_status",
      description:
        "Use this tool to update a case workflow status after you have enough context and can explain why in a note. Do not use it for money movement, sending customer replies, on-call paging, or resolving a gated case; those have dedicated approval tools.",
      inputSchema: schema({
        case_id: caseIdParam(),
        status: {
          type: "string",
          enum: STATUS_OPTIONS,
          description: "New case status.",
        },
        note: {
          type: "string",
          maxLength: 240,
          description: "Short operational note explaining why the status changed.",
        },
      }, ["case_id", "status", "note"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleUpdateCaseStatus,
    },
    {
      name: "add_comment",
      description:
        "Use this tool to add an agent-authored note to the current case timeline for human review. Public-to-customer visibility means the note is customer-visible context only; it never sends a customer message. Do not use this tool to send replies or change money state.",
      inputSchema: schema({
        case_id: caseIdParam(),
        body: { type: "string", maxLength: 800, description: "Comment body to add to the timeline." },
        visibility: {
          type: "string",
          enum: ["public_to_customer", "internal"],
          description: "Whether this is internal context or a customer-visible note. Neither option sends a reply.",
        },
      }, ["case_id", "body", "visibility"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleAddComment,
    },
    {
      name: "draft_customer_reply",
      description:
        "Use this tool after get_case for CASE-1042 to create or replace a visible customer reply draft. For the judge demo, pass tone apologetic and a goal that apologizes for the duplicate charge and explains the refund path; then call propose_refund with amount_usd 2388. This tool does not send anything.",
      inputSchema: schema({
        case_id: caseIdParam(),
        goal: { type: "string", maxLength: 240, description: "Goal for the reply, such as apologize and explain the refund path." },
        tone: {
          type: "string",
          enum: ["calm", "apologetic", "firm"],
          description: "Reply tone.",
        },
      }, ["case_id", "goal", "tone"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleDraftCustomerReply,
    },
    {
      name: "send_customer_reply",
      description:
        "Use this destructive tool at the end of the judge sequence after get_case, draft_customer_reply, propose_refund, and issue_refund have completed. Do not call it before a draft exists or before refund approval is complete. It opens a visible human approval gate and waits for Jordan; no customer reply is sent unless Jordan approves.",
      inputSchema: schema({
        case_id: caseIdParam(),
      }, ["case_id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleSendCustomerReply,
    },
    {
      name: "propose_refund",
      description:
        "Use this tool after drafting the CASE-1042 customer reply to propose amount_usd 2388 for the duplicate Pro Annual charge. It creates a visible pending approval and does not move money by itself; then call issue_refund to open the human approval gate.",
      inputSchema: schema({
        case_id: caseIdParam(),
        amount_usd: { type: "number", minimum: 0, maximum: 10000, description: "Refund amount in USD. For CASE-1042 use 2388." },
        reason: { type: "string", maxLength: 240, description: "Operational reason for the proposed refund." },
      }, ["case_id", "amount_usd", "reason"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleProposeRefund,
    },
    {
      name: "issue_refund",
      description:
        "Use this destructive tool after propose_refund in the judge sequence for CASE-1042. Do not call it before a refund has been proposed. It opens a visible 'Refund $2,388 to Maya Chen?' approval gate and waits for Jordan; the refund state does not change to issued unless Jordan approves. After approval, call send_customer_reply.",
      inputSchema: schema({
        case_id: caseIdParam(),
      }, ["case_id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleIssueRefund,
    },
    {
      name: "page_oncall",
      description:
        "Use this destructive tool only when billing-primary or incident response needs to be interrupted for the case. It requests human approval and does not page until approved. Do not use it for routine notes, status changes, or customer replies.",
      inputSchema: schema({
        case_id: caseIdParam(),
        message: { type: "string", maxLength: 160, description: "Concise page message for billing-primary." },
      }, ["case_id", "message"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handlePageOncall,
    },
    {
      name: "list_pending_approvals",
      description:
        "Use this read-only tool to inspect all pending human approval gates across HANDOFF. Do not use it to approve, reject, or apply side effects; the human must approve in the UI.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: handleListPendingApprovals,
    },
    {
      name: "resolve_case",
      description:
        "Use this destructive tool only when the case is truly ready to close and you can provide a concise resolution summary. It requires human approval and refuses to resolve a P1 with an unissued requested refund pending. Do not use it while customer, refund, or on-call work remains unresolved.",
      inputSchema: schema({
        case_id: caseIdParam(),
        resolution_summary: { type: "string", maxLength: 240, description: "Short summary of the final resolution." },
      }, ["case_id", "resolution_summary"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleResolveCase,
    },
    {
      name: "get_session",
      description:
        "Use this read-only tool to inspect the live agent session for CASE-1042: session id, owner, watchers, status, elapsed time, agent state, and current plan step. Use it before redirect_agent or handoff_session so you know who is steering.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: handleGetSession,
    },
    {
      name: "list_watchers",
      description:
        "Use this read-only tool to list teammates watching SES-1042 without changing ownership. If Sam is absent, the human can click Join as Sam or the session can later be handed off to Sam.",
      inputSchema: schema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: handleListWatchers,
    },
    {
      name: "redirect_agent",
      description:
        "Use this session-control tool when the active human wants to steer Handoff with a short instruction. It updates SES-1042 to redirected and writes a timeline event, but it does not approve refunds, send replies, or page anyone.",
      inputSchema: schema({
        instruction: {
          type: "string",
          maxLength: 180,
          description: "Short steering instruction for the live agent session.",
        },
      }, ["instruction"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleRedirectAgent,
    },
    {
      name: "handoff_session",
      description:
        "Use this session-control tool to transfer ownership of SES-1042 between Jordan and Sam. It changes the live session owner and writes a timeline event; it does not approve money movement or send customer replies.",
      inputSchema: schema({
        to_participant: {
          type: "string",
          enum: ["sam", "jordan"],
          description: "Participant who should become the live session owner.",
        },
      }, ["to_participant"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: handleHandoffSession,
    },
  ];
}

function caseIdParam() {
  return {
    type: "string",
    pattern: "^CASE-[0-9]{4}$",
    description: "Case identifier such as CASE-1042.",
  };
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
  if (state.session) {
    state.session.agentState = isWorking ? "working" : "idle";
    renderPresenceRail();
  }
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
  renderJudgeConsole();
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
  getSession().currentStepId = "propose_refund";
  getSession().status = "running";
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
  const outcome = await waitForVisibleHumanApproval(
    client,
    `Send reply to ${targetCase.customer.name}?`,
    approval.id,
  );
  return textResult(outcome.resultText);
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
  getSession().status = "waiting_on_human";
  getSession().currentStepId = "wait_human";
  getSession().agentState = "idle";
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
  const outcome = await waitForVisibleHumanApproval(
    client,
    `Refund ${formatMoney(approval.payload.amount_usd)} to ${targetCase.customer.name}?`,
    approval.id,
  );
  return textResult(outcome.resultText);
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
  const outcome = await waitForVisibleHumanApproval(
    client,
    "Page billing-primary?",
    approval.id,
  );
  return textResult(outcome.resultText);
}

function handleListPendingApprovals() {
  return textResult(JSON.stringify(state.pendingApprovals, null, 2));
}

function handleGetSession() {
  return textResult(JSON.stringify(sessionSnapshot(), null, 2));
}

function handleListWatchers() {
  return textResult(JSON.stringify(sessionSnapshot().watchers, null, 2));
}

function handleRedirectAgent({ instruction }) {
  return textResult(redirectAgentSession(instruction || "", getSession().owner, "redirect_agent"));
}

function handleHandoffSession({ to_participant }) {
  if (!PARTICIPANTS[to_participant]) {
    return textResult("Error: to_participant must be sam or jordan.");
  }
  return textResult(handoffSessionTo(to_participant, "handoff_session"));
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
  const outcome = await waitForVisibleHumanApproval(
    client,
    `Resolve ${case_id}?`,
    approval.id,
  );
  return textResult(outcome.resultText);
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

function waitForVisibleHumanApproval(client, message, approvalId) {
  const session = getSession();
  session.status = "waiting_on_human";
  session.currentStepId = "wait_human";
  const approvalPromise = new Promise((resolve) => {
    approvalWaiters.set(approvalId, resolve);
  });
  requestBrowserInteraction(client, message, approvalId);
  return approvalPromise;
}

function requestBrowserInteraction(client, message, approvalId) {
  openApprovalModal(approvalId);
  if (!client || typeof client.requestUserInteraction !== "function") return;
  try {
    const interaction = client.requestUserInteraction(async () => {
      openApprovalModal(approvalId);
      return { message, approval_id: approvalId };
    });
    if (interaction && typeof interaction.catch === "function") {
      void interaction.catch(() => {});
    }
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
    getSession().status = "running";
    finishApprovalWaiter(approvalId, {
      approved: true,
      resultText: `Human approved send_reply. Reply sent to ${targetCase.customer.name}.`,
    });
  }

  if (approval.kind === "issue_refund") {
    targetCase.refund.state = "issued";
    targetCase.refund.issuedAt = new Date().toISOString();
    targetCase.refund.requestedAmount = approval.payload.amount_usd;
    targetCase.status = "refunded";
    getSession().status = "running";
    addTimeline(targetCase, {
      actor: "agent",
      text: `Ledger event: issued ${formatMoney(approval.payload.amount_usd)} refund to ${targetCase.customer.name}.`,
      stateChange: "Refund issued",
      toolName: "issue_refund",
    });
    finishApprovalWaiter(approvalId, {
      approved: true,
      resultText: `Human approved issue_refund. ${formatMoney(approval.payload.amount_usd)} refund issued to ${targetCase.customer.name}.`,
    });
  }

  if (approval.kind === "page_oncall") {
    getSession().status = "running";
    addTimeline(targetCase, {
      actor: "agent",
      text: `Paged on-call: billing-primary. ${approval.payload.message}`,
      stateChange: "On-call paged",
      toolName: "page_oncall",
    });
    finishApprovalWaiter(approvalId, {
      approved: true,
      resultText: "Human approved page_oncall. Paged billing-primary.",
    });
  }

  if (approval.kind === "resolve_case") {
    targetCase.status = "resolved";
    getSession().status = "running";
    addTimeline(targetCase, {
      actor: "agent",
      text: `Resolved case. ${approval.payload.resolution_summary}`,
      stateChange: "Case resolved",
      toolName: "resolve_case",
    });
    finishApprovalWaiter(approvalId, {
      approved: true,
      resultText: `Human approved resolve_case. ${targetCase.id} is resolved.`,
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
  getSession().status = "running";
  addTimeline(targetCase, {
    actor: "human",
    text: `Rejected agent request: ${approvalSummary(approval)}`,
    stateChange: "Approval rejected",
  });
  finishApprovalWaiter(approvalId, {
    approved: false,
    resultText: `Human rejected ${approval.kind} for ${targetCase.id}. No side effect applied.`,
  });
  state.pendingApprovals = state.pendingApprovals.filter((item) => item.id !== approvalId);
  closeApprovalModal();
  saveState();
  render();
}

function finishApprovalWaiter(approvalId, outcome) {
  const resolve = approvalWaiters.get(approvalId);
  if (!resolve) return;
  approvalWaiters.delete(approvalId);
  resolve(outcome);
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

function formatSessionStatus(status) {
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

function getModelContext() {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  const modelContext = document.modelContext || navigator.modelContext;
  return modelContext || null;
}

function exposeJudgeApi() {
  const judgeApi = {
    call(name, input = {}, client = {}) {
      return callLocalTool(name, input, client);
    },
    get lastToolCall() {
      return state.toolCalls[0] || null;
    },
    get modelContextPresent() {
      return Boolean(getModelContext());
    },
    get registeredTools() {
      return [...state.registeredTools];
    },
    get state() {
      return state;
    },
    get tools() {
      return Object.fromEntries(
        webMcpTools().map((tool) => [
          tool.name,
          {
            ...tool,
            execute: (input = {}, client = {}) => callLocalTool(tool.name, input, client),
          },
        ]),
      );
    },
  };
  window.handoffJudge = judgeApi;
  window.HANDOFF_JUDGE = judgeApi;
}
