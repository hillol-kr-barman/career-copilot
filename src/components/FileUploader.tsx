import React, { useRef, useState } from "react";
import { Upload, FileText, AlertCircle, X, RefreshCw } from "lucide-react";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface FileUploaderProps {
  id: string;
  label: string;
  acceptTypes?: string;
  onTextLoaded: (text: string, filename: string) => void;
  placeholderText?: string;
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
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: string; chars?: number } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <label htmlFor={id} className="text-[10px] md:text-xs font-semibold tracking-wider text-[#6b7685] uppercase">
        {label}
      </label>

      <div
        id={id}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-[8px] p-6 transition-all duration-200 cursor-pointer text-center select-none ${
          dragActive
            ? "border-[#00d4dc] bg-[rgba(0,212,220,0.12)] scale-[1.01]"
            : "border-[rgba(255,255,255,0.07)] bg-[#1c2128] hover:border-[rgba(0,212,220,0.4)] hover:bg-[rgba(0,212,220,0.05)]"
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
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-[#161a1e] border border-[rgba(255,255,255,0.07)] text-[#6b7685]">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-xs md:text-sm font-medium text-[#9aa3b0]">{placeholderText}</p>
            <p className="text-[10px] md:text-xs text-[#6b7685]">
              PDF, DOCX, TXT, MD, CSV · max 5MB
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full p-2 bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[6px]">
            <div className="flex items-center gap-3 text-left overflow-hidden">
              <div className="p-2 bg-[rgba(0,212,220,0.1)] text-[#00d4dc] rounded-[5px] shrink-0">
                {isExtracting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-[#eef0f3] truncate">{selectedFile.name}</p>
                <p className="text-[10px] text-[#9aa3b0]">
                  {isExtracting
                    ? "Extracting text…"
                    : `${selectedFile.size}${
                        selectedFile.chars ? ` • ${selectedFile.chars.toLocaleString()} characters read` : ""
                      }`}
                </p>
              </div>
            </div>
            <button
              onClick={clearFile}
              className="p-1 text-[#6b7685] hover:text-[#9aa3b0] rounded-[4px] hover:bg-[#1c2128] transition-colors shrink-0"
              title="Remove File"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 text-[10px] md:text-xs text-red-500 font-medium bg-red-500/10 p-2 rounded-[5px] border border-red-500/20">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
