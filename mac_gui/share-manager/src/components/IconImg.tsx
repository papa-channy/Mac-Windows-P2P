// IconImg — single render point for "file/folder icon based on the active
// VSCode theme, with built-in emoji/ASCII fallbacks". Wraps useIconTheme().
//
// Wrap in a container with class="tree-icon" / "item-icon" / "nav-item-emoji"
// so the right CSS sizing kicks in (style.css `.tree-row .icon-img` etc).

import { useIconTheme } from "../lib/iconTheme";

interface Props {
  name: string;
  isDir: boolean;
}

export function IconImg({ name, isDir }: Props) {
  const { resolveIcon } = useIconTheme();
  const r = resolveIcon(name, isDir);
  switch (r.kind) {
    case "themed":
      return <img className="icon-img" src={r.url} alt="" />;
    case "ascii":
    case "emoji":
      return <span>{r.char}</span>;
  }
}

interface CategoryProps {
  categoryKey: string;
  emoji: string;
}

/** Category icon — themed folder when available, falls back to the
 *  category's own emoji glyph. */
export function CategoryIcon({ categoryKey, emoji }: CategoryProps) {
  const { resolveCategoryIcon } = useIconTheme();
  const r = resolveCategoryIcon(categoryKey);
  if (r.kind === "themed") return <img className="icon-img" src={r.url} alt="" />;
  return <span>{emoji}</span>;
}
