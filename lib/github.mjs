// GitHub から「読むだけ」。書き込み・実行は一切しない。
// 非公開リポジトリも読むため、読み取り専用の鍵(GH_READ_TOKEN)を使う。

const API = 'https://api.github.com';

export function githubClient({ token, fetchImpl = fetch }) {
  const headers = { 'User-Agent': 'sns-daily-digest', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function get(path, accept = 'application/vnd.github+json') {
    const res = await fetchImpl(`${API}${path}`, { headers: { ...headers, Accept: accept } });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return body;
  }

  return {
    // ファイルの中身(JSON)。無いファイルは fallback。
    async readJson(owner, repo, path, fallback = null) {
      try {
        return JSON.parse(await get(`/repos/${owner}/${repo}/contents/${path}`, 'application/vnd.github.raw+json'));
      } catch (err) {
        if (String(err.message).includes('404')) return fallback;
        throw err;
      }
    },
    // since 以降に終わった、失敗した実行の一覧。
    async failedRuns(owner, repo, sinceIso) {
      const q = new URLSearchParams({ status: 'failure', per_page: '50', created: `>=${sinceIso.slice(0, 10)}` });
      const json = JSON.parse(await get(`/repos/${owner}/${repo}/actions/runs?${q}`));
      return (json.workflow_runs ?? [])
        .filter((r) => r.updated_at >= sinceIso)
        .map((r) => ({ repo, name: r.name, url: r.html_url, updatedAt: r.updated_at, event: r.event }));
    },
    // このリポジトリ自身の、前回(完了済み)の見回りの開始時刻。
    async previousRunStart(ownerRepo, workflow, currentRunId) {
      const json = JSON.parse(await get(`/repos/${ownerRepo}/actions/workflows/${workflow}/runs?per_page=5`));
      const prev = (json.workflow_runs ?? []).find((r) => String(r.id) !== String(currentRunId) && r.status === 'completed');
      return prev?.run_started_at ?? prev?.created_at ?? null;
    },
  };
}

// 試し用: GitHub の代わりに手元のフォルダ(<dir>/<repo>/<path>)を読む。dry-run の確認やテストで使う。
// 失敗した実行は <dir>/<repo>/_failed-runs.json（[{ name, url, updatedAt }]）。
export function fixtureClient(dir) {
  const load = async (repo, path, fallback) => {
    const { readFile } = await import('node:fs/promises');
    try {
      return JSON.parse(await readFile(`${dir}/${repo}/${path}`, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  };
  return {
    readJson: (owner, repo, path, fallback = null) => load(repo, path, fallback),
    async failedRuns(owner, repo, sinceIso) {
      return (await load(repo, '_failed-runs.json', [])).filter((r) => r.updatedAt >= sinceIso).map((r) => ({ repo, ...r }));
    },
    previousRunStart: async () => null,
  };
}
