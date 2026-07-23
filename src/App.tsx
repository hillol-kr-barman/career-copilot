import React, { useState, useEffect } from "react";
import { 
  FileText, 
  HelpCircle, 
  Sparkles, 
  User, 
  Settings, 
  Lock, 
  CheckCircle, 
  TrendingUp, 
  AlertTriangle, 
  Download, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  ListTodo, 
  FolderLock, 
  RefreshCw,
  Sliders,
  Play
} from "lucide-react";
import { StackingContainer, StackingCard } from "./components/StackingContainer";
import { FileUploader } from "./components/FileUploader";
import { InterviewScoringTable } from "./components/InterviewScoringTable";
import { ScoreRow, ResumeReportSection, ResumeReportData } from "./types";

// Import generated premium 3D holographic crystal graphics
const prismHero = "/src/assets/images/prism_hero_1781065935616.png";
const crystalFunnel = "/src/assets/images/crystal_funnel_1781065954657.png";
const crystalInfinity = "/src/assets/images/crystal_infinity_1781065965495.png";

export default function App() {
  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<"resume" | "interview" | "manage">("resume");
  
  // App Admin State
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminUsername, setAdminUsername] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminError, setAdminError] = useState<string>("");
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  
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

  // Inputs - Resume Mode
  const [resumeJd, setResumeJd] = useState<string>(
  `Role: Senior Software Engineer (Frontend)
Requirements:
- Minimum of 5 years of commercial experience in React/TypeScript
- Comprehensive experience with full-stack Node.js development
- Strong system architectural design patterns understanding`
  );
  const [resumeText, setResumeText] = useState<string>("");
  const [customResumePrompt, setCustomResumePrompt] = useState<string>("");
  const [promptNotes, setPromptNotes] = useState<string>("");
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [customPromptFileName, setCustomPromptFileName] = useState<string>("");

  // AI Detection State
  const [aiDetectText, setAiDetectText] = useState<string>("");
  const [aiDetectFileName, setAiDetectFileName] = useState<string>("");
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [aiDetectResult, setAiDetectResult] = useState<{ aiProbability: number; engine: string; sentences?: Array<{ sentence: string; fakePercentage?: number }> } | null>(null);
  const [aiDetectError, setAiDetectError] = useState<string>("");

  // Outputs - Resume Mode
  const [resumeReport, setResumeReport] = useState<ResumeReportData | null>(null);
  const [isAnalyzingResume, setIsAnalyzingResume] = useState<boolean>(false);
  const [resumeError, setResumeError] = useState<string>("");
  const [activeResumeReportTab, setActiveResumeReportTab] = useState<string>("JD Review");

  // Inputs - Interview Mode
  const [interviewJd, setInterviewJd] = useState<string>(
  `Role: Senior Software Engineer (Frontend)`
  );
  const [interviewResumeText, setInterviewResumeText] = useState<string>("");
  const [interviewResumeFileName, setInterviewResumeFileName] = useState<string>("");
  const [customInterviewPrompt, setCustomInterviewPrompt] = useState<string>("");
  const [interviewPromptFileName, setInterviewPromptFileName] = useState<string>("");

  // Outputs - Interview Mode
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState<boolean>(false);
  const [questionsReport, setQuestionsReport] = useState<string>("");
  const [interviewError, setInterviewError] = useState<string>("");

  // Intermediate - Assessment Evaluation scoring table
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([
  {
  questionDescription: "Can you detail a complex architectural scenario where React state or ref changes led to infinite loops, and how you tracked/stabilized dependencies?",
  s: 0.8,
  tE: 0.7,
  a: 0.9,
  rT: 0.8,
  starRating: 0.8,
  cS: 0.8,
  aE: 0.9,
  rA: 0.8,
  competencyRating: 0.83,
  },
  {
  questionDescription: "Demonstrate your experience preparing custom bundle setups with esbuild or Vite CJS packaging for optimized server-side telemetry runtimes.",
  s: 0.6,
  tE: 0.6,
  a: 0.5,
  rT: 0.7,
  starRating: 0.6,
  cS: 0.7,
  aE: 0.6,
  rA: 0.7,
  competencyRating: 0.67,
  },
  {
  questionDescription: "Describe your capability auditing secure OAuth integrations within constrained browser sandbox frames.",
  s: 0.5,
  tE: 0.4,
  a: 0.5,
  rT: 0.5,
  starRating: 0.48,
  cS: 0.6,
  aE: 0.5,
  rA: 0.6,
  competencyRating: 0.57,
  }
  ]);

  // Evaluated HR report State
  const [isEvaluatingInterview, setIsEvaluatingInterview] = useState<boolean>(false);
  const [evaluationReportText, setEvaluationReportText] = useState<string>("");
  const [customEvalPrompt, setCustomEvalPrompt] = useState<string>("");
  const [evalPromptFileName, setEvalPromptFileName] = useState<string>("");

  // Manage Fallback configuration text
  const [defaultResumePr, setDefaultResumePr] = useState<string>("");
  const [defaultInterviewPr, setDefaultInterviewPr] = useState<string>("");
  const [defaultEvaluationPr, setDefaultEvaluationPr] = useState<string>("");

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

  // Compute stats metrics dynamically based on scorecard rows
  const getCalculatedMetrics = () => {
  const starRatings = scoreRows.map((r) => r.starRating);
  const competencyRatings = scoreRows.map((r) => r.competencyRating);
  const allAverages = [...starRatings, ...competencyRatings];
  
  const avgScore = allAverages.length 
  ? Number((allAverages.reduce((sum, v) => sum + v, 0) / allAverages.length).toFixed(2))
  : 0.0;
  
  const strongCount = allAverages.filter((v) => v >= 0.75).length;
  const weakCount = allAverages.filter((v) => v < 0.5).length;

  return {
  averageScore: avgScore,
  strongCount,
  weakCount,
  };
  };

  const currentMetrics = getCalculatedMetrics();

  // Highlight MMR block renderer helper
  const renderHiglightedMMR = (text: string) => {
  const mmrStartIdx = text.indexOf("[[MMR_START]]");
  const mmrEndIdx = text.indexOf("[[MMR_END]]");

  if (mmrStartIdx === -1 || mmrEndIdx === -1 || mmrEndIdx <= mmrStartIdx) {
  return <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{text}</div>;
  }

  const before = text.substring(0, mmrStartIdx);
  const mmrInner = text.substring(mmrStartIdx + "[[MMR_START]]".length, mmrEndIdx).trim();
  const after = text.substring(mmrEndIdx + "[[MMR_END]]".length);

  // Filter headers if any
  const formattedMMR = mmrInner.replace(/^(Mandatory Minimum Requirements:?\s*)/i, "").trim();

  return (
  <div className="flex flex-col gap-4">
  {before && <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{before}</div>}
  
  <div className="border border-red-500/20 bg-red-500/10 rounded-[8px] p-4 md:p-5 flex flex-col gap-3 ">
  <div className="flex items-center gap-2 text-red-400 font-display font-semibold text-sm">
  <AlertTriangle className="w-4 h-4 shrink-0" />
  Mandatory Minimum Qualifications & Licenses Detected:
  </div>
  <div className="whitespace-pre-wrap text-xs md:text-sm font-semibold text-red-300 font-mono leading-relaxed bg-[#13161C] p-3 rounded-[5px] border border-red-500/10">
  {formattedMMR}
  </div>
  </div>

  {after && <div className="whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans">{after}</div>}
  </div>
  );
  };

  // Split plain text response with headers into modular structured tabs if tags matches [[X]]
  const parseSections = (rawText: string): ResumeReportSection[] => {
  const tabNames = [
  "JD Review", "Resume Review", "ATS Score", "JD Scorecard", "Resume Rewrite",
  "Strengthening", "Change Comparison", "Cover Letter", "Interview Preparation",
  "Iteration Tracking", "Readiness Analysis"
  ];

  const lines = rawText.split("\n");
  const sectionsMap: Record<string, string[]> = {};
  let currentMarker: string | null = null;

  lines.forEach((line) => {
  const stripped = line.trim();
  const matched = tabNames.find((tab) => stripped === `[[${tab}]]`);
  
  if (matched) {
  currentMarker = matched;
  sectionsMap[currentMarker] = [];
  } else if (currentMarker) {
  sectionsMap[currentMarker].push(line);
  }
  });

  // Check if we parsed successfully
  const parsedKeys = Object.keys(sectionsMap);
  if (parsedKeys.length > 0) {
  return tabNames.map((tab) => ({
  tabName: tab,
  title: tab,
  content: (sectionsMap[tab] || []).join("\n").trim() || "Information not generated for this version context.",
  }));
  }

  // Fallback split if the response didn't include markers: separate by markdown headings or list sections
  return tabNames.map((tab, i) => {
  if (i === 0) {
  return {
  tabName: tab,
  title: tab,
  content: rawText,
  };
  }
  return {
  tabName: tab,
  title: tab,
  content: "Please write specific prompts or configurations to request structured sections.",
  };
  });
  };

  // Action: Analyze Resume API caller
  const handleAnalyzeResume = async () => {
  setResumeError("");
  if (!resumeJd.trim()) {
  setResumeError("Please supply a valid Job Description before running audit.");
  return;
  }
  if (!resumeText.trim()) {
  setResumeError("Please upload a resume file or enter raw candidate text in Card #2.");
  return;
  }

  setIsAnalyzingResume(true);
  setResumeReport(null);

  try {
  const response = await fetch("/api/resume/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
  jobDescription: resumeJd,
  resumeText,
  customPrompt: customResumePrompt,
  promptNotes,
  apiKey: userApiKey,
  model: selectedModel,
  }),
  });

  const data = await response.json();
  if (!response.ok) {
  throw new Error(data.error || "Server-side analysis error.");
  }

  const rawReport = data.report;
  const tabSections = parseSections(rawReport);

  setResumeReport({
  body: rawReport,
  tabSections,
  modelUsed: data.modelUsed,
  });

  // Default active subtab to direct report findings
  setActiveResumeReportTab("JD Review");
  } catch (err: any) {
  setResumeError(err?.message || "Critical error connecting with server model.");
  } finally {
  setIsAnalyzingResume(false);
  }
  };

  // Action: Generate Tailored Interview Questions
  const handleGenerateQuestions = async () => {
  setInterviewError("");
  const jdToUse = interviewJd.trim();
  const resumeToUse = interviewResumeText.trim() || resumeText.trim();

  if (!jdToUse) {
  setInterviewError("Please provide a representative Job Description.");
  return;
  }
  if (!resumeToUse) {
  setInterviewError("Please upload a resume or audit text to extract customized questions.");
  return;
  }

  setIsGeneratingQuestions(true);
  setQuestionsReport("");

  try {
  const response = await fetch("/api/interview/questions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
  jobDescription: jdToUse,
  resumeText: resumeToUse,
  customPrompt: customInterviewPrompt,
  apiKey: userApiKey,
  model: selectedModel,
  }),
  });

  const data = await response.json();
  if (!response.ok) {
  throw new Error(data.error || "Simulation generator failed.");
  }

  setQuestionsReport(data.report);

  // Instantly inject questions representation as descriptions into the scoring scorecard table
  // to synchronize the workflow dynamically!
  const questionsList = data.report
  .split("\n")
  .map((line: string) => line.trim())
  .filter((line: string) => /^\d+\.\s+/.test(line) || line.startsWith("Q:") || line.includes("?"))
  .slice(0, 5);

  if (questionsList.length > 0) {
  const nextScoreRows = questionsList.map((q: string, i: number) => ({
  questionDescription: q.replace(/^\d+\.\s*/, "").replace(/^Q:\s*/, ""),
  s: 0.5,
  tE: 0.5,
  a: 0.5,
  rT: 0.5,
  starRating: 0.5,
  cS: 0.5,
  aE: 0.5,
  rA: 0.5,
  competencyRating: 0.5,
  }));
  setScoreRows(nextScoreRows);
  }
  } catch (err: any) {
  setInterviewError(err?.message || "Connection timeout or model quota error.");
  } finally {
  setIsGeneratingQuestions(false);
  }
  };

  // Action: Compute final coaching evaluation narrative reports
  const handleEvaluateInterview = async () => {
  setInterviewError("");
  setIsEvaluatingInterview(true);
  setEvaluationReportText("");

  const metricTable = [
  { metric: "Overall STAR Average", value: currentMetrics.averageScore },
  { metric: "High Performance Skills (>= 0.75)", value: currentMetrics.strongCount },
  { metric: "Areas of Concern (< 0.5)", value: currentMetrics.weakCount },
  ];

  try {
  const response = await fetch("/api/interview/evaluate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
  scoringTable: scoreRows,
  metricTable: metricTable,
  questionSimulationReport: questionsReport,
  customPrompt: customEvalPrompt,
  apiKey: userApiKey,
  model: selectedModel,
  }),
  });

  const data = await response.json();
  if (!response.ok) {
  throw new Error(data.error || "Diagnostic report failed.");
  }

  setEvaluationReportText(data.report);
  } catch (err: any) {
  setInterviewError(err?.message || "Assessment narrative computation failure.");
  } finally {
  setIsEvaluatingInterview(false);
  }
  };

  // Browser download helper for text content
  const handleDownload = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  };

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

  // Action: AI content rate detection
  const handleAiDetect = async () => {
  setAiDetectError("");
  setAiDetectResult(null);
  if (!aiDetectText.trim()) {
  setAiDetectError("Please upload a file or paste text to detect.");
  return;
  }
  setIsDetecting(true);
  try {
  const response = await fetch("/api/ai-detect", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: aiDetectText }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Detection failed.");
  setAiDetectResult(data);
  } catch (err: any) {
  setAiDetectError(err?.message || "Detection service unavailable.");
  } finally {
  setIsDetecting(false);
  }
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
  <div className="flex items-center justify-between gap-4 h-14 px-6 rounded-[10px] border border-[rgba(255,255,255,0.07)] bg-[#161a1e] transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
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
  className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${
  activeTab === "resume"
  ? "bg-[#00d4dc] text-[#0a0c0d]  font-bold"
  : "text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128]"
  }`}
  >
  Resume Audit
  </button>
  <button
  onClick={() => setActiveTab("interview")}
  className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${
  activeTab === "interview"
  ? "bg-[#00d4dc] text-[#0a0c0d]  font-bold"
  : "text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128]"
  }`}
  >
  Interview Prep
  </button>
  <button
  onClick={() => setActiveTab("manage")}
  className={`px-4 py-2 rounded-[5px] text-[11px] md:text-xs font-semibold tracking-wide transition-all ${
  activeTab === "manage"
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

  {/* Model Selection / Settings Sidebar Overlay */}
  {showSettings && (
  <div className="fixed inset-0 z-50 flex justify-end bg-black/60 ">
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

  <div className="mt-auto pt-6 border-t border-[rgba(255,255,255,0.07)]">
  <button
  onClick={() => setShowSettings(false)}
  className="w-full bg-[#00d4dc] text-[#0a0c0d] text-xs font-semibold py-3 rounded-[5px] hover:opacity-90 uppercase tracking-widest active:scale-95 transition-all"
  >
  Close Settings
  </button>
  </div>
  </div>
  </div>
  )}

  {/* Main Container */}
  <main className="flex-1 w-full max-w-5xl mx-auto px-4 pt-1 pb-8 md:pt-2 md:pb-10">
  
  {/* PREMIUM VISUAL 3D PYRAMID HERO COVER */}
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
  {activeTab === "manage" && "Sign in below to customize default system workflows, review custom training prompts, and administer systemic triggers."}
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

  {/* ─── TAB 1: RESUME AUDIT MODULE ─── */}
  {activeTab === "resume" && (
  <div className="flex flex-col gap-6">

  {/* AI CONTENT DETECTION CARD */}
  <div className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] p-5 md:p-6 rounded-[10px]  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
  {/* Header */}
  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[rgba(255,255,255,0.07)]">
  <div className="p-2.5  bg-[rgba(0,212,220,0.08)] border border-[rgba(0,212,220,0.2)] rounded-[8px] shrink-0">
  <CheckCircle2 className="w-5 h-5 text-[#00d4dc]" />
  </div>
  <div className="flex-1">
  <h3 className="text-sm font-semibold text-[#eef0f3] tracking-tight flex items-center gap-2">
  AI Content Detection
  <span className="text-[10px] bg-[rgba(0,212,220,0.12)] text-[#00d4dc] font-mono font-semibold px-2 py-0.5 rounded-[4px] uppercase tracking-wider">Zero-Shot</span>
  </h3>
  <p className="text-xs text-[#6b7685] mt-0.5">
  Upload or paste document text to detect AI-generated content rate before audit.
  </p>
  </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
  {/* Left: upload + paste */}
  <div className="flex flex-col gap-3">
  <FileUploader
  id="ai_detect_file"
  label="Upload Document to Check"
  placeholderText="Drop file to extract text for AI detection"
  onTextLoaded={(text, filename) => {
  setAiDetectText(text);
  setAiDetectFileName(filename);
  setAiDetectResult(null);
  setAiDetectError("");
  }}
  />
  <textarea
  value={aiDetectText}
  onChange={(e) => { setAiDetectText(e.target.value); setAiDetectResult(null); }}
  rows={4}
  placeholder="Or paste text here directly..."
  className="w-full text-xs text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-3 focus:outline-none focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] resize-none font-mono leading-relaxed"
  />
  {aiDetectFileName && (
  <span className="text-[10px] font-medium text-[#00d4dc] bg-[rgba(0,212,220,0.1)] px-2 py-0.5 rounded-[4px] border border-[rgba(0,212,220,0.25)] w-fit">
  ✓ {aiDetectFileName}
  </span>
  )}

  {aiDetectError && (
  <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-[6px] text-xs flex items-center gap-2">
  <AlertTriangle className="w-4 h-4 shrink-0" />
  <span>{aiDetectError}</span>
  </div>
  )}

  <button
  onClick={handleAiDetect}
  disabled={isDetecting || !aiDetectText.trim()}
  className="w-full flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs uppercase tracking-widest py-3.5 rounded-[5px] active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
  >
  {isDetecting ? (
  <>
  <RefreshCw className="w-4 h-4 animate-spin" />
  <span>Detecting...</span>
  </>
  ) : (
  <>
  <CheckCircle className="w-4 h-4" />
  <span>Check AI Rate</span>
  </>
  )}
  </button>
  </div>

  {/* Right: result display */}
  <div className="flex flex-col items-center justify-center bg-[#1c2128] rounded-[8px] border border-[rgba(255,255,255,0.07)] p-5 min-h-[200px]">
  {!aiDetectResult && !isDetecting && (
  <div className="flex flex-col items-center gap-3 text-center">
  <div className="w-16 h-16 rounded-full border-4 border-dashed border-[rgba(255,255,255,0.07)] flex items-center justify-center">
  <CheckCircle2 className="w-7 h-7 text-[#6b7685]" />
  </div>
  <p className="text-xs text-[#6b7685] font-sans max-w-[180px] leading-relaxed">
  Upload or paste text and click <b className="text-[#9aa3b0]">Check AI Rate</b> to scan.
  </p>
  </div>
  )}

  {isDetecting && (
  <div className="flex flex-col items-center gap-3">
  <div className="w-16 h-16 rounded-full border-4 border-[rgba(0,212,220,0.25)] border-t-[#00d4dc] animate-spin" />
  <p className="text-xs text-[#6b7685]">Analyzing content patterns...</p>
  </div>
  )}

  {aiDetectResult && !isDetecting && (() => {
  const pct = aiDetectResult.aiProbability;
  const isHigh = pct >= 70;
  const isMid = pct >= 40 && pct < 70;
  const color = isHigh ? "text-red-500" : isMid ? "text-amber-500" : "text-emerald-500";
  const bgColor = isHigh ? "bg-red-500" : isMid ? "bg-amber-500" : "bg-emerald-500";
  const borderColor = isHigh ? "border-red-200" : isMid ? "border-[rgba(251,191,36,0.3)]" : "border-[rgba(16,185,129,0.3)]";
  const label = isHigh ? "Likely AI-Generated" : isMid ? "Possibly AI-Assisted" : "Likely Human-Written";
  return (
  <div className="w-full flex flex-col items-center gap-4">
  {/* Circular gauge */}
  <div className={`relative w-28 h-28 rounded-full border-4 ${borderColor} flex items-center justify-center bg-[#161a1e]`}>
  <div className="flex flex-col items-center">
  <span className={`text-3xl font-extrabold font-mono tracking-tight ${color}`}>{pct}%</span>
  <span className="text-[9px] font-bold text-[#6b7685] uppercase tracking-wider mt-0.5">AI Rate</span>
  </div>
  </div>
  {/* Progress bar */}
  <div className="w-full bg-[#1c2128] h-2 rounded-full overflow-hidden">
  <div
  className={`h-full rounded-full transition-all duration-700 ${bgColor}`}
  style={{ width: `${pct}%` }}
  />
  </div>
  {/* Label */}
  <div className={`text-xs font-bold uppercase tracking-wider ${color}`}>{label}</div>
  {/* Engine badge */}
  <span className="text-[10px] text-[#6b7685] font-mono bg-[#1c2128] border border-[rgba(255,255,255,0.07)] px-2 py-0.5 rounded-[4px]">
  Engine: {aiDetectResult.engine}
  </span>
  </div>
  );
  })()}
  </div>
  </div>
  </div>

  <StackingContainer cardBaseTop={72} cardTopStep={24}>
  
  {/* Card #1: Job Description */}
  <StackingCard
  id="jd"
  tag="Setup 1"
  title="Job Description"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="flex flex-col gap-2">
  <label htmlFor="resume_jd_editor" className="text-[10px] md:text-xs font-semibold text-[#6b7685] uppercase tracking-wider">
  Copy and Paste Requirements / Job Description
  </label>
  <textarea
  id="resume_jd_editor"
  value={resumeJd}
  onChange={(e) => setResumeJd(e.target.value)}
  rows={6}
  placeholder="Candidate target role details..."
  className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 md:p-5 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
  />
  <div className="flex justify-between items-center text-[10px] text-[#6b7685] font-mono mt-1">
  <span>WORD COUNT: {resumeJd.trim().split(/\s+/).filter(Boolean).length}</span>
  <span>MAX PREVIEW CAP: 4000 CHARS</span>
  </div>
  </div>
  </StackingCard>

  {/* Card #2: Upload Resume */}
  <StackingCard
  id="uploads"
  tag="Setup 2"
  title="Document Upload & Extraction"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div className="flex flex-col gap-4">
  <FileUploader
  id="upload_resume_file"
  label="Candidate Resume Document"
  placeholderText="Drop candidate resume or select"
  onTextLoaded={(text, filename) => {
  setResumeText(text);
  setResumeFileName(filename);
  }}
  />
  <FileUploader
  id="upload_custom_prompt"
  label="Override Base Prompt (Optional)"
  placeholderText="Drop custom analyst prompt file"
  onTextLoaded={(text, filename) => {
  setCustomResumePrompt(text);
  setCustomPromptFileName(filename);
  }}
  />
  </div>
  
  <div className="flex flex-col gap-2 bg-[#1c2128] p-4 rounded-[8px] border border-[rgba(255,255,255,0.07)] ">
  <span className="text-[9px] font-bold text-[#6b7685] tracking-wider uppercase">
  Extracted Text Stream Preview
  </span>
  <textarea
  value={resumeText}
  onChange={(e) => setResumeText(e.target.value)}
  rows={6}
  placeholder="Upload file to view stream, or type raw candidate context directly here..."
  className="w-full text-xs text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[6px] p-3 focus:outline-none focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none resize-none flex-1 font-mono leading-relaxed"
  />
  {resumeFileName && (
  <span className="text-[10px] font-medium text-[#00d4dc] bg-[rgba(0,212,220,0.1)] px-2 py-0.5 rounded-[4px] border border-[rgba(0,212,220,0.25)] w-fit">
  ✓ Raw Data Source: {resumeFileName}
  </span>
  )}
  </div>
  </div>
  </StackingCard>

  {/* Card #3: Prompt Notes & Generate Audit */}
  <StackingCard
  id="notes"
  tag="Setup 3"
  title="Prompt Orchestration Notes"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="flex flex-col gap-4">
  <div className="flex flex-col gap-2">
  <label className="text-[10px] md:text-xs font-semibold text-[#6b7685] uppercase tracking-wider">
  Special context context (e.g. "Highlight leadership credentials", "Emphasize consulting gaps")
  </label>
  <textarea
  value={promptNotes}
  onChange={(e) => setPromptNotes(e.target.value)}
  rows={3}
  placeholder="Add personalized context instructions..."
  className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
  />
  </div>

  <div className="flex flex-col gap-3 pt-2">
  {resumeError && (
  <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-[6px] text-xs flex items-center gap-2">
  <AlertTriangle className="w-4 h-4 shrink-0" />
  <span>{resumeError}</span>
  </div>
  )}

  <button
  onClick={handleAnalyzeResume}
  disabled={isAnalyzingResume}
  className="w-full relative flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs md:text-sm uppercase tracking-widest py-4 rounded-[5px] active:scale-98 transition-all disabled:opacity-55 disabled:pointer-events-none"
  >
  {isAnalyzingResume ? (
  <>
  <RefreshCw className="w-4 h-4 animate-spin" />
  <span>AI Coach is processing models... Please Wait</span>
  </>
  ) : (
  <>
  <Sparkles className="w-4 h-4 text-[#0a0c0d] animate-pulse" />
  <span>Generate Dynamic Resume Audit</span>
  </>
  )}
  </button>
  </div>
  </div>
  </StackingCard>

  </StackingContainer>

  {/* Resume Report Sections Tabs - 90% Jelly Frosted glass */}
  {resumeReport && (
  <section id="results-panel" className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-6 md:p-8  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col gap-6 scroll-mt-24 text-[#eef0f3]">
  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.07)] pb-4">
  <div>
  <h2 className="text-xl md:text-2xl font-semibold font-display text-[#eef0f3] tracking-tight">
  Generated Dynamic Resume Report
  </h2>
  <p className="text-xs text-[#6b7685] mt-1">
  Report outputs parsed into optimized tabs. Model used: <span className="font-mono text-[11px] font-bold text-[#00d4dc] bg-[rgba(0,212,220,0.08)] px-2 py-0.5 rounded border border-[rgba(0,212,220,0.2)]">{resumeReport.modelUsed}</span>
  </p>
  </div>
  <button
  onClick={() => handleDownload("resume-review-report.txt", resumeReport.body)}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
  >
  <Download className="w-3.5 h-3.5" />
  Download Standard Report
  </button>
  </div>

  <div className="flex flex-wrap gap-1 border-b border-[rgba(255,255,255,0.07)] pb-2">
  {resumeReport.tabSections.map((section) => (
  <button
  key={section.tabName}
  onClick={() => setActiveResumeReportTab(section.tabName)}
  className={`text-[9px] md:text-[11px] font-semibold tracking-wider uppercase px-3 py-1.5 rounded-[5px] border transition-all ${
  activeResumeReportTab === section.tabName
  ? "bg-[#00d4dc] text-[#0a0c0d] border-[#00d4dc] "
  : "bg-[#1c2128] text-[#9aa3b0] border-[rgba(255,255,255,0.07)] hover:bg-[#1c2128] hover:text-[#eef0f3]"
  }`}
  >
  {section.tabName}
  </button>
  ))}
  </div>

  <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)] min-h-[250px] transition-all">
  {/* Select corresponding tab content */}
  {(() => {
  const activeSec = resumeReport.tabSections.find(s => s.tabName === activeResumeReportTab);
  if (!activeSec) return null;
  
  if (activeResumeReportTab === "JD Review") {
  return renderHiglightedMMR(activeSec.content);
  }

  return (
  <div className="whitespace-pre-wrap text-sm text-[#9aa3b0] leading-relaxed font-sans">
  {activeSec.content}
  </div>
  );
  })()}
  </div>
  </section>
  )}
  </div>
  )}

  {/* ─── TAB 2: INTERVIEW PREP & SCORING MODULE ─── */}
  {activeTab === "interview" && (
  <div className="flex flex-col gap-6">
  <StackingContainer cardBaseTop={72} cardTopStep={24}>
  
  {/* Card #1: JD */}
  <StackingCard
  id="jd"
  tag="Setup 1"
  title="Job Description"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="flex flex-col gap-2">
  <label htmlFor="interview_jd_editor" className="text-[10px] md:text-xs font-semibold text-[#6b7685] tracking-wider uppercase">
  Configure Target Role Job description (Default synced from audit)
  </label>
  <textarea
  id="interview_jd_editor"
  value={interviewJd}
  onChange={(e) => setInterviewJd(e.target.value)}
  rows={4}
  placeholder="Paste role description requirements..."
  className="w-full text-xs md:text-sm text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-4 focus:ring-2 focus:ring-[rgba(0,212,220,0.3)] focus:border-[#00d4dc] outline-none  transition-all"
  />
  </div>
  </StackingCard>

  {/* Card #2: Upload & Questions Generation */}
  <StackingCard
  id="uploads"
  tag="Setup 2"
  title="Profile Extractor & Simulation Setup"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div className="flex flex-col gap-4">
  <FileUploader
  id="interview_upload_resume"
  label="Candidate Resume context"
  placeholderText="Drop candidate resume or select"
  onTextLoaded={(text, filename) => {
  setInterviewResumeText(text);
  setInterviewResumeFileName(filename);
  }}
  />
  <FileUploader
  id="interview_upload_custom_prompt"
  label="Override Coach Question Prompt (Optional)"
  placeholderText="Override interview prompt"
  onTextLoaded={(text, filename) => {
  setCustomInterviewPrompt(text);
  setInterviewPromptFileName(filename);
  }}
  />
  </div>

  <div className="flex flex-col gap-3 justify-center">
  <p className="text-xs text-[#9aa3b0] leading-relaxed md:px-2 font-sans">
  The Coach uses advanced reasoning to formulate tailored questions highlighting mismatch, STAR behavior targets, and architectural problem scenarios.
  </p>

  <button
  onClick={handleGenerateQuestions}
  disabled={isGeneratingQuestions}
  className="w-full inline-flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs md:text-sm uppercase tracking-widest py-3.5 px-4 rounded-[5px] active:scale-95 transition-all disabled:opacity-50"
  >
  {isGeneratingQuestions ? (
  <>
  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
  <span>Generating Simulator...</span>
  </>
  ) : (
  <>
  <Play className="w-3.5 h-3.5 text-[#0a0c0d] fill-[#0a0c0d]" />
  <span>Generate Tailored Questions</span>
  </>
  )}
  </button>
  </div>
  </div>

  {questionsReport && (
  <div className="mt-4 border-t border-[rgba(255,255,255,0.07)] pt-4 flex flex-col gap-2">
  <div className="flex items-center justify-between">
  <span className="text-[10px] font-bold text-[#6b7685] tracking-wider uppercase">Generated Simulator Context</span>
  <button
  onClick={() => handleDownload("mock-interview-tasks.txt", questionsReport)}
  className="text-[10px] font-semibold text-[#00d4dc] hover:underline flex items-center gap-1"
  >
  <Download className="w-3 h-3" /> Download Simulator Questions
  </button>
  </div>
  <div className="max-h-48 overflow-y-auto p-4 bg-[#1c2128] rounded-[6px] border border-[rgba(255,255,255,0.07)] font-mono text-[11px] text-[#9aa3b0] whitespace-pre-wrap leading-relaxed">
  {questionsReport}
  </div>
  </div>
  )}
  </StackingCard>

  {/* Card #3: Dynamic Assessment Grading Box */}
  <StackingCard
  id="scoring"
  tag="Setup 3"
  title="STAR Core Behavioral Rating Ledger"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <InterviewScoringTable
  scoreRows={scoreRows}
  onChange={(rows) => setScoreRows(rows)}
  />
  </StackingCard>

  {/* Card #4: Computed Performance Metrics summary */}
  <StackingCard
  id="metric"
  tag="Setup 4"
  title="Consolidated Aggregate Metrics Preview"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
  
  {/* Mean Score metric widget */}
  <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
  Aggregate Candidate Rating Average
  </span>
  <div className="flex items-baseline gap-1 mt-2">
  <span className="text-4xl font-extrabold font-mono text-[#eef0f3] tracking-tight">
  {currentMetrics.averageScore.toFixed(2)}
  </span>
  <span className="text-[#6b7685] text-xs font-mono">/ 1.00</span>
  </div>
  <div className="w-full bg-[#1c2128] h-2 rounded-full overflow-hidden mt-2">
  <div 
  className={`h-full transition-all duration-500 rounded-full ${
  currentMetrics.averageScore >= 0.75 
  ? "bg-green-500" 
  : currentMetrics.averageScore < 0.5 
  ? "bg-red-500" 
  : "bg-amber-500"
  }`}
  style={{ width: `${currentMetrics.averageScore * 100}%` }}
  />
  </div>
  </div>

  {/* High performance widget */}
  <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
  Outstanding Skill Marks (≥ 0.75)
  </span>
  <span className="text-4xl font-extrabold font-mono text-green-600 mt-2">
  {currentMetrics.strongCount}
  </span>
  <p className="text-[11px] text-[#6b7685] mt-1 font-sans">
  Scores meeting or exceeding competitive target baseline metrics.
  </p>
  </div>

  {/* Areas of concern widget */}
  <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] p-5 rounded-[8px] flex flex-col items-center justify-center gap-2 ">
  <span className="text-[10px] font-bold text-[#6b7685] uppercase tracking-wider">
  Priority Concerns Detected (&lt; 0.5)
  </span>
  <span className={`text-4xl font-extrabold font-mono mt-2 ${currentMetrics.weakCount > 0 ? "text-red-500 animate-pulse" : "text-[#eef0f3]"}`}>
  {currentMetrics.weakCount}
  </span>
  <p className="text-[11px] text-[#6b7685] mt-1 font-sans">
  Critical skills displaying material developmental deficiencies.
  </p>
  </div>

  </div>
  </StackingCard>

  {/* Card #5: Generate Diagnostic Evaluation Narrative Report */}
  <StackingCard
  id="report"
  tag="Setup 5"
  title="Executive Diagnostic Narrative Report"
  colorTheme={{ text: "#00d4dc", bg: "rgba(0,212,220,0.08)", border: "rgba(0,212,220,0.2)" }}
  >
  <div className="flex flex-col gap-4">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <FileUploader
  id="eval_custom_prompt"
  label="Upload Custom Diagnostic Prompt (Optional)"
  placeholderText="Drop customized assessor prompt"
  onTextLoaded={(text, filename) => {
  setCustomEvalPrompt(text);
  setEvalPromptFileName(filename);
  }}
  />
  
  <div className="flex flex-col gap-1.5 justify-center">
  <p className="text-xs text-[#9aa3b0] leading-relaxed font-sans">
  Assess current grading values, metrics, and generated interview context to draft a tailored diagnostic assessment outlining recommendations and onboarding guidelines.
  </p>
  </div>
  </div>

  <div className="flex flex-col gap-3 pt-2">
  {interviewError && (
  <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/15 rounded-[6px] text-xs flex items-center gap-2 font-medium">
  <AlertTriangle className="w-4 h-4 shrink-0" />
  <span>{interviewError}</span>
  </div>
  )}

  <button
  onClick={handleEvaluateInterview}
  disabled={isEvaluatingInterview}
  className="w-full relative flex items-center justify-center gap-2 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs py-4 uppercase tracking-widest rounded-[5px] active:scale-98 transition-all disabled:opacity-50"
  >
  {isEvaluatingInterview ? (
  <>
  <RefreshCw className="w-4 h-4 animate-spin" />
  <span>AI Coach is compiling analytics...</span>
  </>
  ) : (
  <>
  <Sparkles className="w-4 h-4 text-[#0a0c0d]" />
  <span>Compile Executive Assessment Report</span>
  </>
  )}
  </button>
  </div>
  </div>
  </StackingCard>

  </StackingContainer>

  {/* Generated Assessor Report Section - 90% Jelly Frosted Glass */}
  {evaluationReportText && (
  <section id="results-assessor-panel" className="bg-[#161a1e] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-6 md:p-8  transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex flex-col gap-5 scroll-mt-24 text-[#eef0f3]">
  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(255,255,255,0.07)] pb-4">
  <div>
  <h2 className="text-xl md:text-2xl font-semibold font-display text-[#eef0f3] tracking-tight">
  Executive Candidate Assessment Narrative
  </h2>
  <p className="text-xs text-[#6b7685] mt-1">
  Computed against STAR averages and Core competencies checklist.
  </p>
  </div>
  <button
  onClick={() => handleDownload("candidate-assessment-report.txt", evaluationReportText)}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] text-xs font-semibold transition-all active:scale-95"
  >
  <Download className="w-3.5 h-3.5" />
  Download Assessor Report
  </button>
  </div>

  <div className="bg-[#1c2128] rounded-[8px] p-5 md:p-6 border border-[rgba(255,255,255,0.07)] whitespace-pre-wrap text-sm text-[#9aa3b0] leading-relaxed font-sans">
  {evaluationReportText}
  </div>
  </section>
  )}
  </div>
  )}

  {/* ─── TAB 3: ADMIN/MANAGE MODULE ─── */}
  {activeTab === "manage" && (
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
  )}

  </main>

  <footer className="w-full text-center py-8 border-t border-[rgba(255,255,255,0.07)] text-[10px] tracking-widest text-[#6b7685] uppercase mt-auto">
  © 2026 CAREER COPILOT • PROFESSIONAL REQUISITE MATCHING & EVALUATION
  </footer>
  </div>
  );
}
