import React, { useEffect, useRef, useState } from "react";
import { Upload, FileText, AlertCircle, X, RefreshCw } from "lucide-react";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** A document the parent already holds, restored from a previous session. */
export interface ExistingDocument {
  name: string;
  chars: number;
}

interface FileUploaderProps {
  id: string;
  label: string;
  acceptTypes?: string;
  onTextLoaded: (text: string, filename: string) => void;
  placeholderText?: string;
  /**
   * Shown in place of the empty drop prompt when the session was restored from
   * storage. Without it the box invited you to add a resume you had already
   * added, directly above a line confirming it was loaded.
   */
  existing?: ExistingDocument | null;
}

/**
 * Drag-and-drop uploader that extracts REAL text.
 *
 * Text formats are read in the browser; PDF and DOCX are sent to
 * /api/resume/extract, which runs the actual parsers. Anything that cannot be
 * read reports an error — this component never substitutes placeholder text,
 * because a fabricated resume would silently invalidate every downstream score.
 */
export const FileUploader: React.FC<FileUploaderProps> = ({
  id,
  label,
  acceptTypes = ".txt,.csv,.md,.pdf,.docx",
  onTextLoaded,
  placeholderText = "Drag & drop files or click to upload",
  existing = null,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    /** Absent for a restored document: only its text was kept, not the file. */
    size?: string;
    chars?: number;
  } | null>(existing ? { name: existing.name, chars: existing.chars } : null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the parent when it drops the document out from under us — "Clear
  // stored data" empties the context, and this box has to empty with it.
  useEffect(() => {
    if (!existing && !isExtracting) {
      setSelectedFile(null);
      setErrorMsg(null);
      if (inputRef.current) inputRef.current.value = "";
    }
    // Only react to the document going away, not to every keystroke of it
    // arriving — handleFile already owns the populated case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing === null]);

  const getFileSizeString = (size: number): string => {
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1048576).toFixed(1)} MB`;
  };

  const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the "data:<mime>;base64," prefix.
        resolve(result.slice(result.indexOf(",") + 1));
      };
      reader.onerror = () => reject(new Error("Failed to read the file from disk."));
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    setErrorMsg(null);

    const suffix = file.name.split(".").pop()?.toLowerCase();
    if (!suffix) {
      setErrorMsg("That file has no extension, so its format can't be determined.");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMsg(`That file is ${getFileSizeString(file.size)} — the limit is 5MB.`);
      return;
    }

    setSelectedFile({ name: file.name, size: getFileSizeString(file.size) });
    setIsExtracting(true);

    try {
      const dataBase64 = await readAsBase64(file);
      const response = await fetch("/api/resume/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, dataBase64 }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read that file.");

      setSelectedFile({ name: file.name, size: getFileSizeString(file.size), chars: data.chars });
      onTextLoaded(data.text, file.name);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not read that file.");
      setSelectedFile(null);
      onTextLoaded("", "");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      void handleFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    if (!isExtracting) inputRef.current?.click();
  };

  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setErrorMsg(null);
    onTextLoaded("", "");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label htmlFor={id} className="text-[15px] font-medium text-ink-soft">
          {label}
        </label>
      )}

      <div
        id={id}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onButtonClick();
          }
        }}
        className={`relative flex flex-col items-center justify-center rounded-control px-6 py-10 transition-colors cursor-pointer text-center select-none border ${
          dragActive
            ? "border-accent border-solid bg-accent/10"
            : "border-dashed border-rule-strong bg-sunken/60 hover:border-accent hover:bg-accent/5"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptTypes}
          onChange={handleChange}
          className="hidden"
        />

        {!selectedFile ? (
          <div className="flex flex-col items-center gap-2.5">
            <Upload className="w-6 h-6 text-ink-muted" />
            <p className="text-base text-ink">{placeholderText}</p>
            <p className="text-sm text-ink-muted">PDF, DOCX, TXT, MD or CSV, up to 5MB</p>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full gap-3 text-left">
            <div className="flex items-center gap-3 overflow-hidden">
              {isExtracting ? (
                <RefreshCw className="w-5 h-5 shrink-0 text-accent animate-spin" />
              ) : (
                <FileText className="w-5 h-5 shrink-0 text-accent" />
              )}
              <div className="overflow-hidden">
                <p className="text-base font-medium text-ink truncate">{selectedFile.name}</p>
                <p className="text-sm text-ink-soft tnum">
                  {isExtracting
                    ? "Reading the text…"
                    : [
                        selectedFile.size,
                        selectedFile.chars
                          ? `${selectedFile.chars.toLocaleString()} characters read`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                </p>
              </div>
            </div>
            <button
              onClick={clearFile}
              className="p-1.5 text-ink-muted hover:text-mark rounded-[3px] transition-colors shrink-0"
              title="Remove this file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <p className="flex items-start gap-2 text-[15px] text-mark border-l-2 border-mark pl-3 py-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </p>
      )}
    </div>
  );
};
