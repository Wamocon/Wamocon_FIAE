"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { Pencil, Save, Trash2, ArrowLeft } from "lucide-react";

interface Props {
  noteId: string;
}

export default function KnowledgeNoteDetail({ noteId }: Props) {
  const { profile } = useAuth();
  const router = useRouter();
  const traineeId = profile?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [oneDriveLink, setOneDriveLink] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const canEdit = useMemo(() => !!traineeId, [traineeId]);

  const load = async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainee/knowledge-notes/${noteId}${traineeId ? `?traineeId=${traineeId}` : ""}`);
      if (!res.ok) {
        if (res.status === 403) throw new Error("Kein Zugriff auf diesen Beitrag.");
        if (res.status === 404) throw new Error("Beitrag nicht gefunden.");
        throw new Error("Fehler beim Laden des Beitrags.");
      }
      const data = await res.json();
      const n = data.note;
      setTitle(n.title || "");
      setContent(n.content || "");
      setOneDriveLink(n.oneDriveLink || "");
      setCreatedAt(n.createdAt);
      setUpdatedAt(n.updatedAt || n.createdAt);
    } catch (e: any) {
      setError(e.message || "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, traineeId]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainee/knowledge-notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainee_id: traineeId,
          title,
          content,
          one_drive_link: oneDriveLink || null,
        }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen.");
      setEdit(false);
      await load();
    } catch (e: any) {
      setError(e.message || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Diesen Beitrag endgültig löschen?")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainee/knowledge-notes/${noteId}${traineeId ? `?traineeId=${traineeId}` : ""}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Löschen fehlgeschlagen.");
      router.push("/trainee/knowledge-submission");
    } catch (e: any) {
      setError(e.message || "Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-background min-h-full p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            className="text-muted hover:text-foreground flex items-center gap-2 rounded-xl px-3 py-2 transition-colors"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-5 w-5" />
            Zurück
          </button>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          {loading ? (
            <div className="text-center text-muted">Lade…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 text-red-300">
              {error}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                {edit ? (
                  <input
                    className="bg-background/50 border-accent/30 text-foreground w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                ) : (
                  <h1 className="text-foreground text-2xl font-bold">{title}</h1>
                )}

                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2">
                    {edit ? (
                      <button
                        disabled={saving}
                        onClick={onSave}
                        className="bg-accent text-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-4 py-2 font-medium"
                      >
                        <Save className="h-4 w-4" /> Speichern
                      </button>
                    ) : (
                      <button
                        onClick={() => setEdit(true)}
                        className="border-accent/30 text-foreground hover:bg-background/60 flex items-center gap-2 rounded-xl border px-4 py-2"
                      >
                        <Pencil className="h-4 w-4" /> Bearbeiten
                      </button>
                    )}
                    <button
                      disabled={deleting}
                      onClick={onDelete}
                      className="border-red-700/50 text-red-300 hover:bg-red-900/20 rounded-xl border px-4 py-2"
                    >
                      <Trash2 className="mr-1 inline h-4 w-4" /> Löschen
                    </button>
                  </div>
                )}
              </div>

              <div className="text-muted text-sm">
                Erstellt: {new Date(createdAt).toLocaleString()} · Aktualisiert: {new Date(updatedAt).toLocaleString()}
              </div>

              <div>
                <label className="text-muted mb-2 block text-sm font-medium">Inhalt</label>
                {edit ? (
                  <textarea
                    rows={10}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="bg-background/50 border-accent/30 text-foreground w-full resize-y rounded-2xl border px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                ) : (
                  <div className="text-muted whitespace-pre-wrap rounded-2xl border border-accent/20 bg-background/40 p-4">
                    {content}
                  </div>
                )}
              </div>

              <div>
                <label className="text-muted mb-2 block text-sm font-medium">Angehängter Link (z. B. OneDrive)</label>
                {edit ? (
                  <input
                    type="url"
                    value={oneDriveLink}
                    onChange={(e) => setOneDriveLink(e.target.value)}
                    placeholder="https://..."
                    className="bg-background/50 border-accent/30 text-foreground w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                ) : oneDriveLink ? (
                  <a
                    className="text-accent underline"
                    href={oneDriveLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {oneDriveLink}
                  </a>
                ) : (
                  <div className="text-muted">Kein Link angegeben</div>
                )}
              </div>

              <div className="text-muted text-xs">Hinweis: Dateianhänge werden derzeit als Link gespeichert. Direkte Datei-Uploads kommen später.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
