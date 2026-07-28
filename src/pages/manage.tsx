import React, { useState } from "react";
import { Lock, AlertTriangle, FolderLock } from "lucide-react";

interface ManagePageProps {
  isAdmin: boolean;
  setIsAdmin: (val: boolean) => void;
}

export default function ManagePage({ isAdmin, setIsAdmin }: ManagePageProps) {
  const [adminUsername, setAdminUsername] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminError, setAdminError] = useState<string>("");
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  // Manage Fallback configuration text
  const [defaultResumePr, setDefaultResumePr] = useState<string>("");
  const [defaultInterviewPr, setDefaultInterviewPr] = useState<string>("");
  const [defaultEvaluationPr, setDefaultEvaluationPr] = useState<string>("");

  // Mock Login sequence for demonstration
  const handleAdminLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError("");
    setIsLoggingIn(true);

    setTimeout(() => {
      if (adminUsername === "qibaitintern" && adminPassword === "qibaitintern") {
        setIsAdmin(true);
        setAdminUsername("");
        setAdminPassword("");
        setAdminError("");
      } else {
        setAdminError("Invalid user level credentials.");
      }
      setIsLoggingIn(false);
    }, 400);
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-6 md:p-8  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col gap-6 text-[#eef0f3] col-span-1">
      {!isAdmin ? (
        <form onSubmit={handleAdminLoginSubmit} className="flex flex-col gap-5">
          <div className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.07)] pb-4">
            <div className="p-3 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] text-[#9aa3b0]">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display text-[#eef0f3]">Admin Sign In Required</h2>
              <p className="text-xs text-[#6b7685]">Unlock default systemic fallback prompts configuration.</p>
            </div>
          </div>

          {adminError && (
            <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{adminError}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-wider">Username</label>
            <input
              type="text"
              required
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="Enter admin identifier..."
              className="w-full p-3 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none text-[#eef0f3] placeholder-[#6b7685]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter security key..."
              className="w-full p-3 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none text-[#eef0f3]"
            />
            <span className="text-[10px] text-[#6b7685] mt-1 font-sans">Hint for tester: username <b className="text-[#9aa3b0]">qibaitintern</b> / password <b className="text-[#9aa3b0]">qibaitintern</b></span>
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full bg-[#00d4dc] text-[#0a0c0d] text-xs font-semibold py-3.5 rounded-[5px] hover:opacity-90 tracking-widest uppercase mt-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {isLoggingIn ? "Authorizing..." : "Authenticate Admin"}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] text-[#00d4dc] rounded-[8px]">
                <FolderLock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold font-display text-[#eef0f3]">Configure Default Prompts</h2>
                <p className="text-xs text-[#6b7685]">Settings currently synced with local storage fallback layers.</p>
              </div>
            </div>
            <button
              onClick={() => setIsAdmin(false)}
              className="text-xs bg-[#1c2128] border border-[rgba(255,255,255,0.07)] hover:bg-[#00d4dc]/10 hover:text-[#00d4dc] text-[#9aa3b0] font-semibold px-3 py-1.5 rounded-[5px] transition-all"
            >
              Log Out
            </button>
          </div>

          {/* Resume Prompt Default configuration editor */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-wider">Resume Default Prompt Falling Guidelines</label>
            <textarea
              rows={4}
              value={defaultResumePr || "SYSTEM DEFAULT LOADED"}
              onChange={(e) => setDefaultResumePr(e.target.value)}
              className="w-full p-3 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs text-[#9aa3b0] font-mono focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none "
              placeholder="Override prompt instructions..."
            />
          </div>

          {/* Interview Prompt Default configuration editor */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-wider">Interview Question Default Prompts</label>
            <textarea
              rows={4}
              value={defaultInterviewPr || "SYSTEM DEFAULT LOADED"}
              onChange={(e) => setDefaultInterviewPr(e.target.value)}
              className="w-full p-3 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs text-[#9aa3b0] font-mono focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none "
              placeholder="Override prompt instructions..."
            />
          </div>

          {/* Evaluation Prompt Default configuration editor */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-wider">Diagnostic Evaluation Default Prompt Guidelines</label>
            <textarea
              rows={4}
              value={defaultEvaluationPr || "SYSTEM DEFAULT LOADED"}
              onChange={(e) => setDefaultEvaluationPr(e.target.value)}
              className="w-full p-3 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs text-[#9aa3b0] font-mono focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none "
              placeholder="Override prompt instructions..."
            />
          </div>

          <div className="flex justify-between items-center bg-[#1c2128] p-4 rounded-[8px] border border-[rgba(255,255,255,0.07)] mt-2">
            <div className="text-xs text-[#6b7685] font-sans">
              <b>Reference Directories:</b> Local reference files mapped inside <span className="font-mono text-[#00d4dc] bg-[rgba(0,212,220,0.08)] px-1 py-0.5 rounded border border-[rgba(0,212,220,0.2)]">/anzsco</span> and <span className="font-mono text-[#00d4dc] bg-[rgba(0,212,220,0.08)] px-1 py-0.5 rounded border border-[rgba(0,212,220,0.25)]">/sifa</span> configurations.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
