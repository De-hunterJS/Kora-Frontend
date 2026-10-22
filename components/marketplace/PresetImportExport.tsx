"use client";

import React, { useRef, useState } from "react";
import { useInvoiceStore } from "@/store/invoiceStore";

/**
 * PresetImportExport — portable backup/share controls for saved marketplace
 * filter presets. Export downloads (or copies) a versioned JSON artifact;
 * import strictly validates before merging so bad payloads fail closed.
 */
export default function PresetImportExport() {
  const exportPresetsText = useInvoiceStore((s) => s.exportPresetsText);
  const importPresets = useInvoiceStore((s) => s.importPresets);
  const presetCount = useInvoiceStore((s) => s.savedPresets.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showImport, setShowImport] = useState(false);

  const handleExportFile = () => {
    const blob = new Blob([exportPresetsText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kora-marketplace-presets.json";
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ kind: "ok", text: `Exported ${presetCount} preset(s) to file.` });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportPresetsText());
      setMessage({ kind: "ok", text: `Copied ${presetCount} preset(s) to clipboard.` });
    } catch {
      setMessage({ kind: "err", text: "Clipboard unavailable — use file download instead." });
    }
  };

  const handleImportText = (raw: string) => {
    const result = importPresets(raw);
    if (result.error) {
      setMessage({ kind: "err", text: result.error });
    } else {
      setMessage({
        kind: "ok",
        text: `Imported ${result.imported} preset(s)${result.skipped ? `, skipped ${result.skipped} duplicate(s)` : ""}.`,
      });
      setPaste("");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    handleImportText(await file.text());
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="preset-import-export">
      <button
        type="button"
        onClick={handleExportFile}
        disabled={presetCount === 0}
        className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
        data-testid="preset-export-file"
      >
        Export presets
      </button>
      <button
        type="button"
        onClick={handleCopy}
        disabled={presetCount === 0}
        className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
        data-testid="preset-export-copy"
      >
        Copy JSON
      </button>
      <button
        type="button"
        onClick={() => setShowImport((v) => !v)}
        className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
        data-testid="preset-import-toggle"
      >
        Import presets
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="preset-import-file"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {showImport && (
        <div className="w-full space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              data-testid="preset-import-choose-file"
            >
              Choose file…
            </button>
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder='Paste exported preset JSON, then click "Apply import"'
            rows={3}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-200"
            data-testid="preset-import-paste"
          />
          <button
            type="button"
            onClick={() => handleImportText(paste)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            data-testid="preset-import-apply"
          >
            Apply import
          </button>
        </div>
      )}
      {message && (
        <p
          role={message.kind === "err" ? "alert" : "status"}
          className={message.kind === "err" ? "w-full text-xs text-destructive" : "w-full text-xs text-emerald-400"}
          data-testid="preset-io-message"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
