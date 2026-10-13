"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Upload, X } from "lucide-react";
import { ThemeToggle } from "@/components/trade/ThemeToggle";
import { SYMBOLS, type Symbol } from "@/components/trade/constants";
import {
  cancelImportJob,
  finishImportJob,
  getCoverage,
  startImportJob,
  uploadImportChunk,
  type Coverage,
} from "@/components/trade/services/session-api";
import { IconButton } from "@/components/trade/dashboard/IconButton";
import { LogoMark } from "@/components/trade/LogoMark";
import { fmtBars, fmtDay } from "@/components/trade/dashboard/format";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Candlestick data management: coverage browser + CSV bulk imports. */
export default function DataPage() {
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [importSymbol, setImportSymbol] = useState<Symbol>("EURUSD");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; m1Bars: number } | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    let on = true;
    getCoverage()
      .then((data) => {
        if (on) {
          setCoverage(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (on) {
          setCoverage([]);
          setLoading(false);
        }
      });
    return () => {
      on = false;
    };
  }, [refreshNonce]);

  const onPickFiles = (list: FileList | null) => {
    const files = Array.from(list ?? [])
      .filter((f) => /\.csv$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    setImportFiles(files);
    setImportMsg(files.length === 0 ? "No CSV files selected." : null);
  };

  const onCancel = () => {
    cancelRef.current = true;
  };

  const onImport = async () => {
    setImportMsg(null);
    if (importFiles.length === 0) return setImportMsg("Choose one or more HistData.com M1 CSV files first.");
    const files = [...importFiles];
    setImporting(true);
    setProgress({ done: 0, total: files.length, m1Bars: 0 });
    cancelRef.current = false;
    let jobId: string | null = null;
    try {
      const started = await startImportJob(importSymbol, files.map((f) => f.name));
      jobId = started.jobId;
      for (let i = 0; i < files.length; i++) {
        if (cancelRef.current) {
          await cancelImportJob(jobId).catch(() => {});
          setImportMsg(`Import cancelled after ${i} of ${files.length} files. Already-imported bars are kept; re-run to resume.`);
          return;
        }
        const p = await uploadImportChunk(jobId, i, files[i]!);
        setProgress({ done: p.done, total: p.total, m1Bars: p.m1Bars });
      }
      const res = await finishImportJob(jobId);
      jobId = null;
      setImportMsg(
        `Imported ${fmtBars(res.m1Bars)} M1 bars for ${res.symbol} across ${res.files} files (${fmtDay(res.from)} → ${fmtDay(res.to)}, ${res.skipped} lines skipped).`,
      );
      setImportFiles([]);
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      if (jobId) await cancelImportJob(jobId).catch(() => {});
      setImportMsg(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const rowsFor = (symbol: string): Coverage[] =>
    coverage.filter((c) => c.symbol === symbol).sort((a, b) => a.interval.localeCompare(b.interval));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <IconButton title="Back to dashboard" href="/">
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <LogoMark size={24} />
        <h1 className="text-xl font-bold tracking-tight">Candlestick data</h1>
        <span className="text-sm text-muted">local history coverage</span>
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </header>

      <section className="rounded-xl border border-border bg-background p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Available data</h2>
        <p className="mb-3 text-xs text-muted">
          Manually imported history per instrument — this is what backtest sessions seal against.
        </p>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div className="grid gap-2">
            {SYMBOLS.map((s) => {
              const rows = rowsFor(s);
              return (
                <div key={s} className="rounded-lg bg-surface px-3 py-2">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-semibold">{s}</span>
                    {rows.length === 0 && <span className="text-muted">no local data yet</span>}
                  </div>
                  {rows.map((r) => (
                    <div key={r.interval} className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="font-mono font-semibold">{r.interval}</span>
                      <span className="font-mono tabular-nums text-muted">{fmtBars(r.bars)} bars</span>
                      <span className="ml-auto font-mono tabular-nums text-muted">
                        {fmtDay(r.from)} → {fmtDay(r.to)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-background p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Update data</h2>
        <p className="mb-3 text-xs text-muted">
          Select one or more HistData.com M1 CSV files (any size, filename-sorted before import).
          Files upload sequentially and resample into all timeframes, exactly like the CLI bulk importer.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted">Symbol</span>
            <select
              value={importSymbol}
              onChange={(e) => setImportSymbol(e.target.value as Symbol)}
              disabled={importing}
              className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            accept=".csv,.txt"
            multiple
            disabled={importing}
            onChange={(e) => onPickFiles(e.target.files)}
            className="max-w-64 text-xs text-muted"
          />
          {!importing ? (
            <IconButton title="Import CSVs" variant="primary" onClick={() => void onImport()} disabled={importFiles.length === 0}>
              <Upload className="h-4 w-4" />
            </IconButton>
          ) : (
            <IconButton title="Cancel import" onClick={onCancel}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
        {importFiles.length > 0 && !importing && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted">
            {importFiles.map((f) => (
              <li key={f.name} className="flex gap-2 font-mono">
                <span>{f.name}</span>
                <span className="tabular-nums">{fmtSize(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        {importing && progress && (
          <div className="mt-2 text-xs text-muted">
            <p className="font-mono tabular-nums">
              File {Math.min(progress.done + 1, progress.total)} of {progress.total} · {fmtBars(progress.m1Bars)} M1 bars so far…
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-surface">
              <div
                className="h-full rounded bg-accent transition-all"
                style={{ width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {importMsg && <p className="mt-2 text-xs text-muted">{importMsg}</p>}
      </section>
    </div>
  );
}
