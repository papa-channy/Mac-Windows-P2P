// TreeView.tsx — recursive file tree at the user's home / desktop /
// custom shortcut. Click → 전송 to send a single file/folder, or drop
// onto the inline drop-zone (multi-drop = auto-unclassified).
//
// Mirrors windows_gui/share-manager/src/app.js navigateTree / treeRowEl /
// renderTreeChildren (app.js:204–286).

import { useCallback, useEffect, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { api, type FsNode } from "../lib/api";
import { useToast } from "../lib/toast";
import { useSettings } from "../lib/settings";
import { fmtBytes, iconForExt } from "../lib/format";

interface Props {
  /** Called by parent after a successful send so transfer counts re-fetch. */
  onSent: () => void;
  /** Open the category picker for the given paths. */
  onOpenPicker: (paths: string[]) => void;
  /** Treat as a "drop" (auto-batch if >1, else picker). */
  onDroppedPaths: (paths: string[]) => void;
}

export function TreeView({ onSent: _onSent, onOpenPicker, onDroppedPaths }: Props) {
  const [path, setPath] = useState<string>("");
  const [root, setRoot] = useState<FsNode | null>(null);
  const [error, setError] = useState<string>("");
  const toast = useToast();
  const { settings, loaded: settingsLoaded } = useSettings();
  const depth = settings.tree.max_depth;
  const shortcuts = settings.tree.shortcuts;

  // Initial navigate once settings are loaded (so depth is correct).
  useEffect(() => {
    if (!settingsLoaded) return;
    if (path) return;
    (async () => {
      try {
        const home = await api.homeDirectory();
        navigate(home);
      } catch (e) {
        setError("홈 폴더를 찾지 못했어요: " + String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  const navigate = useCallback(
    async (target: string) => {
      setError("");
      try {
        const n = await api.listDirectory(target, depth);
        setPath(n.path);
        setRoot(n);
      } catch (e) {
        const msg = "탐색 실패: " + String(e);
        setError(msg);
        toast(msg, "error");
      }
    },
    [depth, toast],
  );

  // Re-navigate when depth changes
  useEffect(() => {
    if (path) navigate(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth]);

  const navUp = async () => {
    if (!path) return;
    try {
      const parent = await api.parentDirectory(path);
      await navigate(parent);
    } catch (e) {
      toast("상위 폴더 없음: " + String(e), "error");
    }
  };
  const navHome = async () => {
    try {
      await navigate(await api.homeDirectory());
    } catch (e) {
      toast("홈 폴더 못 찾음: " + String(e), "error");
    }
  };
  const navDesktop = async () => {
    try {
      await navigate(await api.desktopDirectory());
    } catch (e) {
      toast("데스크탑 못 찾음: " + String(e), "error");
    }
  };

  const pickFiles = async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        title: "보낼 파일 선택",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      onDroppedPaths(paths);
    } catch (e) {
      toast("파일 선택 실패: " + String(e), "error");
    }
  };

  return (
    <section className="panel">
      <header className="main-header">
        <div>
          <h2>🚀 빠른 전송</h2>
          <div className="subtitle">
            폴더를 더블클릭하면 그 위치 기준으로 다시 펼쳐요. 행 위에서 → 버튼으로 바로 전송.
          </div>
        </div>
      </header>

      <div className="tree-toolbar">
        <button className="ghost-btn" onClick={navUp} title="상위 폴더로">← 상위</button>
        <button className="ghost-btn" onClick={navHome} title="홈 폴더로">🏠 홈</button>
        <button className="ghost-btn" onClick={navDesktop} title="데스크탑">🖥 데스크탑</button>
        <div className="tree-shortcuts">
          {shortcuts.map((s) => (
            <button
              key={s.path}
              className="tree-shortcut-chip"
              onClick={() => navigate(s.path)}
              title={s.path}
            >
              <span>📁</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <div className="tree-path" title={path}>{path || "…"}</div>
      </div>

      <div className="tree-container">
        <div className="tree">
          {error && (
            <div className="tree-truncated" style={{ color: "var(--danger)" }}>
              {error}
            </div>
          )}
          {!error && root && (
            <TreeChildren
              children={root.children}
              depth={0}
              onNavigate={navigate}
              onOpen={(p) =>
                api.openPath(p).catch((e) => toast("열기 실패: " + String(e), "error"))
              }
              onSend={(p) => onOpenPicker([p])}
            />
          )}
          {!error && root && root.children.length === 0 && (
            <div className="tree-truncated">(빈 폴더)</div>
          )}
          {root && root.child_overflow > 0 && (
            <div className="tree-overflow">
              … 그 외 {root.child_overflow}개 항목 (너무 많아 일부만 표시)
            </div>
          )}
        </div>
      </div>

      <div className="drop-zone-section">
        <DropZoneInline onPick={pickFiles} />
      </div>
    </section>
  );
}

// ─── Recursive tree rendering ──────────────────────────────────────

interface ChildrenProps {
  children: FsNode[];
  depth: number;
  onNavigate: (p: string) => void;
  onOpen: (p: string) => void;
  onSend: (p: string) => void;
}

function TreeChildren({ children, depth, onNavigate, onOpen, onSend }: ChildrenProps) {
  return (
    <>
      {children.map((node) => (
        <TreeBranch
          key={node.path}
          node={node}
          depth={depth}
          onNavigate={onNavigate}
          onOpen={onOpen}
          onSend={onSend}
        />
      ))}
    </>
  );
}

interface BranchProps {
  node: FsNode;
  depth: number;
  onNavigate: (p: string) => void;
  onOpen: (p: string) => void;
  onSend: (p: string) => void;
}

function TreeBranch({ node, depth, onNavigate, onOpen, onSend }: BranchProps) {
  return (
    <>
      <TreeRow node={node} depth={depth} onNavigate={onNavigate} onOpen={onOpen} onSend={onSend} />
      {node.is_dir && node.children.length > 0 && (
        <TreeChildren
          children={node.children}
          depth={depth + 1}
          onNavigate={onNavigate}
          onOpen={onOpen}
          onSend={onSend}
        />
      )}
      {node.is_dir && node.truncated && (
        <div
          className="tree-truncated"
          style={{ paddingLeft: (depth + 1) * 20 + 14 + "px" }}
        >
          … 더 깊은 내용 — 폴더를 더블클릭하면 들어가요
        </div>
      )}
      {node.is_dir && node.child_overflow > 0 && (
        <div
          className="tree-overflow"
          style={{ paddingLeft: (depth + 1) * 20 + 14 + "px" }}
        >
          … 그 외 {node.child_overflow}개 더
        </div>
      )}
    </>
  );
}

function TreeRow({ node, depth, onNavigate, onOpen, onSend }: BranchProps) {
  const handleDouble = () => {
    if (node.is_dir) onNavigate(node.path);
    else onOpen(node.path);
  };
  return (
    <div
      className={"tree-row" + (node.is_dir ? " is-folder" : "")}
      style={{ paddingLeft: depth * 20 + 14 + "px" }}
      onDoubleClick={handleDouble}
    >
      <span className="tree-icon">{node.is_dir ? "📁" : iconForExt(node.name)}</span>
      <span className="tree-name" title={node.path}>{node.name}</span>
      {!node.is_dir && <span className="tree-size">{fmtBytes(node.size_bytes)}</span>}
      <button
        className="tree-send"
        title="Windows로 보내기"
        onClick={(e) => {
          e.stopPropagation();
          onSend(node.path);
        }}
      >
        → 전송
      </button>
    </div>
  );
}

// ─── Inline drop zone ─────────────────────────────────────────────

interface DropZoneProps {
  onPick: () => void;
}

function DropZoneInline({ onPick }: DropZoneProps) {
  // The actual drop event is bound at the App level via useDragDrop —
  // this element is purely visual. We accept click → file picker as the
  // tappable fallback for non-drag users.
  return (
    <div className="drop-zone-inline" onClick={onPick} title="클릭해서 파일 선택, 또는 여기로 드래그">
      <div className="drop-zone-icon-big">⬇</div>
      <div className="drop-zone-body">
        <div className="drop-zone-title">파일/폴더를 여기로 드래그</div>
        <div className="drop-zone-sub">
          바탕화면/Finder/위 트리 어디서든. 여러 개를 한 번에 놓으면 자동으로{" "}
          <b>❔ 미분류</b>로 보내요.
        </div>
      </div>
      <button
        className="primary-btn"
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        📂 파일 선택
      </button>
    </div>
  );
}
