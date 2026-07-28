import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Settings,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import LandingPage from "./pages/landing";
import InterviewPrepPage from "./pages/interviewPrep";
import ManagePage from "./pages/manage";

// Import generated premium 3D holographic crystal graphics
const prismHero = "/src/assets/images/prism_hero_1781065935616.png";

export default function App() {
  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<"resume" | "interview" | "manage">("resume");

  // Header scroll state
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 30);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // App Admin State (shared with header ADMIN badge)
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Settings & Model Dialog State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem("selected_gemini_model") || "gemini-2.5-flash";
  });
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    return localStorage.getItem("user_gemini_api_key") || "";
  });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<{ hasApiKey: boolean; loading: boolean }>({
    hasApiKey: false,
    loading: true,
  });

  // Shared candidate resume text - used as a fallback profile source by Interview Prep
  const [resumeText, setResumeText] = useState<string>("");

  // Fetch initial configs
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        setApiKeyStatus({
          hasApiKey: data.hasApiKey,
          loading: false,
        });
      })
      .catch(() => {
        setApiKeyStatus({
          hasApiKey: false,
          loading: false,
        });
      });
  }, []);

  const handleApiKeyChange = (val: string) => {
    setUserApiKey(val);
    localStorage.setItem("user_gemini_api_key", val);
  };

  return (
    <div className="flex flex-col min-h-screen text-[#eef0f3] selection:bg-[#00d4dc] selection:text-[#0a0c0d]">

      {/* Dynamic API Warning message */}
      {!apiKeyStatus.loading && !apiKeyStatus.hasApiKey && !userApiKey && (
        <div className="bg-[#1c2128] text-[#fbbf24] border-b border-[rgba(255,255,255,0.07)] text-xs md:text-sm font-semibold px-4 py-3 text-center flex items-center justify-center gap-2  transition-all">
          <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0" />
          <span>No GEMINI_API_KEY detected in system. Enter your custom API Key in the AI Orchestration Center below to unlock features!</span>
        </div>
      )}

      {/* Top Layer Header with premium Frosted Glass Navbar */}
      <header className="sticky top-0 z-[100] w-full max-w-5xl mx-auto px-4 pt-4 pb-2 bg-transparent ">
        <div
          className={`flex items-center justify-between gap-4 h-14 px-6 rounded-[10px] border border-[rgba(255,255,255,0.07)] transition-all duration-300 ${isScrolled
              ? "bg-[#161a1e]/70 backdrop-blur-xl shadow-lg shadow-black/20"
              : "bg-[#161a1e]"
            }`}
        >
          {/* Logo Brand */}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00d4dc] animate-pulse" />
            <span className="font-display font-semibold text-xs md:text-sm tracking-widest text-[#eef0f3] uppercase">
              CAREER COPILOT
            </span>
            {isAdmin && (
              <span className="text-[9px] bg-[rgba(0,212,220,0.1)] text-[#00d4dc] border border-[rgba(0,212,220,0.25)] rounded-[4px] px-2 py-0.5 font-bold uppercase tracking-wider">
                ADMIN
              </span>
            )}
          </div>

          {/* Nav Links Tabs */}
          <nav className="flex items-center gap-1 md:gap-2">
            <button
              onClick={() => setActiveTab("resume")}
              className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${activeTab === "resume"
                  ? "bg-[#00d4dc] text-[#0a0c0d]  font-bold"
                  : "text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128]"
                }`}
            >
              Resume Audit
            </button>
            <button
              onClick={() => setActiveTab("interview")}
              className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${activeTab === "interview"
                  ? "bg-[#00d4dc] text-[#0a0c0d]  font-bold"
                  : "text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128]"
                }`}
            >
              Interview Prep
            </button>
            <button
              onClick={() => setActiveTab("manage")}
              className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${activeTab === "manage"
                  ? "bg-[#00d4dc] text-[#0a0c0d]  font-bold"
                  : "text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128]"
                }`}
            >
              Manage
            </button>
          </nav>

          {/* Action Settings Panel */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] rounded-[5px] transition-all"
              title="Model Configurations"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Header backdrop */}
      <div
        className={`fixed top-0 inset-x-0 z-99 h-22 pointer-events-none transition-all duration-300 ${isScrolled
          ? "backdrop-blur-xl bg-[#191f22]/60 border-b border-[rgba(255,255,255,0.07)]"
          : "bg-transparent"
          }`}
      />


      {/* Model Selection / Settings Sidebar Overlay */}
      {showSettings && (
        <div className="fixed inset-0 z-101 flex justify-end bg-black/60 ">
          <div className="w-full max-w-sm bg-[#161a1e] border-l border-[rgba(255,255,255,0.07)] p-6 md:p-8 flex flex-col gap-6  h-full overflow-y-auto animate-in slide-in-from-right duration-200 text-[#eef0f3]">
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] pb-4">
              <h2 className="text-lg font-bold font-display text-[#eef0f3]">AI Settings & Auth</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 text-[#6b7685] hover:text-[#eef0f3] rounded-[5px] hover:bg-[#1c2128]"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#6b7685]">Target Model</label>
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  localStorage.setItem("selected_gemini_model", e.target.value);
                }}
                className="w-full p-2.5 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs font-semibold text-[#eef0f3] focus:outline-none focus:ring-1 focus:ring-[#00d4dc] focus:border-[#00d4dc]"
              >
                <option value="gemini-2.5-flash">gemini-2.5-flash (Fast & recommended)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (Highly analytical)</option>
                <option value="gemini-1.5-flash">gemini-1.5-flash (Stable lightweight)</option>
                <option value="gemini-1.5-pro">gemini-1.5-pro (High context reasoning)</option>
                <option value="gemini-3.5-flash">gemini-3.5-flash (Generic fallback)</option>
              </select>
              <p className="text-[10px] text-[#6b7685] leading-normal">
                Models govern processing power and rate limits for code metrics analysis.
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-[rgba(255,255,255,0.07)] pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6b7685]">API Key Credentials</p>
              <div className="p-3.5 rounded-[6px] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${userApiKey ? "bg-emerald-500" : (apiKeyStatus.hasApiKey ? "bg-[#00d4dc] animate-pulse" : "bg-amber-500")}`} />
                  <span className="text-xs font-medium text-[#9aa3b0]">
                    {userApiKey ? "Using Custom override" : (apiKeyStatus.hasApiKey ? "Server key authorized" : "Key missing")}
                  </span>
                </div>
                <span className="text-[10px] text-[#6b7685] font-mono">
                  {userApiKey ? "CUSTOM" : (apiKeyStatus.hasApiKey ? "SECURE_ENV" : "MISSING")}
                </span>
              </div>
              <input
                type="password"
                value={userApiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="Overriding GEMINI_API_KEY..."
                className="w-full p-2.5 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs font-mono text-[#eef0f3] focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
              />
              <p className="text-[10px] text-[#6b7685] leading-normal">
                Credentials entered here take immediate precedence and are securely routed to prevent code exports.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 pt-1 pb-8 md:pt-2 md:pb-10">

        {/* PREMIUM VISUAL 3D PYRAMID HERO COVER - hidden on the Manage page */}
        {activeTab !== "manage" && (
          <div className="mb-6 relative overflow-hidden rounded-[10px] bg-[#161a1e] border border-[rgba(255,255,255,0.07)] text-[#eef0f3]  ">
            <div className="absolute inset-0 z-0 opacity-5">
              <img
                src={prismHero}
                alt="Holographic crystal geometries decoration"
                className="w-full h-full object-cover scale-105 filter blur-3xs"
              />
            </div>
            <div className="relative z-10 px-6 py-8 md:px-10 md:py-10 flex flex-col justify-between min-h-[220px] md:min-h-[240px]">
              <div>
                <p className="text-[10px] md:text-xs font-semibold uppercase tracking-widest text-[#00d4dc] bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.25)] px-3.5 py-1.5 rounded-[4px] w-fit mb-5">
                  ✦ Space-Prism AI Engine Enabled
                </p>
                <h1 className="text-3xl md:text-5xl font-light font-display tracking-tight leading-none text-[#eef0f3] max-w-3xl">
                  Resume and <span className="font-medium text-[#00d4dc]">Interview Tool</span>
                </h1>
                <p className="text-xs md:text-sm text-[#9aa3b0] max-w-2xl mt-4 leading-relaxed font-sans">
                  {activeTab === "resume" && "Align your professional dossier against enterprise JD parameters. Utilize dynamic light-glass card stacks to input mandates, parse qualifications, and render diagnostic reports."}
                  {activeTab === "interview" && "Generate simulation exercises, score interview performance transcripts with dynamic metrics, and compile tailored recommendations."}
                </p>
              </div>

              {/* Custom high fidelity Stats row matching screenshot 1 style */}
              <div className="grid grid-cols-3 gap-4 border-t border-[rgba(255,255,255,0.07)] pt-6 md:pt-8 mt-8 w-fit md:w-3/4">
                <div>
                  <p className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-[#eef0f3]">150K+</p>
                  <p className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-widest mt-0.5">Audits</p>
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-[#eef0f3]">99.8%</p>
                  <p className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-widest mt-0.5">Precision</p>
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-display font-semibold tracking-tight text-[#eef0f3]">180+</p>
                  <p className="text-[10px] font-semibold text-[#6b7685] uppercase tracking-widest mt-0.5">Industries</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COMPREHENSIVE AI ORCHESTRATION DOCK (MODEL SELECT & API KEY INPUT) */}
        <div className="mb-6 w-full relative">
          <div className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 rounded-[10px]  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
            <div className="flex flex-col md:flex-row gap-6 items-stretch justify-between">

              {/* Box Info - AI Engine Details */}
              <div className="flex-1 flex gap-4 items-center">
                <div className="p-3  bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.2)] rounded-[8px] shrink-0">
                  <Sparkles className="w-5 h-5 text-[#00d4dc] animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#eef0f3] tracking-tight flex items-center gap-1.5">
                    AI Active Parameters
                    <span className="text-[10px] bg-[rgba(0,212,220,0.12)] text-[#00d4dc] font-mono font-semibold px-2 py-0.5 rounded-[4px] uppercase tracking-wider">Online</span>
                  </h3>
                  <p className="text-xs text-[#9aa3b0] mt-0.5">
                    Select target reasoning networks and optional personal keys. Default fallback active.
                  </p>
                </div>
              </div>

              {/* Box Dropdown - Model selection dropdown */}
              <div className="flex flex-col gap-1.5 justify-center">
                <label htmlFor="model_select" className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7685]">
                  Target AI Model
                </label>
                <select
                  id="model_select"
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    localStorage.setItem("selected_gemini_model", e.target.value);
                  }}
                  className="p-2.5 pr-8 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs font-semibold text-[#eef0f3] focus:outline-none focus:ring-1 focus:ring-[#00d4dc] focus:border-[#00d4dc] font-mono"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash (Fast & recommended)</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro (Highly analytical)</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash (Stable lightweight)</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro (High context reasoning)</option>
                  <option value="gemini-3.5-flash">gemini-3.5-flash (Legacy fallback)</option>
                </select>
              </div>

              {/* Box Input - Custom API Key Override input with toggle */}
              <div className="flex flex-col gap-1.5 justify-center md:w-80">
                <div className="flex justify-between items-center">
                  <label htmlFor="api_key_override" className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7685]">
                    Your Personal API Key
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${userApiKey ? "bg-emerald-500 animate-ping" : (apiKeyStatus.hasApiKey ? "bg-[#00d4dc]" : "bg-amber-500")}`} />
                    <span className="text-[9px] font-mono text-[#6b7685]">
                      {userApiKey ? "CUSTOM_KEY_OVERRIDE" : (apiKeyStatus.hasApiKey ? "SYS_KEY_ACTIVE" : "NO_KEY_PROVIDE")}
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <input
                    id="api_key_override"
                    type={showApiKey ? "text" : "password"}
                    value={userApiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="Provide custom GEMINI_API_KEY..."
                    className="w-full p-2.5 pr-10 border border-[rgba(255,255,255,0.07)] bg-[#1c2128] rounded-[6px] text-xs font-mono text-[#eef0f3] focus:outline-none focus:ring-1 focus:ring-[#00d4dc] focus:border-[#00d4dc] placeholder:text-[#6b7685]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b7685] hover:text-[#9aa3b0] transition-colors"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ─── PAGE: RESUME AUDIT ─── */}
        {activeTab === "resume" && (
          <LandingPage
            resumeText={resumeText}
            setResumeText={setResumeText}
            selectedModel={selectedModel}
            userApiKey={userApiKey}
          />
        )}

        {/* ─── PAGE: INTERVIEW PREP & SCORING ─── */}
        {activeTab === "interview" && (
          <InterviewPrepPage
            resumeText={resumeText}
            selectedModel={selectedModel}
            userApiKey={userApiKey}
          />
        )}

        {/* ─── PAGE: ADMIN/MANAGE ─── */}
        {activeTab === "manage" && (
          <ManagePage isAdmin={isAdmin} setIsAdmin={setIsAdmin} />
        )}

      </main>

      <footer className="w-full text-center py-8 border-t border-[rgba(255,255,255,0.07)] text-[10px] tracking-widest text-[#6b7685] uppercase mt-auto">
        © 2026 CAREER COPILOT • Made For QIBA • Collaboration of Alumnis
      </footer>
    </div>
  );
}
