// GitView — T1.4 L1 Dashboard. Renders 3 hero stat cards + the Repo Card
// grid built from the cross-host snapshots. Mirror of
// windows_gui/.../app.js renderGitL1Dashboard + renderGitL1Card.
//
// Clicking a card is a placeholder for now — the L2 detail modal lands
// in T1.5 (next Wave C step). Until then we just log + toast.

import { useMemo, useState } from "react";
import {
  GitBranch,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { useGitStore } from "../lib/gitStore";
import { GitToolbar } from "../components/git/GitToolbar";
import { RepoCard, classifyCard, type RepoCardSummary } from "../components/git/RepoCard";
import { GitDetailModal } from "../components/git/GitDetailModal";
import { GitInspectorModal } from "../components/git/GitInspectorModal";
import type { RepoStatus } from "../lib/api";

export function GitView() {
  const store = useGitStore();
  const [detail, setDetail] = useState<string | null>(null);
  const [inspector, setInspector] = useState<string | null>(null);

  const summaries = useMemo(() => collectSummaries(store), [store.snapshots, store.remoteCache]);
  const classified = useMemo(
    () =>
      summaries
        .map((s) => ({ summary: s, ...classifyCard(s) }))
        .sort((a, b) => {
          const sev = { conflict: 100, diverged: 50, dirty: 20, partial: 5, synced: 0 } as const;
          const diff = sev[b.kind] - sev[a.kind];
          if (diff !== 0) return diff;
          return a.summary.label.localeCompare(b.summary.label);
        }),
    [summaries],
  );

  const total = classified.length;
  const synced = classified.filter((c) => c.kind === "synced").length;
  const diverged = classified.filter(
    (c) => c.kind === "diverged" || c.kind === "dirty",
  ).length;
  const conflicts = classified.filter((c) => c.kind === "conflict").length;

  const handleCardClick = (ownerRepo: string | null) => {
    if (!ownerRepo) return;
    setDetail(ownerRepo);
  };
  const openInspector = (ownerRepo: string) => {
    setDetail(null);
    setInspector(ownerRepo);
  };
  const backFromInspector = () => {
    if (!inspector) return;
    setDetail(inspector);
    setInspector(null);
  };

  return (
    <section className="git-view">
      <header className="git-view-head">
        <div>
          <h1>Git Status</h1>
          <p className="git-view-subtitle">
            {total === 0
              ? "레포별 Mac-로컬 / Win-로컬 동기화 상태"
              : `${total}개 레포 · 동기화 ${synced} · 발산 ${diverged} · 충돌 ${conflicts}`}
          </p>
        </div>
        <GitToolbar />
      </header>

      {store.error && <div className="git-view-error">⚠ {store.error}</div>}

      {!store.loading && classified.length === 0 ? (
        <EmptyState hasToken={store.hasToken} />
      ) : (
        <>
          <HeroStats total={total} synced={synced} conflicts={conflicts} />
          <div className="git-l1-grid">
            {classified.map((c) => (
              <RepoCard
                key={c.summary.ownerRepo ?? c.summary.label}
                summary={c.summary}
                onClick={handleCardClick}
              />
            ))}
          </div>
        </>
      )}

      <GitDetailModal
        isOpen={detail !== null}
        ownerRepo={detail}
        onClose={() => setDetail(null)}
        onOpenInspector={openInspector}
      />
      <GitInspectorModal
        isOpen={inspector !== null}
        ownerRepo={inspector}
        onClose={() => setInspector(null)}
        onBack={backFromInspector}
      />
    </section>
  );
}

function HeroStats({
  total,
  synced,
  conflicts,
}: {
  total: number;
  synced: number;
  conflicts: number;
}) {
  const pct = total > 0 ? Math.round((synced / total) * 100) : 0;
  return (
    <section className="git-hero">
      <div className="git-hero-card">
        <div className="ghc-body">
          <div className="ghc-label">전체 레포지토리</div>
          <div className="ghc-num">{total}</div>
          <div className="ghc-sub">3-Node로 동기 모니터링</div>
        </div>
        <div className="ghc-ic neutral"><GitBranch size={20} /></div>
      </div>
      <div className="git-hero-card synced">
        <div className="ghc-body">
          <div className="ghc-label">안전 · 동기화 완료</div>
          <div className="ghc-num">{synced}</div>
          <div className="ghc-sub">{pct}% in sync</div>
        </div>
        <div className="ghc-ic sync"><CheckCircle2 size={20} /></div>
      </div>
      <div className={"git-hero-card " + (conflicts > 0 ? "danger" : "safe")}>
        <div className="ghc-body">
          <div className="ghc-label">충돌 위험 · 동시 수정</div>
          <div className="ghc-num">{conflicts}</div>
          <div className="ghc-sub">{conflicts > 0 ? "머지 전 정리 필요" : "경보 없음"}</div>
        </div>
        <div className={"ghc-ic " + (conflicts > 0 ? "danger" : "neutral")}><ShieldAlert size={20} /></div>
      </div>
    </section>
  );
}

function EmptyState({ hasToken }: { hasToken: boolean }) {
  return (
    <div className="empty git-empty">
      <div className="empty-icon"><GitBranch size={28} /></div>
      <div className="empty-title">아직 스캔 기록이 없어요</div>
      <div className="empty-hint">
        "Scan Now" 로 이 머신의 레포를 찾고, Windows 측에서도 스캔하면 양쪽이 비교돼요.
        {!hasToken && (
          <>
            <br />
            원격(GitHub) 상태까지 보려면 Settings → Git 에서 PAT 도 등록해 주세요.
          </>
        )}
      </div>
    </div>
  );
}

function collectSummaries(store: ReturnType<typeof useGitStore>): RepoCardSummary[] {
  const map = new Map<string, RepoCardSummary>();
  for (const snap of store.snapshots) {
    for (const r of snap.repos) {
      const key = r.owner_repo ?? ("local:" + lastSegment(r.path));
      const existing = map.get(key);
      const augmented: RepoStatus & { os: string } = { ...r, os: snap.os };
      if (existing) {
        existing.byHost[snap.host] = augmented;
      } else {
        map.set(key, {
          ownerRepo: r.owner_repo ?? null,
          label: r.owner_repo ?? lastSegment(r.path),
          byHost: { [snap.host]: augmented },
          remote: null,
        });
      }
    }
  }
  // attach remote cache entries
  const cacheRepos = store.remoteCache?.repos ?? [];
  for (const r of cacheRepos) {
    const entry = map.get(r.owner_repo);
    if (entry) entry.remote = r;
  }
  return [...map.values()];
}

function lastSegment(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
