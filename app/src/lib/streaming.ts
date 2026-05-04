import { useEffect, useState } from "react";

// In-memory store of streaming text per step. Lives outside React because
// step.streaming events fire 50+ times per llm.chat call; pushing each
// token through useState on a top-level provider would re-render the
// whole tree at token rate. Components subscribe to a single stepId and
// only that subscriber re-renders when its stream changes.

type Listener = (text: string) => void;

interface Stream {
  text: string;
  // Highest seq number we've applied. Out-of-order deltas (rare with SSE,
  // but the runtime emits a monotonic seq so we can defend) are dropped.
  seq: number;
  listeners: Set<Listener>;
}

const streams = new Map<string, Stream>();

function ensureStream(stepId: string): Stream {
  let s = streams.get(stepId);
  if (!s) {
    s = { text: "", seq: 0, listeners: new Set() };
    streams.set(stepId, s);
  }
  return s;
}

export function appendStreamDelta(stepId: string, delta: string, seq?: number): void {
  if (!stepId || !delta) return;
  const s = ensureStream(stepId);
  if (typeof seq === "number") {
    if (seq <= s.seq) return;
    s.seq = seq;
  }
  s.text += delta;
  for (const l of s.listeners) l(s.text);
}

export function clearStreamDelta(stepId: string): void {
  if (!stepId) return;
  const s = streams.get(stepId);
  if (!s) return;
  s.text = "";
  s.seq = 0;
  for (const l of s.listeners) l("");
}

export function dropStream(stepId: string): void {
  // Only drop when there are no live subscribers. If a chat is still
  // mounted but the run has completed, keep the buffer so the user can
  // still see what was written before the persisted output replaces it.
  const s = streams.get(stepId);
  if (!s || s.listeners.size > 0) return;
  streams.delete(stepId);
}

export function useStepStream(stepId: string | undefined | null): string {
  const [text, setText] = useState<string>(() =>
    stepId ? (streams.get(stepId)?.text ?? "") : "",
  );

  useEffect(() => {
    if (!stepId) {
      setText("");
      return;
    }
    const s = ensureStream(stepId);
    setText(s.text);
    s.listeners.add(setText);
    return () => {
      s.listeners.delete(setText);
      // Don't drop the buffer here — another component may re-mount
      // for the same stepId during a re-render and expect to see what
      // was already streamed. dropStream gets called explicitly when
      // step.completed fires.
    };
  }, [stepId]);

  return text;
}
