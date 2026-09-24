import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { ScoreRow } from "../types";

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
      ((targetRow.s + targetRow.tE + targetRow.a + targetRow.rT) / 4).toFixed(2),
    );
    // check-tag-track.ts's D-73 parity guard compares this expression with its
    // twin as source text, so a formatter that wraps one site and not the other
    // breaks the build. Both are pinned to one line.
    // prettier-ignore
    targetRow.competencyRating = Number(((targetRow.cS + targetRow.aE + targetRow.rA) / 3).toFixed(2));

    nextRows[index] = targetRow;
    onChange(nextRows);
  };

  return (
    <div className="w-full flex flex-col gap-5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[15px] text-ink-muted">
          Slide inputs or enter values (0.0 to 1.0) to dynamically record performance ratings.
        </p>
        <button
          onClick={addRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-rule text-[15px] font-semibold text-ink-soft bg-surface hover:bg-sunken transition-all"
        >
          <Plus className="w-3.5 h-3.5 text-ink-muted" />
          Add Assessment Row
        </button>
      </div>

      <div className="overflow-x-auto border border-rule rounded-control bg-surface">
        <table className="min-w-full divide-y divide-rule text-left border-collapse">
          <thead className="bg-sunken text-xs md:text-[15px] font-semibold text-ink-muted tracking-wider">
            <tr>
              <th scope="col" className="px-4 py-3 min-w-[200px] border-b border-rule">
                Question Description
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                S
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                T/E
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                A
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                R/T
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-center bg-sunken font-bold text-ink-soft border-x border-rule"
              >
                STAR Avg
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                C/S
              </th>
              <th scope="col" className="px-2 py-3 text-center border-b border-rule">
                A/E
              </th>
              <th scope="col" className="px-2 py-3 text-center border-b border-rule">
                R/A
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-center bg-sunken font-bold text-ink-soft border-x border-rule"
              >
                Comp Avg
              </th>
              <th scope="col" className="px-3 py-3 text-center border-b border-rule">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule bg-surface text-[15px]">
            {scoreRows.map((row, idx) => (
              <tr key={idx} className="hover:bg-sunken transition-colors">
                {/* Description Input */}
                <td className="px-4 py-3">
                  <textarea
                    rows={2}
                    value={row.questionDescription}
                    onChange={(e) => handleFieldChange(idx, "questionDescription", e.target.value)}
                    className="w-full text-[15px] text-ink bg-sunken border border-rule rounded-control p-2 focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none resize-none "
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
                      className="w-12 h-1 accent-accent cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.s.toFixed(1)}
                    </span>
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
                      className="w-12 h-1 accent-accent cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.tE.toFixed(1)}
                    </span>
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
                      className="w-12 h-1 accent-accent cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.a.toFixed(1)}
                    </span>
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
                      className="w-12 h-1 accent-accent cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.rT.toFixed(1)}
                    </span>
                  </div>
                </td>

                {/* STAR Rating Indicator */}
                <td className="px-3 py-3 text-center bg-sunken/30 border-x border-rule font-semibold font-mono">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded-[3px] text-xs font-bold ${
                      row.starRating >= 0.75
                        ? "bg-green-500/10 text-green-600 border border-green-500/20"
                        : row.starRating < 0.5
                          ? "bg-mark/10 text-mark border border-mark/20"
                          : "bg-warn/10 text-warn border border-warn/20"
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
                      className="w-12 h-1 accent-ink-muted cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.cS.toFixed(1)}
                    </span>
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
                      className="w-12 h-1 accent-ink-muted cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.aE.toFixed(1)}
                    </span>
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
                      className="w-12 h-1 accent-ink-muted cursor-pointer"
                    />
                    <span className="font-mono text-xs text-ink-muted font-medium">
                      {row.rA.toFixed(1)}
                    </span>
                  </div>
                </td>

                {/* Competency Rating Indicator */}
                <td className="px-3 py-3 text-center bg-sunken/30 border-x border-rule font-semibold font-mono">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded-[3px] text-xs font-bold ${
                      row.competencyRating >= 0.75
                        ? "bg-green-500/10 text-green-600 border border-green-500/20"
                        : row.competencyRating < 0.5
                          ? "bg-mark/10 text-mark border border-mark/20"
                          : "bg-warn/10 text-warn border border-warn/20"
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
                    className="p-1 text-ink-muted hover:text-mark hover:bg-sunken rounded-control transition-all disabled:opacity-30 disabled:pointer-events-none"
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
