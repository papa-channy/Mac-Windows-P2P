import { useEffect, useState } from "react";
import { api, type ReleaseEntry } from "./lib/api";
import { checkForUpdate, type AvailableUpdate } from "./lib/updater";
import { Sidebar } from "./components/Sidebar";
import { AnnouncementModal } from "./components/AnnouncementModal";
import { UpdaterBanner } from "./components/UpdaterBanner";
import { TransfersView } from "./views/TransfersView";
import { NotesView } from "./views/NotesView";
import { ClipboardView } from "./views/ClipboardView";
import { SettingsView } from "./views/SettingsView";

export type ViewKey = "transfers" | "notes" | "clipboard" | "settings";

const LAST_SEEN_KEY = "share-manager.last_seen_version";

export function App() {
  const [view, setView] = useState<ViewKey>("transfers");
  const [shareRoot, setShareRoot] = useState<string>("");
  const [announcement, setAnnouncement] = useState<
    { entry: ReleaseEntry; isWelcome: boolean } | null
  >(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    api.shareRoot().then(setShareRoot).catch(() => setShareRoot("(not mounted)"));

    // Release-notes-on-launch flow:
    //   1. Read RELEASES.json bundled into the .app.
    //   2. Compare entry for current version with localStorage.last_seen.
    //   3. If different (or unset), show modal. After dismiss, persist.
    (async () => {
      let entries: ReleaseEntry[] = [];
      try {
        entries = await api.getReleaseNotes();
      } catch {
        return;
      }
      const version = await api.currentAppVersion();
      const entry = entries.find((e) => e.version === version);
      if (!entry) return;
      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      if (lastSeen === version) return;
      const isWelcome = lastSeen === null;
      setAnnouncement({ entry, isWelcome });
    })();

    // Auto-update check: silent on failure, banner on success.
    (async () => {
      const u = await checkForUpdate();
      if (u) setUpdate(u);
    })();
  }, []);

  const dismissAnnouncement = async () => {
    if (announcement) {
      localStorage.setItem(LAST_SEEN_KEY, announcement.entry.version);
    }
    setAnnouncement(null);
  };

  return (
    <div className="app-shell">
      <Sidebar current={view} onSelect={setView} shareRoot={shareRoot} />
      <main className="app-main">
        {update && (
          <UpdaterBanner update={update} onDismiss={() => setUpdate(null)} />
        )}
        {view === "transfers" && <TransfersView />}
        {view === "notes" && <NotesView />}
        {view === "clipboard" && <ClipboardView />}
        {view === "settings" && <SettingsView />}
      </main>
      {announcement && (
        <AnnouncementModal
          entry={announcement.entry}
          isWelcome={announcement.isWelcome}
          onClose={dismissAnnouncement}
        />
      )}
    </div>
  );
}
