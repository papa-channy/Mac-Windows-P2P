// GitToolbar — the row of action buttons above the L1 Repo Card grid.
// "지금 스캔" walks the user's default git roots + republishes the share
// snapshot. "원격 동기화" fetches GitHub remote state for every repo in
// the current snapshot list.

import { useState } from "react";
import { useGitStore } from "../../lib/gitStore";
import { useToast } from "../../lib/toast";

export function GitToolbar() {
  const store = useGitStore();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [fetching, setFetching] = useState(false);

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const n = await store.scanAndPublish();
      toast(`${n}개 레포 스캔·게시 완료`, "success");
    } catch (e) {
      toast(`스캔 실패: ${e}`, "error");
    } finally {
      setScanning(false);
    }
  };

  const fetchRemote = async () => {
    if (fetching) return;
    const ownerRepos = collectOwnerRepos(store);
    if (ownerRepos.length === 0) {
      toast("조회할 레포가 없어요 (스캔/토큰 먼저)", "error");
      return;
    }
    if (!store.hasToken) {
      toast("PAT가 없습니다 — Settings → Git 에 토큰을 등록하세요", "error");
      return;
    }
    setFetching(true);
    try {
      const states = await store.fetchRemote(ownerRepos);
      toast(`${states.length}개 레포 원격 동기화 완료`, "success");
    } catch (e) {
      toast(`원격 동기화 실패: ${e}`, "error");
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="git-toolbar">
      <button
        className="git-toolbar-btn"
        onClick={scan}
        disabled={scanning || store.loading}
        title="이 머신의 ~/Developer, ~/Projects 등을 walk 해서 git status + log 게시"
      >
        {scanning ? "⏳ 스캔 중…" : "🔍 지금 스캔"}
      </button>
      <button
        className="git-toolbar-btn"
        onClick={fetchRemote}
        disabled={fetching || store.loading}
        title="GitHub API로 default_branch / branches / open PR 을 새로 받아 remote-cache.json 갱신"
      >
        {fetching ? "☁ 동기화 중…" : "☁ 원격 동기화"}
      </button>
      <button
        className="git-toolbar-btn ghost"
        onClick={() => store.refresh()}
        disabled={store.loading}
        title="셰어에서 다른 호스트가 게시한 최신 스냅샷을 읽어와요"
      >
        ↻ 새로고침
      </button>
    </div>
  );
}

function collectOwnerRepos(store: ReturnType<typeof useGitStore>): string[] {
  const seen = new Set<string>();
  for (const snap of store.snapshots) {
    for (const r of snap.repos) {
      if (r.owner_repo) seen.add(r.owner_repo);
    }
  }
  return [...seen];
}
