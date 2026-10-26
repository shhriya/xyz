import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Check,
  X,
  FileCode2,
  FilePlus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ClipboardCheck,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const DIFF_LINE_CAP = 800;

function diffLines(oldText, newText) {
  const a = (oldText || "").split("\n");
  const b = (newText || "").split("\n");
  if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) return null;
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0, oldNo = 1, newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "ctx", text: a[i], oldNo: oldNo++, newNo: newNo++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i], oldNo: oldNo++ }); i++; }
    else { out.push({ type: "add", text: b[j], newNo: newNo++ }); j++; }
  }
  while (i < n) { out.push({ type: "del", text: a[i], oldNo: oldNo++ }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j], newNo: newNo++ }); j++; }
  return out;
}

function DiffView({ oldContent, newContent }) {
  const diff = useMemo(() => diffLines(oldContent, newContent), [oldContent, newContent]);
  if (!diff) {
    return <pre className="p-3 text-[11px] text-[#334155] whitespace-pre-wrap max-h-80 overflow-y-auto">{newContent}</pre>;
  }
  const CONTEXT = 3;
  const rows = [];
  diff.forEach((line, idx) => {
    if (line.type !== "ctx") { rows.push({ ...line, idx }); return; }
    const near = diff.slice(Math.max(0, idx - CONTEXT), idx + CONTEXT + 1).some((l) => l.type !== "ctx");
    if (near) rows.push({ ...line, idx });
    else if (rows[rows.length - 1]?.type !== "skip") rows.push({ type: "skip", idx });
  });
  const added = diff.filter((l) => l.type === "add").length;
  const removed = diff.filter((l) => l.type === "del").length;
  return (
    <div>
      <div className="px-3 py-1.5 text-[10.5px] font-mono border-b border-[#E2E8F0] bg-[#F8FAFC] flex gap-3">
        <span className="text-emerald-700">+{added}</span>
        <span className="text-rose-700">−{removed}</span>
      </div>
      <div className="max-h-80 overflow-y-auto font-mono text-[11px] leading-[1.55]">
        {rows.map((line) =>
          line.type === "skip" ? (
            <div key={line.idx} className="px-3 py-0.5 text-[#94A3B8] bg-[#F1F5F9] text-center">⋯ unchanged lines ⋯</div>
          ) : (
            <div
              key={line.idx}
              className={`flex ${line.type === "add" ? "bg-emerald-50" : line.type === "del" ? "bg-rose-50" : ""}`}
            >
              <span className="w-9 shrink-0 text-right pr-2 text-[#94A3B8] select-none">{line.oldNo ?? ""}</span>
              <span className="w-9 shrink-0 text-right pr-2 text-[#94A3B8] select-none">{line.newNo ?? ""}</span>
              <span className={`w-4 shrink-0 select-none ${line.type === "add" ? "text-emerald-700" : line.type === "del" ? "text-rose-700" : "text-transparent"}`}>
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
              </span>
              <span className={`whitespace-pre-wrap pr-3 ${line.type === "add" ? "text-emerald-900" : line.type === "del" ? "text-rose-900" : "text-[#475569]"}`}>
                {line.text}
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ReviewFile({ change, messageId, currentContent, onApprove, onDecline, onOpenFile }) {
  const pending = change.status === "pending";
  const [open, setOpen] = useState(pending);
  const hasContent = change.content !== undefined;
  return (
    <div className={`border rounded-xl overflow-hidden bg-white ${pending ? "border-[#CBD5E1]" : "border-[#E2E8F0] opacity-80"}`}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <button
          onClick={() => hasContent && setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
        >
          {hasContent && (open ? <ChevronDown className="w-3.5 h-3.5 text-[#64748B] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[#64748B] shrink-0" />)}
          {change.isNew ? <FilePlus className="w-4 h-4 text-emerald-600 shrink-0" /> : <FileCode2 className="w-4 h-4 text-[#1C58F6] shrink-0" />}
          <span className="text-[12px] font-mono font-semibold text-[#1E293B] truncate">{change.path}</span>
          <span className={`text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${change.isNew ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
            {change.isNew ? "New file" : "Modified"}
          </span>
        </button>
        {pending && hasContent ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onDecline(messageId, change.path)}
              className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] text-[#475569] hover:bg-[#F1F5F9] text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" /> Reject
            </button>
            <button
              onClick={() => onApprove(messageId, change.path)}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Check className="w-3 h-3" /> Accept
            </button>
          </div>
        ) : change.status === "approved" ? (
          <button onClick={() => onOpenFile(change.path)} className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1 shrink-0 cursor-pointer hover:underline">
            <CheckCircle2 className="w-3.5 h-3.5" /> Applied — open
          </button>
        ) : change.status === "declined" ? (
          <span className="text-[11px] font-semibold text-[#94A3B8] flex items-center gap-1 shrink-0">
            <XCircle className="w-3.5 h-3.5" /> Rejected
          </span>
        ) : null}
      </div>
      {change.reason && (
        <p className="px-3 pb-2.5 -mt-1 text-[11.5px] text-[#64748B] leading-relaxed">{change.reason}</p>
      )}
      {open && hasContent && (
        <div className="border-t border-[#E2E8F0]">
          <DiffView oldContent={change.isNew ? "" : currentContent} newContent={change.content} />
        </div>
      )}
    </div>
  );
}

function requestStatus(msg) {
  if (!msg) return { label: "Working…", tone: "text-[#1C58F6]", Icon: Loader2, spin: true };
  if (msg.error) return { label: "Failed", tone: "text-rose-600", Icon: AlertCircle };
  const changes = msg.changes || [];
  if (changes.length === 0) return { label: "No changes needed", tone: "text-[#64748B]", Icon: CheckCircle2 };
  const pending = changes.filter((c) => c.status === "pending").length;
  if (pending) return { label: `${pending} awaiting review`, tone: "text-amber-600", Icon: Clock };
  const accepted = changes.filter((c) => c.status === "approved").length;
  return accepted
    ? { label: `${accepted} of ${changes.length} applied`, tone: "text-emerald-600", Icon: CheckCircle2 }
    : { label: "All rejected", tone: "text-[#94A3B8]", Icon: XCircle };
}

/**
 * InlineReviewPanel — renders directly below the submit button inside the workspace.
 * Shows the latest AI-proposed changes (diffs) with Accept/Decline per file,
 * plus a collapsible history of past requests.
 */
export default function InlineReviewPanel({
  messages,
  fileContent,
  onApprove,
  onDecline,
  onApproveAll,
  onDeclineAll,
  onOpenFile,
}) {
  const requests = useMemo(() => {
    const out = [];
    messages.forEach((m) => {
      if (m.role === "user") out.push({ id: m.id, text: m.text, reply: null });
      else if (out.length && !out[out.length - 1].reply) out[out.length - 1].reply = m;
    });
    return out.reverse();
  }, [messages]);

  const [selectedId, setSelectedId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const latestReplyId = requests[0]?.reply?.id;

  useEffect(() => {
    if (requests[0]) setSelectedId(requests[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests.length, latestReplyId]);

  const selected = requests.find((r) => r.id === selectedId) || requests[0];
  const reply = selected?.reply;
  const pendingCount = (reply?.changes || []).filter((c) => c.status === "pending").length;

  if (requests.length === 0) return null;

  return (
    <div className="mt-5 space-y-3 animate-in fade-in duration-300">
      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#D1DEFF]" />
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#94A3B8]">
          Proposed Changes
        </span>
        <div className="h-px flex-1 bg-[#D1DEFF]" />
      </div>

      {/* Current review */}
      {!reply ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[#475569]">
          <Loader2 className="w-5 h-5 animate-spin text-[#1C58F6]" />
          <p className="text-sm font-semibold">Reading the project and preparing changes…</p>
        </div>
      ) : reply.error ? (
        <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {reply.error}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary */}
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 flex gap-2.5">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94A3B8] mb-0.5">AI Summary</div>
              <p className="text-[12.5px] text-[#334155] leading-relaxed">{reply.summary}</p>
            </div>
          </div>

          {/* File cards */}
          {reply.changes?.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[#475569]">
                  {reply.changes.length} file{reply.changes.length === 1 ? "" : "s"} affected
                  {pendingCount > 0 && <span className="text-amber-600"> · {pendingCount} awaiting your review</span>}
                </span>
                {pendingCount > 1 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onDeclineAll(reply.id)}
                      className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-[#475569] hover:bg-white text-xs font-semibold cursor-pointer"
                    >
                      Reject all
                    </button>
                    <button
                      onClick={() => onApproveAll(reply.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                    >
                      Accept all ({pendingCount})
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-2.5">
                {reply.changes.map((c) => (
                  <ReviewFile
                    key={c.path}
                    change={c}
                    messageId={reply.id}
                    currentContent={fileContent[c.path] || ""}
                    onApprove={onApprove}
                    onDecline={onDecline}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* History toggle */}
      {requests.length > 1 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-[11px] font-semibold text-[#64748B] hover:text-[#10338D] flex items-center gap-1 cursor-pointer"
          >
            {showHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Clock className="w-3 h-3" />
            <span>{requests.length - 1} previous request{requests.length > 2 ? "s" : ""}</span>
          </button>
          {showHistory && (
            <div className="mt-2 border border-[#E2E8F0] rounded-xl overflow-hidden max-h-60 overflow-y-auto bg-white">
              {requests.slice(1).map((r) => {
                const st = requestStatus(r.reply);
                const active = r.id === selectedId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-4 py-2.5 border-l-2 cursor-pointer ${active ? "bg-[#ECEFFF] border-[#1C58F6]" : "border-transparent hover:bg-[#F8FAFC]"}`}
                  >
                    <p className="text-[12px] text-[#1E293B] line-clamp-2">{r.text}</p>
                    <p className={`mt-1 text-[10.5px] font-semibold flex items-center gap-1 ${st.tone}`}>
                      <st.Icon className={`w-3 h-3 ${st.spin ? "animate-spin" : ""}`} /> {st.label}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
