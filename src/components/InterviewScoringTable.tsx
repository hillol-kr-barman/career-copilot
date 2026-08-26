import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { ScoreRow, MetricRow } from "../types";

interface InterviewScoringTableProps {
  scoreRows: ScoreRow[];
  onChange: (rows: ScoreRow[]) => void;
}

export const InterviewScoringTable: React.FC<InterviewScoringTableProps> = ({
  scoreRows,
  onChange,
}) => {
  const addRow = () => {
  const newRow: ScoreRow = {
  questionDescription: `Tailored Interview Question #${scoreRows.length + 1}`,
  s: 0.5,
  tE: 0.5,
  a: 0.5,
  rT: 0.5,
  starRating: 0.5,
  cS: 0.5,
  aE: 0.5,
  rA: 0.5,
  competencyRating: 0.5,
  };
  onChange([...scoreRows, newRow]);
  };

  const removeRow = (index: number) => {
  if (scoreRows.length <= 1) return;
  const nextRows = scoreRows.filter((_, idx) => idx !== index);
  onChange(nextRows);
  };

  const handleFieldChange = (index: number, field: keyof ScoreRow, val: any) => {
  const nextRows = [...scoreRows];
  const targetRow = { ...nextRows[index] };

  // Update field value
  if (field === "questionDescription") {
  targetRow[field] = val;
  } else {
  const numVal = Math.min(1.0, Math.max(0.0, parseFloat(val) || 0));
  (targetRow as any)[field] = numVal;
  }

  // Recompute averages
  targetRow.starRating = Number(
  ((targetRow.s + targetRow.tE + targetRow.a + targetRow.rT) / 4).toFixed(2)
  );
  targetRow.competencyRating = Number(
  ((targetRow.cS + targetRow.aE + targetRow.rA) / 3).toFixed(2)
  );

  nextRows[index] = targetRow;
  onChange(nextRows);
  };

  return (
  <div className="w-full flex flex-col gap-5 pt-1">
  <div className="flex flex-wrap items-center justify-between gap-4">
  <p className="text-xs text-[#6b7685]">
  Slide inputs or enter values (0.0 to 1.0) to dynamically record performance ratings.
  </p>
  <button
  onClick={addRow}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.07)] text-xs font-semibold text-[#9aa3b0] bg-[#161a1e] hover:bg-[#1c2128] active:scale-95 transition-all"
  >
  <Plus className="w-3.5 h-3.5 text-[#6b7685]" />
  Add Assessment Row
  </button>
  </div>

  <div className="overflow-x-auto border border-[rgba(255,255,255,0.07)] rounded-[8px] bg-[#161a1e]">
  <table className="min-w-full divide-y divide-[rgba(255,255,255,0.07)] text-left border-collapse">
  <thead className="bg-[#1c2128] text-[10px] md:text-xs font-semibold uppercase text-[#6b7685] tracking-wider">
  <tr>
  <th scope="col" className="px-4 py-3 min-w-[200px] border-b border-[rgba(255,255,255,0.07)]">Question Description</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">S</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">T/E</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">A</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">R/T</th>
  <th scope="col" className="px-3 py-3 text-center bg-[#1c2128] font-bold text-[#9aa3b0] border-x border-[rgba(255,255,255,0.07)]">STAR Avg</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">C/S</th>
  <th scope="col" className="px-2 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">A/E</th>
  <th scope="col" className="px-2 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">R/A</th>
  <th scope="col" className="px-3 py-3 text-center bg-[#1c2128] font-bold text-[#9aa3b0] border-x border-[rgba(255,255,255,0.07)]">Comp Avg</th>
  <th scope="col" className="px-3 py-3 text-center border-b border-[rgba(255,255,255,0.07)]">Action</th>
  </tr>
  </thead>
  <tbody className="divide-y divide-[rgba(255,255,255,0.07)] bg-[#161a1e] text-xs">
  {scoreRows.map((row, idx) => (
  <tr key={idx} className="hover:bg-[#1c2128] transition-colors">
  {/* Description Input */}
  <td className="px-4 py-3">
  <textarea
  rows={2}
  value={row.questionDescription}
  onChange={(e) => handleFieldChange(idx, "questionDescription", e.target.value)}
  className="w-full text-xs text-[#eef0f3] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[5px] p-2 focus:ring-2 focus:ring-[rgba(0,212,220,0.2)] focus:border-[#00d4dc] outline-none resize-none "
  placeholder="Enter interview target..."
  />
  </td>

  {/* S Value Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.s}
  onChange={(e) => handleFieldChange(idx, "s", e.target.value)}
  className="w-12 h-1 accent-[#00d4dc] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.s.toFixed(1)}</span>
  </div>
  </td>

  {/* T/E Value Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.tE}
  onChange={(e) => handleFieldChange(idx, "tE", e.target.value)}
  className="w-12 h-1 accent-[#00d4dc] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.tE.toFixed(1)}</span>
  </div>
  </td>

  {/* A Value Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.a}
  onChange={(e) => handleFieldChange(idx, "a", e.target.value)}
  className="w-12 h-1 accent-[#00d4dc] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.a.toFixed(1)}</span>
  </div>
  </td>

  {/* R/T Value Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.rT}
  onChange={(e) => handleFieldChange(idx, "rT", e.target.value)}
  className="w-12 h-1 accent-[#00d4dc] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.rT.toFixed(1)}</span>
  </div>
  </td>

  {/* STAR Rating Indicator */}
  <td className="px-3 py-3 text-center bg-[#1c2128]/30 border-x border-[rgba(255,255,255,0.07)] font-semibold font-mono">
  <span
  className={`inline-block px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ${
  row.starRating >= 0.75
  ? "bg-green-500/10 text-green-600 border border-green-500/20"
  : row.starRating < 0.5
  ? "bg-red-500/10 text-red-600 border border-red-500/20"
  : "bg-amber-500/10 text-[#fbbf24] border border-amber-500/20"
  }`}
  >
  {row.starRating.toFixed(2)}
  </span>
  </td>

  {/* C/S Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.cS}
  onChange={(e) => handleFieldChange(idx, "cS", e.target.value)}
  className="w-12 h-1 accent-[#6b7685] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.cS.toFixed(1)}</span>
  </div>
  </td>

  {/* A/E Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.aE}
  onChange={(e) => handleFieldChange(idx, "aE", e.target.value)}
  className="w-12 h-1 accent-[#6b7685] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.aE.toFixed(1)}</span>
  </div>
  </td>

  {/* R/A Slider */}
  <td className="px-2 py-3 text-center">
  <div className="flex flex-col items-center gap-1">
  <input
  type="range"
  min="0"
  max="1"
  step="0.1"
  value={row.rA}
  onChange={(e) => handleFieldChange(idx, "rA", e.target.value)}
  className="w-12 h-1 accent-[#6b7685] cursor-pointer"
  />
  <span className="font-mono text-[10px] text-[#6b7685] font-medium">{row.rA.toFixed(1)}</span>
  </div>
  </td>

  {/* Competency Rating Indicator */}
  <td className="px-3 py-3 text-center bg-[#1c2128]/30 border-x border-[rgba(255,255,255,0.07)] font-semibold font-mono">
  <span
  className={`inline-block px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ${
  row.competencyRating >= 0.75
  ? "bg-green-500/10 text-green-600 border border-green-500/20"
  : row.competencyRating < 0.5
  ? "bg-red-500/10 text-red-600 border border-red-500/20"
  : "bg-amber-500/10 text-[#fbbf24] border border-amber-500/20"
  }`}
  >
  {row.competencyRating.toFixed(2)}
  </span>
  </td>

  {/* Delete Column */}
  <td className="px-3 py-3 text-center">
  <button
  disabled={scoreRows.length <= 1}
  onClick={() => removeRow(idx)}
  className="p-1 text-[#6b7685] hover:text-red-500 hover:bg-[#1c2128] rounded-[5px] transition-all disabled:opacity-30 disabled:pointer-events-none"
  title="Remove question assessor metrics"
  >
  <Trash2 className="w-4 h-4" />
  </button>
  </td>
  </tr>
  ))}
  </tbody>
  </table>
  </div>
  </div>
  );
};
