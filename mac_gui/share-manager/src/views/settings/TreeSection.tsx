// TreeSection — depth stepper + shortcut folders CRUD.
//
// Mirrors windows_gui/share-manager/src/app.js depth/shortcut handlers
// (app.js:502–530, 657–686, index.html:161–181).

import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { useSettings, type ShortcutEntry } from "../../lib/settings";
import { useToast } from "../../lib/toast";

const MIN_DEPTH = 1;
const MAX_DEPTH = 10;

export function TreeSection() {
  const { settings, update } = useSettings();
  const toast = useToast();

  const setDepth = (d: number) =>
    update((s) => ({
      ...s,
      tree: { ...s.tree, max_depth: Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, d)) },
    }));

  const removeShortcut = (idx: number) =>
    update((s) => ({
      ...s,
      tree: { ...s.tree, shortcuts: s.tree.shortcuts.filter((_, i) => i !== idx) },
    }));

  const addShortcut = async () => {
    try {
      const picked = await pickFolder({
        multiple: false,
        directory: true,
        title: "단축 폴더 추가",
      });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      const name = path.split("/").filter(Boolean).pop() || path;
      const next: ShortcutEntry = { name, path };
      await update((s) => ({
        ...s,
        tree: {
          ...s.tree,
          shortcuts: [...s.tree.shortcuts, next],
        },
      }));
    } catch (e) {
      toast("폴더 선택 실패: " + String(e), "error");
    }
  };

  return (
    <section className="settings-section">
      <h3>트리 탐색</h3>

      <div className="settings-row">
        <div className="settings-label">탐색 깊이</div>
        <div className="settings-control">
          <div className="depth-stepper">
            <button className="step-btn" onClick={() => setDepth(settings.tree.max_depth - 1)}>−</button>
            <span className="depth-value">{settings.tree.max_depth}</span>
            <button className="step-btn" onClick={() => setDepth(settings.tree.max_depth + 1)}>+</button>
          </div>
          <span className="settings-hint">
            1 ~ 10단계. 깊을수록 한 번에 더 많이 보임 (느려질 수 있음).
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">단축 폴더</div>
        <div className="settings-control">
          <div className="shortcuts-list">
            {settings.tree.shortcuts.length === 0 ? (
              <span className="settings-hint">아직 추가한 단축 폴더가 없어요.</span>
            ) : (
              settings.tree.shortcuts.map((s, idx) => (
                <div key={s.path + idx} className="shortcut-item">
                  <span className="shortcut-item-name">📁 {s.name}</span>
                  <span className="shortcut-item-path" title={s.path}>{s.path}</span>
                  <button className="shortcut-remove" onClick={() => removeShortcut(idx)}>
                    제거
                  </button>
                </div>
              ))
            )}
          </div>
          <button className="ghost-btn" onClick={addShortcut}>＋ 폴더 추가</button>
          <span className="settings-hint">
            추가한 폴더는 빠른 전송 화면 상단 도구바에 칩으로 나타나요.
          </span>
        </div>
      </div>
    </section>
  );
}
