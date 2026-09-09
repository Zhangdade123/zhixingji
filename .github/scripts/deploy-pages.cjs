// Use the artifact ID returned by upload-pages-artifact, avoiding a redundant
// ListArtifacts call. Pages still validates the standard workflow OIDC token.
module.exports = async function deploy({github, context, core, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const artifactId = process.env.PAGES_ARTIFACT_ID;
  if (!/^\d+$/.test(artifactId || '')) throw Error('Upload did not return an artifact ID');
  const idToken = await core.getIDToken();
  core.setSecret(idToken);
  const repo = {owner: context.repo.owner, repo: context.repo.repo};
  const {data: deployment} = await github.request('POST /repos/{owner}/{repo}/pages/deployments', {
    ...repo, artifact_id: Number(artifactId), pages_build_version: context.sha, oidc_token: idToken
  });
  if (!deployment.id) throw Error('Pages did not return a deployment ID');
  for (let attempt = 0; attempt < 48; attempt++) {
    const {data} = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{deployment_id}', {
      ...repo, deployment_id: deployment.id
    });
    core.info(`Pages deployment status: ${data.status}`);
    if (data.status === 'succeed') {
      core.setOutput('page_url', deployment.page_url || 'https://zhangdade123.github.io/zhixingji/');
      return;
    }
    if (['errored','failed','deployment_failed','deployment_cancelled','deployment_perms_error','deployment_content_failed','deployment_lost','cancelled'].includes(data.status)) {
      throw Error(`Pages deployment failed: ${data.status}`);
    }
    await sleep(10000);
  }
  throw Error('Pages deployment did not finish within eight minutes');
};
