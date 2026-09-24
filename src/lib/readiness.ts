import { SharedContext } from "../types";

/**
 * Why a tool can't run yet, in one sentence, or null when it can.
 *
 * Shared by the step rail and the tools themselves so the lock shown on a tab
 * always matches the reason given once you open it. It also keeps the wording
 * pointing at the right place: the tools used to say "above", which stopped
 * being true when they moved from one long scroll onto separate steps.
 */
export const toolReadiness = (context: Partial<SharedContext>, apiKey: string) => {
  const hasResume = Boolean(context.resumeText?.trim());
  const hasJobDescription = Boolean(context.jobDescription?.trim());
  const hasKey = Boolean(apiKey.trim());

  const needsAll = (action: string): string | null => {
    if (!hasResume) return `Add your resume in step 1 to ${action}.`;
    if (!hasJobDescription) return `Paste the job description in step 1 to ${action}.`;
    if (!hasKey) return `Connect your AI key at the top of the page to ${action}.`;
    return null;
  };

  return {
    detection: hasResume ? null : "Add your resume in step 1 to run the check.",
    audit: needsAll("run the audit"),
    prep: needsAll("generate interview questions"),
  };
};
