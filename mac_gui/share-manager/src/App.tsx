import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type ReleaseEntry, type TransferItem } from "./lib/api";
import { checkForUpdate, type AvailableUpdate } from "./lib/updater";
import { NAV_GROUPS, DEFAULT_SELECTION, type SidebarSelection } from "./lib/nav";
import { ToastProvider } from "./lib/toast";
import { SettingsProvider } from "./lib/settings";
import { IconThemeProvider } from "./lib/iconTheme";
import { useDragDrop } from "./lib/useDragDrop";
import { useSendFlow } from "./lib/useSendFlow";
import { Sidebar } from "./components/Sidebar";
import { AnnouncementModal } from "./components/AnnouncementModal";
import { UpdaterBanner } from "./components/UpdaterBanner";
import { DropOverlay } from "./components/DropOverlay";
import { CategoryPickerModal } from "./components/CategoryPickerModal";
import { PermissionsOnboarding } from "./components/PermissionsOnboarding";
import { ItemsView } from "./views/ItemsView";
import { TreeView } from "./views/TreeView";
import { NotesView } from "./views/NotesView";
import { ClipboardView } from "./views/ClipboardView";
import { SettingsView } from "./views/SettingsView";

const LAST_SEEN_KEY = "share-manager.last_seen_version";
const PERMS_ONBOARDED_KEY = "share-manager.permissions_onboarded";

export function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <IconThemeProvider>
          <AppInner />
        </IconThemeProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}

function AppInner() {
  const [selection, setSelection] = useState<SidebarSelection>(DEFAULT_SELECTION);
  const [settingsActive, setSettingsActive] = useState(false);
  const [shareRoot, setShareRoot] = useState<string>("초기화 중…");
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [allItems, setAllItems] = useState<Record<string, TransferItem[]>>({});
  const [announcement, setAnnouncement] = useState<
    { entry: ReleaseEntry; isWelcome: boolean } | null
  >(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showPermsOnboarding, setShowPermsOnboarding] = useState(false);

  const refreshTransfers = useCallback(async () => {
    const allItemsLocal: Record<string, TransferItem[]> = {};
    const countsLocal: Record<string, Record<string, number>> = {};
    for (const g of NAV_GROUPS) {
      let items: TransferItem[] = [];
      try {
        items = await api.listTransfers(g.direction, g.state);
      } catch {
        items = [];
      }
      allItemsLocal[g.id] = items;
      const groupCounts: Record<string, number> = { _all: items.length };
      for (const it of items) {
        groupCounts[it.category_key] = (groupCounts[it.category_key] ?? 0) + 1;
      }
      countsLocal[g.id] = groupCounts;
    }
    setAllItems(allItemsLocal);
    setCounts(countsLocal);
  }, []);

  // Send flow: provides pickerPaths, openPicker, handleDropped, closePicker
  const sendFlow = useSendFlow(refreshTransfers);

  // Window-level drag-drop wiring — drops anywhere on the window enter
  // sendFlow.handleDropped (single → picker, multi → unclassified).
  useDragDrop({
    onEnter: () => setDragging(true),
    onLeave: () => setDragging(false),
    onDrop: (paths) => sendFlow.handleDropped(paths),
  });

  // share-changed watcher event router. Phase I will expand this.
  useEffect(() => {
    let unlistenShare: (() => void) | undefined;
    let unlistenSent: (() => void) | undefined;
    (async () => {
      try {
        unlistenShare = await listen<{ topic: string }>("share-changed", (e) => {
          if (e.payload.topic === "transfers") refreshTransfers();
        });
      } catch {
        /* watcher not available; ignore */
      }
      try {
        // Service immediate-send path emits this when send_path finishes.
        unlistenSent = await listen("transfers-changed", () => refreshTransfers());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      unlistenShare?.();
      unlistenSent?.();
    };
  }, [refreshTransfers]);

  useEffect(() => {
    api.shareRoot().then(setShareRoot).catch(() => setShareRoot("(셰어 미마운트)"));
    refreshTransfers();
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
      setAnnouncement({ entry, isWelcome: lastSeen === null });
    })();
    checkForUpdate().then((u) => u && setUpdate(u)).catch(() => void 0);

    // First-launch permissions onboarding — shown once per machine.
    if (!localStorage.getItem(PERMS_ONBOARDED_KEY)) {
      setShowPermsOnboarding(true);
    }
  }, [refreshTransfers]);

  const dismissAnnouncement = () => {
    if (announcement) {
      localStorage.setItem(LAST_SEEN_KEY, announcement.entry.version);
    }
    setAnnouncement(null);
  };

  const onSelect = (s: SidebarSelection) => {
    setSettingsActive(false);
    setSelection(s);
  };
  const onToggleSettings = () => setSettingsActive((v) => !v);
  const onRefresh = () => refreshTransfers();

  const activePanel: SidebarSelection["panel"] = settingsActive
    ? "settings"
    : selection.panel;

  return (
    <div className="app">
      <Sidebar
        selection={selection}
        settingsActive={settingsActive}
        counts={counts}
        status={shareRoot}
        onSelect={onSelect}
        onToggleSettings={onToggleSettings}
        onRefresh={onRefresh}
      />
      <main className="main">
        {update && <UpdaterBanner update={update} onDismiss={() => setUpdate(null)} />}
        {activePanel === "items" && (
          <ItemsView
            selection={selection}
            items={allItems[selection.group ?? ""] ?? []}
            onRefresh={refreshTransfers}
          />
        )}
        {activePanel === "tree" && (
          <TreeView
            onSent={refreshTransfers}
            onOpenPicker={sendFlow.openPicker}
            onDroppedPaths={sendFlow.handleDropped}
          />
        )}
        {activePanel === "notes" && <NotesView />}
        {activePanel === "clipboard" && <ClipboardView />}
        {activePanel === "settings" && <SettingsView />}
      </main>

      <DropOverlay visible={dragging} />
      <CategoryPickerModal
        isOpen={sendFlow.pickerPaths.length > 0}
        paths={sendFlow.pickerPaths}
        onClose={sendFlow.closePicker}
        onSent={refreshTransfers}
      />

      {announcement && (
        <AnnouncementModal
          entry={announcement.entry}
          isWelcome={announcement.isWelcome}
          onClose={dismissAnnouncement}
        />
      )}
      <PermissionsOnboarding
        isOpen={showPermsOnboarding}
        onClose={() => {
          localStorage.setItem(PERMS_ONBOARDED_KEY, "1");
          setShowPermsOnboarding(false);
        }}
      />
    </div>
  );
}
