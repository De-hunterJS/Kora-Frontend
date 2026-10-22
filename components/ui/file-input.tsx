"use client";

import * as React from "react";
import { type FileRejection, useDropzone } from "react-dropzone";
import { UploadCloud, FileText, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeExternalUrl } from "@/lib/security";
import { MAX_INVOICE_PDF_BYTES } from "@/lib/validations/upload";

export interface FileInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> {
  label?: string;
  error?: string;
  success?: boolean;
  hint?: string;
  value?: File | string | null;
  maxSizeMB?: number;
}

type SelectedFile = File | {
  name: string;
  size: number;
  type: "application/pdf";
  isRemote: true;
  url: string;
};

function isRemoteFile(file: SelectedFile): file is Extract<SelectedFile, { isRemote: true }> {
  return "isRemote" in file;
}

const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  (
    {
      className,
      label,
      error,
      success,
      hint,
      value,
      maxSizeMB = MAX_INVOICE_PDF_BYTES / (1024 * 1024),
      id,
      onChange,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-") || generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(null);
    const [localError, setLocalError] = React.useState("");

    React.useEffect(() => {
      if (value) {
        if (value instanceof File) {
          setSelectedFile(value);
        } else if (typeof value === "string") {
          setSelectedFile({
            name: value.split("/").pop() || "invoice-document.pdf",
            size: 0,
            type: "application/pdf",
            isRemote: true,
            url: value,
          });
        }
      } else {
        setSelectedFile(null);
      }
    }, [value]);

    const onDrop = React.useCallback(
      (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
        if (disabled) return;

        let errorMsg = "";
        if (rejectedFiles.length > 0) {
          const err = rejectedFiles[0].errors[0];
          if (err.code === "file-too-large") {
            errorMsg = `File is too large (max ${maxSizeMB}MB)`;
          } else if (err.code === "file-invalid-type") {
            errorMsg = "Only PDF files are accepted";
          } else {
            errorMsg = err.message || "Invalid file selection";
          }
          setLocalError(errorMsg);
        } else {
          setLocalError("");
        }

        if (acceptedFiles.length > 0) {
          const file = acceptedFiles[0];
          setSelectedFile(file);
          if (onChange) {
            const event = {
              target: {
                name: props.name,
                value: file,
                files: acceptedFiles,
                id: inputId,
              },
            } as unknown as React.ChangeEvent<HTMLInputElement>;
            onChange(event);
          }
        }
      },
      [onChange, props.name, maxSizeMB, disabled, inputId]
    );

    const removeFile = (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedFile(null);
      setLocalError("");
      if (onChange) {
        const event = {
          target: {
            name: props.name,
            value: null,
            files: null,
            id: inputId,
          },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        onChange(event);
      }
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
      onDrop,
      accept: { "application/pdf": [".pdf"] },
      maxFiles: 1,
      maxSize: maxSizeMB * 1024 * 1024,
      disabled,
    });

    const formatBytes = (bytes: number) => {
      if (bytes === 0) return "Unknown size";
      const k = 1024;
      const dm = 2;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    };

    const fileUrl = React.useMemo(() => {
      if (!selectedFile) return "";
      if (isRemoteFile(selectedFile)) return selectedFile.url;
      try {
        return URL.createObjectURL(selectedFile);
      } catch (err) {
        return "";
      }
    }, [selectedFile]);

    const activeError = error || localError;

    const ariaDescribedBy = [
      activeError ? errorId : null,
      hint ? hintId : null,
      props["aria-describedby"],
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}

        <div
          {...getRootProps()}
          className={cn(
            "relative rounded-xl border border-dashed border-input bg-card/45 p-6 text-center cursor-pointer transition-all",
            "hover:border-zinc-700 hover:bg-card/70 focus-within:ring-1 focus-within:ring-ring/50 focus-within:border-ring",
            isDragActive && "border-primary bg-primary/5",
            disabled && "cursor-not-allowed opacity-50 hover:bg-card/45 hover:border-input",
            success && !activeError && "border-emerald-500/50 bg-emerald-500/5",
            activeError && "border-destructive/50 bg-destructive/5",
            className
          )}
        >
          <input
            id={inputId}
            ref={ref}
            name={props.name}
            aria-describedby={ariaDescribedBy || undefined}
            aria-invalid={!!activeError}
            {...getInputProps()}
          />

          {!selectedFile ? (
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="rounded-full bg-zinc-900 border border-zinc-800 p-2.5 text-zinc-400 transition-transform">
                <UploadCloud className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Drag & drop your invoice PDF here, or <span className="text-primary hover:underline">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Only PDF up to {maxSizeMB}MB
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 text-left">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 p-2 text-rose-500 shrink-0">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate max-w-[180px] sm:max-w-[280px]">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedFile.size > 0 ? formatBytes(selectedFile.size) : "Remote PDF"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {fileUrl && (
                  <a
                    href={fileUrl.startsWith("blob:") ? fileUrl : safeExternalUrl(fileUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-800 transition-colors"
                    title="Preview PDF"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={removeFile}
                  disabled={disabled}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Remove file"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {activeError && (
          <p id={errorId} className="text-xs text-destructive">
            {activeError}
          </p>
        )}
        {hint && !activeError && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    );
  }
);
FileInput.displayName = "FileInput";

export { FileInput };
