import { create } from "zustand";
import {
  SYMBOLS,
  TIMEFRAMES,
  type Symbol,
  type Timeframe,
} from "./constants";

interface TerminalState {
  symbol: Symbol;
  timeframe: Timeframe;
  setSymbol: (s: Symbol) => void;
  setTimeframe: (t: Timeframe) => void;
  // ── Bar replay (P5). `cutoff` is the moment replay starts at;
  // `replayTime` is the currently revealed moment. Every timeframe shows
  // bars with time <= replayTime, so all TFs stay synced by construction.
  replayActive: boolean;
  replayCutoff: number | null;
  replayTime: number | null;
  replayPlaying: boolean;
  replaySpeed: number;
  enterReplay: (cutoff: number) => void;
  exitReplay: () => void;
  setReplayTime: (t: number) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: number) => void;
}

function isSymbol(v: string): v is Symbol {
  return (SYMBOLS as readonly string[]).includes(v);
}

function isTimeframe(v: string): v is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(v);
}

export const useTerminal = create<TerminalState>((set) => ({
  symbol: "BTCUSD",
  timeframe: "1h",
  setSymbol: (symbol) => {
    if (isSymbol(symbol)) set({ symbol });
  },
  setTimeframe: (timeframe) => {
    if (isTimeframe(timeframe)) set({ timeframe });
  },
  replayActive: false,
  replayCutoff: null,
  replayTime: null,
  replayPlaying: false,
  replaySpeed: 1,
  enterReplay: (cutoff) =>
    set({ replayActive: true, replayCutoff: cutoff, replayTime: cutoff, replayPlaying: false }),
  exitReplay: () =>
    set({ replayActive: false, replayCutoff: null, replayTime: null, replayPlaying: false }),
  setReplayTime: (t) => set({ replayTime: Math.floor(t) }),
  setReplayPlaying: (playing) => set({ replayPlaying: playing }),
  setReplaySpeed: (speed) => set({ replaySpeed: speed }),
}));
