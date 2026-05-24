// gitStore.tsx — T1.3 React Context store for the git dashboard.
//
// Holds the cross-host snapshot (list_git_status), the per-host commit
// logs (list_git_logs), the remote cache, and the current PAT / SSH
// status. The store refreshes on:
//   - mount
//   - manual `refresh()` calls (toolbar "지금 스캔" / "원격 fetch")
//   - share-changed events with topic="git" (watcher fires when another
//     host publishes a new snapshot)
//
// Wave C will render against this store; for now it just centralises the
// async boilerplate so Wave C view components can stay declarative.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type GitLogDoc,
  type GitSshStatus,
  type HostGitSnapshot,
  type RemoteCacheDoc,
  type RemoteRepoState,
  type RepoGraph,
} from "./api";

export interface GitStoreState {
  /** snapshots[] from list_git_status — one entry per host */
  snapshots: HostGitSnapshot[];
  /** {host: GitLogDoc} from list_git_logs */
  logsByHost: Record<string, GitLogDoc>;
  /** remote-cache.json (read-only mirror) */
  remoteCache: RemoteCacheDoc | null;
  /** Keychain probe — does a PAT exist? */
  hasToken: boolean;
  /** SSH key probe (~/.ssh) */
  ssh: GitSshStatus | null;
  loading: boolean;
  error: string | null;
}

interface GitStoreApi {
  refresh: () => Promise<void>;
  scanAndPublish: () => Promise<number>;
  fetchRemote: (ownerRepos: string[]) => Promise<RemoteRepoState[]>;
  buildRepoGraph: (ownerRepo: string) => Promise<RepoGraph>;
}

type GitStore = GitStoreState & GitStoreApi;

const initialState: GitStoreState = {
  snapshots: [],
  logsByHost: {},
  remoteCache: null,
  hasToken: false,
  ssh: null,
  loading: false,
  error: null,
};

const GitContext = createContext<GitStore | null>(null);

export function GitProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GitStoreState>(initialState);
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [snapshots, logsByHost, remoteCache, tokenResp, ssh] =
        await Promise.all([
          api.git.listStatus(),
          api.git.listLogs(),
          api.git.readRemoteCache().catch(() => ({ repos: [] }) as RemoteCacheDoc),
          api.git.hasToken().catch(() => ({ has_token: false })),
          api.git.sshStatus().catch(
            () =>
              ({ has_key: false, public_key: null, path: null }) as GitSshStatus,
          ),
        ]);
      setState({
        snapshots,
        logsByHost,
        remoteCache,
        hasToken: tokenResp.has_token,
        ssh,
        loading: false,
        error: null,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    } finally {
      inflightRef.current = false;
    }
  }, []);

  const scanAndPublish = useCallback(async () => {
    const n = await api.git.scanAndPublish();
    await refresh();
    return n;
  }, [refresh]);

  const fetchRemote = useCallback(
    async (ownerRepos: string[]) => {
      const r = await api.git.fetchRemote(ownerRepos);
      await refresh();
      return r;
    },
    [refresh],
  );

  const buildRepoGraph = useCallback(
    (ownerRepo: string) => api.git.buildRepoGraph(ownerRepo),
    [],
  );

  // Mount + share-changed refresh. Two topics:
  //   - "git"        — peer host published a new snapshot, re-read it
  //   - "git-token"  — peer host shared a fresh PAT for us, decrypt +
  //                     import into our keychain, then refresh the
  //                     store so the new token is reflected in
  //                     hasToken.
  useEffect(() => {
    refresh();
    // One-shot pull on mount — picks up a PAT that a peer host shared
    // while this app wasn't running.
    api.git.pullPatFromShare().catch(() => void 0);

    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ topic?: string }>("share-changed", async (e) => {
          if (e.payload?.topic === "git") {
            refresh();
          } else if (e.payload?.topic === "git-token") {
            try {
              const imported = await api.git.pullPatFromShare();
              if (imported) await refresh();
            } catch {
              /* peer key parse / decrypt errors are surfaced by the
               * explicit Settings → Git flow, not the auto-pull */
            }
          }
        });
      } catch {
        /* listen unavailable in test env */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const value = useMemo<GitStore>(
    () => ({ ...state, refresh, scanAndPublish, fetchRemote, buildRepoGraph }),
    [state, refresh, scanAndPublish, fetchRemote, buildRepoGraph],
  );

  return <GitContext.Provider value={value}>{children}</GitContext.Provider>;
}

export function useGitStore(): GitStore {
  const ctx = useContext(GitContext);
  if (!ctx) {
    throw new Error("useGitStore must be used inside <GitProvider>");
  }
  return ctx;
}

/**
 * Helper — flatten `snapshots` into a list of (host, repo, owner_repo)
 * tuples, deduped by owner_repo so the L1 dashboard's "Repo Card grid"
 * has one row per repo regardless of how many hosts publish it.
 */
export function uniqueOwnerRepos(snapshots: HostGitSnapshot[]): string[] {
  const seen = new Set<string>();
  for (const snap of snapshots) {
    for (const r of snap.repos) {
      if (r.owner_repo && !seen.has(r.owner_repo)) seen.add(r.owner_repo);
    }
  }
  return [...seen].sort();
}
