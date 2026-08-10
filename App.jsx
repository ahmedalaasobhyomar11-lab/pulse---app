import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Wind, TrendingUp, Sparkles, ChevronRight, X, Flame } from "lucide-react";

// ---- Storage (browser localStorage — this runs on a real site now) ----
const storage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : { value: v };
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { value };
    } catch (e) {
      return null;
    }
  },
};

// ---- Design tokens ----
const MOODS = [
  { v: 1, label: "Heavy", color: "#8C6A5A" },
  { v: 2, label: "Low", color: "#A9836A" },
  { v: 3, label: "Steady", color: "#C79D6E" },
  { v: 4, label: "Good", color: "#9BB98A" },
  { v: 5, label: "Bright", color: "#7FB3A3" },
];

const TAGS = ["Work", "Sleep", "Anxious", "Tired", "Social", "Health", "Family", "Money"];

const CRISIS_WORDS = ["suicide", "kill myself", "end it all", "not worth living", "want to die", "self harm", "self-harm"];

// Fallback reflections used when no AI backend is configured (see README).
const FALLBACK_REFLECTIONS = {
  1: "That sounds like a genuinely heavy day to carry. Try naming just the next hour, not the whole day.",
  2: "Low days don't need to be explained away — they're just true right now. A short walk or a glass of water can be a small enough step.",
  3: "Steady is its own kind of okay. Notice one thing that's working right now and let that be enough.",
  4: "Good to hear. Whatever's contributing to that, a quick note of what it is can help you find your way back to it later.",
  5: "That's a bright one — worth pausing on for a second before the day pulls you forward again.",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fmtShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---- Breathing orb ----
function BreatheOrb({ phase }) {
  const scale = phase === "in" ? 1.35 : phase === "hold" ? 1.35 : 0.75;
  return (
    <div style={{ position: "relative", width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(127,179,163,0.18) 0%, rgba(127,179,163,0) 70%)",
          transform: `scale(${scale})`,
          transition: "transform 3.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: "linear-gradient(160deg, #7FB3A3 0%, #E3A56F 130%)",
          transform: `scale(${scale})`,
          transition: "transform 3.5s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: "0 0 40px rgba(127,179,163,0.25)",
        }}
      />
    </div>
  );
}

function BreatheView({ onClose }) {
  const [phase, setPhase] = useState("in");
  const [running, setRunning] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    const sequence = [
      { phase: "in", seconds: 4 },
      { phase: "hold", seconds: 7 },
      { phase: "out", seconds: 8 },
    ];
    let idx = 0;
    setPhase(sequence[0].phase);

    const tick = () => {
      idx = (idx + 1) % sequence.length;
      setPhase(sequence[idx].phase);
    };

    timerRef.current = setInterval(tick, sequence[idx].seconds * 1000 || 4000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [running]);

  const label = phase === "in" ? "Breathe in" : phase === "hold" ? "Hold" : "Breathe out";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0F1D1B", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", color: "#9CB3AC", cursor: "pointer", padding: 8 }}
        aria-label="Close breathing exercise"
      >
        <X size={22} />
      </button>
      <BreatheOrb phase={phase} />
      <div style={{ marginTop: 36, textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, color: "#F2EEE4", letterSpacing: 0.2 }}>{label}</div>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#7FB3A3", marginTop: 6, letterSpacing: 1.5, textTransform: "uppercase" }}>
          4 · 7 · 8 pattern
        </div>
      </div>
      <button
        onClick={() => setRunning((r) => !r)}
        style={{
          marginTop: 40,
          background: "#16302A",
          border: "1px solid #2A4A41",
          color: "#F2EEE4",
          padding: "10px 24px",
          borderRadius: 999,
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        {running ? "Pause" : "Resume"}
      </button>
    </div>
  );
}

// ---- Check-in flow ----
function CheckInView({ onSaved }) {
  const [mood, setMood] = useState(null);
  const [tags, setTags] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [insight, setInsight] = useState(null);
  const [error, setError] = useState(null);
  const [showCrisisNote, setShowCrisisNote] = useState(false);

  const toggleTag = (t) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const containsCrisisLanguage = (text) => {
    const lower = text.toLowerCase();
    return CRISIS_WORDS.some((w) => lower.includes(w));
  };

  // Calls YOUR backend proxy if configured (see README.md). Falls back to a
  // local, non-AI reflection so the app always works even with no backend.
  const getInsight = useCallback(async (moodVal, tagList, noteText) => {
    const proxyUrl = import.meta.env.VITE_REFLECTION_API_URL;
    if (!proxyUrl) {
      return FALLBACK_REFLECTIONS[moodVal];
    }
    try {
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: moodVal, tags: tagList, note: noteText }),
      });
      const data = await response.json();
      return data.reflection || FALLBACK_REFLECTIONS[moodVal];
    } catch (e) {
      return FALLBACK_REFLECTIONS[moodVal];
    }
  }, []);

  const handleSave = async () => {
    if (mood === null || saving) return;
    setSaving(true);
    setError(null);

    if (containsCrisisLanguage(note)) {
      setShowCrisisNote(true);
    }

    const entry = {
      id: uid(),
      date: new Date().toISOString(),
      mood,
      tags,
      note: note.trim(),
    };

    entry.insight = await getInsight(mood, tags, note.trim());

    try {
      const existing = storage.get("checkins");
      const list = existing ? JSON.parse(existing.value) : [];
      list.push(entry);
      storage.set("checkins", JSON.stringify(list));
    } catch (e) {
      setError("Couldn't save your check-in. Please try again.");
      setSaving(false);
      return;
    }

    setInsight(entry.insight);
    setSaving(false);
    onSaved(entry);
  };

  const reset = () => {
    setMood(null);
    setTags([]);
    setNote("");
    setInsight(null);
    setShowCrisisNote(false);
  };

  if (insight) {
    return (
      <div style={{ padding: "8px 4px" }}>
        <div
          style={{
            background: "linear-gradient(155deg, #1D3A32 0%, #16302A 100%)",
            border: "1px solid #2A4A41",
            borderRadius: 20,
            padding: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Sparkles size={16} color="#E3A56F" />
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3" }}>
              Reflection
            </span>
          </div>
          <p style={{ fontFamily: "'Fraunces', serif", fontSize: 19, lineHeight: 1.5, color: "#F2EEE4", margin: 0 }}>{insight}</p>
        </div>

        {showCrisisNote && (
          <div
            style={{
              marginTop: 14,
              background: "#2A1D1D",
              border: "1px solid #4A2E2A",
              borderRadius: 16,
              padding: 18,
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
              color: "#F2EEE4",
              lineHeight: 1.5,
            }}
          >
            It sounds like things feel really heavy right now. If you're in the US, you can call or text{" "}
            <strong>988</strong> (Suicide &amp; Crisis Lifeline) anytime — free and confidential. If you're
            elsewhere, please reach out to a local crisis line or someone you trust.
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#C79D6E" }}>{error}</div>
        )}

        <button
          onClick={reset}
          style={{
            marginTop: 18,
            width: "100%",
            background: "none",
            border: "1px solid #2A4A41",
            color: "#9CB3AC",
            padding: "12px",
            borderRadius: 14,
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Done for now
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 4px" }}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3", marginBottom: 10 }}>
          How's your pulse right now
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          {MOODS.map((m) => (
            <button
              key={m.v}
              onClick={() => setMood(m.v)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "12px 4px",
                borderRadius: 16,
                border: mood === m.v ? `1.5px solid ${m.color}` : "1px solid #22392F",
                background: mood === m.v ? "#16302A" : "transparent",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              aria-pressed={mood === m.v}
            >
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: m.color, opacity: mood === m.v ? 1 : 0.55 }} />
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10.5, color: mood === m.v ? "#F2EEE4" : "#6E8981" }}>{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3", marginBottom: 10 }}>
          What's touching it (optional)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TAGS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                border: tags.includes(t) ? "1px solid #E3A56F" : "1px solid #22392F",
                background: tags.includes(t) ? "rgba(227,165,111,0.12)" : "transparent",
                color: tags.includes(t) ? "#E3A56F" : "#9CB3AC",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3", marginBottom: 10 }}>
          A line or two, if you want
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's on your mind..."
          rows={3}
          style={{
            width: "100%",
            background: "#16302A",
            border: "1px solid #22392F",
            borderRadius: 14,
            padding: 14,
            color: "#F2EEE4",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            resize: "none",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {error && <div style={{ marginBottom: 12, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#C79D6E" }}>{error}</div>}

      <button
        onClick={handleSave}
        disabled={mood === null || saving}
        style={{
          width: "100%",
          background: mood === null ? "#1D3A32" : "linear-gradient(135deg, #7FB3A3, #E3A56F)",
          border: "none",
          color: mood === null ? "#5C7A72" : "#0F1D1B",
          padding: "15px",
          borderRadius: 14,
          fontFamily: "'Inter', sans-serif",
          fontWeight: 600,
          fontSize: 15,
          cursor: mood === null ? "default" : "pointer",
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? "Reflecting..." : "Log check-in"}
      </button>
    </div>
  );
}

// ---- Trends view ----
function TrendsView({ entries }) {
  if (!entries.length) {
    return (
      <div style={{ padding: "40px 4px", textAlign: "center" }}>
        <TrendingUp size={28} color="#3A5850" style={{ marginBottom: 12 }} />
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#6E8981" }}>
          Your first check-in will start your trend line.
        </p>
      </div>
    );
  }

  const chartData = entries.slice(-14).map((e) => ({ date: fmtShort(e.date), mood: e.mood }));
  const avg = (entries.reduce((s, e) => s + e.mood, 0) / entries.length).toFixed(1);

  return (
    <div style={{ padding: "8px 4px" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, background: "#16302A", borderRadius: 16, padding: 16, border: "1px solid #22392F" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, color: "#F2EEE4" }}>{entries.length}</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#7FB3A3", textTransform: "uppercase", letterSpacing: 1 }}>
            Check-ins
          </div>
        </div>
        <div style={{ flex: 1, background: "#16302A", borderRadius: 16, padding: 16, border: "1px solid #22392F" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, color: "#F2EEE4" }}>{avg}</div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#7FB3A3", textTransform: "uppercase", letterSpacing: 1 }}>
            Avg pulse
          </div>
        </div>
      </div>

      <div style={{ background: "#16302A", borderRadius: 20, padding: "20px 8px 8px", border: "1px solid #22392F", marginBottom: 22 }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3", marginBottom: 6, paddingLeft: 12 }}>
          Last 14 check-ins
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 10, right: 16, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#22392F" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#6E8981", fontSize: 10, fontFamily: "Inter" }} axisLine={{ stroke: "#22392F" }} tickLine={false} />
            <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: "#6E8981", fontSize: 10, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={20} />
            <Line type="monotone" dataKey="mood" stroke="#7FB3A3" strokeWidth={2} dot={{ r: 3, fill: "#E3A56F", strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "#7FB3A3", marginBottom: 10 }}>
        Recent entries
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries
          .slice()
          .reverse()
          .slice(0, 8)
          .map((e) => {
            const m = MOODS.find((mm) => mm.v === e.mood);
            return (
              <div key={e.id} style={{ background: "#16302A", border: "1px solid #22392F", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: e.note ? 8 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: m?.color }} />
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#F2EEE4" }}>{m?.label}</span>
                  </div>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#6E8981" }}>{fmtShort(e.date)}</span>
                </div>
                {e.note && (
                  <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#9CB3AC", margin: 0, lineHeight: 1.4 }}>{e.note}</p>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ---- Main app ----
export default function Pulse() {
  const [tab, setTab] = useState("checkin");
  const [entries, setEntries] = useState([]);
  const [breathing, setBreathing] = useState(false);

  useEffect(() => {
    const res = storage.get("checkins");
    setEntries(res ? JSON.parse(res.value) : []);
  }, []);

  const handleSaved = (entry) => {
    setEntries((prev) => [...prev, entry]);
  };

  const streak = (() => {
    if (!entries.length) return 0;
    const days = new Set(entries.map((e) => todayKey(new Date(e.date))));
    let count = 0;
    let cursor = new Date();
    while (days.has(todayKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#0F1D1B", display: "flex", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        textarea:focus, button:focus-visible { outline: 2px solid #7FB3A3; outline-offset: 2px; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 440, padding: "28px 18px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, color: "#F2EEE4" }}>Pulse</div>
            <div style={{ fontSize: 12, color: "#6E8981", marginTop: 2 }}>Sixty seconds for yourself</div>
          </div>
          {streak > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#16302A", border: "1px solid #22392F", padding: "6px 12px", borderRadius: 999 }}>
              <Flame size={14} color="#E3A56F" />
              <span style={{ fontSize: 13, color: "#E3A56F" }}>{streak}</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, background: "#16302A", padding: 4, borderRadius: 14, marginBottom: 24, border: "1px solid #22392F" }}>
          {[
            { id: "checkin", label: "Check in" },
            { id: "trends", label: "Trends" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: tab === t.id ? "#0F1D1B" : "transparent",
                color: tab === t.id ? "#F2EEE4" : "#6E8981",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "checkin" ? <CheckInView onSaved={handleSaved} /> : <TrendsView entries={entries} />}

        <button
          onClick={() => setBreathing(true)}
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#16302A",
            border: "1px solid #2A4A41",
            color: "#F2EEE4",
            padding: "12px 20px",
            borderRadius: 999,
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <Wind size={15} color="#7FB3A3" />
          Breathe for a minute
          <ChevronRight size={14} color="#6E8981" />
        </button>
      </div>

      {breathing && <BreatheView onClose={() => setBreathing(false)} />}
    </div>
  );
}
