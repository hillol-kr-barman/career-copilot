import React from "react";
import { Plus, Trash2, Sliders, ChevronDown } from "lucide-react";
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
        <p className="text-xs text-slate-400">
          Slide inputs or enter values (0.0 to 1.0) to dynamically record performance ratings.
        </p>
        <button
          onClick={addRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 active:scale-95 transition-all shadow-xs"
        >
          <Plus className="w-3.5 h-3.5 text-slate-400" />
          Add Assessment Row
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-150 rounded-2xl shadow-sm bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-left border-collapse">
          <thead className="bg-[#F8FAFC] text-[10px] md:text-xs font-semibold uppercase text-slate-400 tracking-wider">
            <tr>
              <th scope="col" className="px-4 py-3 min-w-[200px] border-b border-slate-150">Question Description</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">S</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">T/E</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">A</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">R/T</th>
              <th scope="col" className="px-3 py-3 text-center bg-slate-50/50 font-bold text-slate-700 border-x border-slate-150">STAR Avg</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">C/S</th>
              <th scope="col" className="px-2 py-3 text-center border-b border-slate-150">A/E</th>
              <th scope="col" className="px-2 py-3 text-center border-b border-slate-150">R/A</th>
              <th scope="col" className="px-3 py-3 text-center bg-slate-50/50 font-bold text-slate-700 border-x border-slate-150">Comp Avg</th>
              <th scope="col" className="px-3 py-3 text-center border-b border-slate-150">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white text-xs">
            {scoreRows.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                {/* Description Input */}
                <td className="px-4 py-3">
                  <textarea
                    rows={2}
                    value={row.questionDescription}
                    onChange={(e) => handleFieldChange(idx, "questionDescription", e.target.value)}
                    className="w-full text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none resize-none shadow-xs"
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
                      className="w-12 h-1 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.s.toFixed(1)}</span>
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
                      className="w-12 h-1 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.tE.toFixed(1)}</span>
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
                      className="w-12 h-1 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.a.toFixed(1)}</span>
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
                      className="w-12 h-1 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.rT.toFixed(1)}</span>
                  </div>
                </td>

                {/* STAR Rating Indicator */}
                <td className="px-3 py-3 text-center bg-slate-50/30 border-x border-slate-100 font-semibold font-mono">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      row.starRating >= 0.75
                        ? "bg-green-500/10 text-green-600 border border-green-500/20"
                        : row.starRating < 0.5
                        ? "bg-red-500/10 text-red-600 border border-red-500/20"
                        : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
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
                      className="w-12 h-1 accent-slate-400 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.cS.toFixed(1)}</span>
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
                      className="w-12 h-1 accent-slate-400 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.aE.toFixed(1)}</span>
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
                      className="w-12 h-1 accent-slate-400 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-slate-400 font-medium">{row.rA.toFixed(1)}</span>
                  </div>
                </td>

                {/* Competency Rating Indicator */}
                <td className="px-3 py-3 text-center bg-slate-50/30 border-x border-slate-100 font-semibold font-mono">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      row.competencyRating >= 0.75
                        ? "bg-green-500/10 text-green-600 border border-green-500/20"
                        : row.competencyRating < 0.5
                        ? "bg-red-500/10 text-red-600 border border-red-500/20"
                        : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
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
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-lg transition-all disabled:opacity-30 disabled:pointer-events-none"
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
