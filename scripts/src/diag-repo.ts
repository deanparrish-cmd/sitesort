import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const OWNER = "deanparrish-cmd", REPO = "sitesort";
async function api(endpoint: string) {
  const resp = await connectors.proxy("github", endpoint, { method: "GET", headers: { "Content-Type": "application/json" } } as ProxyOptions);
  return { status: (resp as any).status, body: await resp.json() };
}
const repo = await api(`/repos/${OWNER}/${REPO}`);
console.log("repo:", JSON.stringify({ default_branch: repo.body.default_branch, size: repo.body.size, pushed_at: repo.body.pushed_at, status: repo.status }));
const refs = await api(`/repos/${OWNER}/${REPO}/git/refs/heads`);
console.log("refs/heads:", JSON.stringify(refs.body).slice(0, 400));
const commits = await api(`/repos/${OWNER}/${REPO}/commits?per_page=3`);
if (Array.isArray(commits.body)) for (const c of commits.body) console.log("commit:", c.sha?.slice(0,8), "|", c.commit?.message?.split("\n")[0], "|", c.commit?.committer?.date);
else console.log("commits resp:", JSON.stringify(commits.body).slice(0,200));
