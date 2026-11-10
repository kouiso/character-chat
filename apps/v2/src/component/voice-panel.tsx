// ボイス設定パネル（RIT-210）。キャラ編集ページに置く。未設定は既定値表示。
import { useEffect, useState } from "react";

import { getVoiceSettings, putVoiceSettings, type VoiceSettings } from "../lib/voice";

export const VoicePanel = ({ characterId }: { characterId: string }) => {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getVoiceSettings(characterId)
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch(() => {
        if (alive) setError("読み込み失敗");
      });
    return () => {
      alive = false;
    };
  }, [characterId]);

  if (error) return <p className="muted">{error}</p>;
  if (!settings) return <p className="muted">ボイス設定を読み込み中…</p>;

  const save = async () => {
    setSaving(true);
    try {
      const next = await putVoiceSettings(characterId, {
        engine: settings.engine,
        speakerId: settings.speakerId,
        speed: settings.speed,
        pitch: settings.pitch,
        intonation: settings.intonation,
      });
      setSettings(next);
    } catch {
      setError("保存失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel voice-panel">
      <h3>ボイス設定</h3>
      {settings.isDefault ? <p className="muted">未設定（既定ボイス）</p> : null}
      <label>
        エンジン
        <select
          value={settings.engine}
          onChange={(e) =>
            setSettings({ ...settings, engine: e.target.value as VoiceSettings["engine"] })
          }
        >
          <option value="voicevox">VOICEVOX</option>
          <option value="aivisspeech">AivisSpeech</option>
        </select>
      </label>
      <label>
        話者ID
        <input
          value={settings.speakerId}
          onChange={(e) => setSettings({ ...settings, speakerId: e.target.value })}
        />
      </label>
      <label>
        速度 {settings.speed.toFixed(2)}
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.05}
          value={settings.speed}
          onChange={(e) => setSettings({ ...settings, speed: Number(e.target.value) })}
        />
      </label>
      <label>
        音高 {settings.pitch.toFixed(2)}
        <input
          type="range"
          min={-0.15}
          max={0.15}
          step={0.01}
          value={settings.pitch}
          onChange={(e) => setSettings({ ...settings, pitch: Number(e.target.value) })}
        />
      </label>
      <label>
        抑揚 {settings.intonation.toFixed(2)}
        <input
          type="range"
          min={0}
          max={2.0}
          step={0.05}
          value={settings.intonation}
          onChange={(e) => setSettings({ ...settings, intonation: Number(e.target.value) })}
        />
      </label>
      <button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "保存中…" : "ボイス設定を保存"}
      </button>
    </section>
  );
};
