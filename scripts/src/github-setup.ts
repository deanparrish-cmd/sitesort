import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

async function main() {
  const userResp = await connectors.proxy("github", "/user", { method: "GET" });
  const user = await userResp.json() as { login: string; name: string };
  console.log(`GitHub user: ${user.login} (${user.name})`);

  const repoName = "sitesort";
  const createResp = await connectors.proxy("github", "/user/repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: repoName,
      description: "SiteSort – Construction site information management platform",
      private: false,
      auto_init: false,
    }),
  });

  const repo = await createResp.json() as { html_url?: string; message?: string; clone_url?: string };

  if (repo.html_url) {
    console.log(`Repository created: ${repo.html_url}`);
    console.log(`Clone URL: ${repo.clone_url}`);
    console.log(`owner:${user.login}`);
    console.log(`repo:${repoName}`);
  } else {
    console.error("Error creating repo:", JSON.stringify(repo));
  }
}

main().catch(console.error);
