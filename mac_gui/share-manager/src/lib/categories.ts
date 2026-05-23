// categories.ts — frontend mirror of share.rs CATEGORIES (Rust source of truth).
// Keep in lockstep with mac_gui/share-manager/src-tauri/src/share.rs and
// windows_gui/share-manager/src-tauri/src/share.rs.

export interface Category {
  key: string;
  label: string;
  emoji: string;
  folder: string;
}

export const CATEGORIES: Category[] = [
  { key: "documents",    label: "Documents",    emoji: "📄", folder: "30_Documents"    },
  { key: "data",         label: "Data",         emoji: "📊", folder: "20_Data"         },
  { key: "repos",        label: "Code",         emoji: "💻", folder: "10_Repos"        },
  { key: "research",     label: "Research",     emoji: "🔬", folder: "40_Research"     },
  { key: "env",          label: "Env",          emoji: "⚙",  folder: "50_Env"          },
  { key: "builds",       label: "Builds",       emoji: "🛠", folder: "60_Builds"       },
  { key: "assets",       label: "Assets",       emoji: "🎨", folder: "70_Assets"       },
  { key: "misc",         label: "Misc",         emoji: "📦", folder: "90_Misc"         },
  { key: "unclassified", label: "Unclassified", emoji: "❔", folder: "99_Unclassified" },
];

export const DEFAULT_CATEGORY = "documents";
/** Multi-drop default — matches §4.1 of WINDOWS_PARITY_BRIEF. */
export const MULTI_DROP_CATEGORY = "unclassified";

export function categoryByKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}
