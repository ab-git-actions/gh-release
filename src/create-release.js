const core = require('@actions/core');
const github = require('@actions/github');
const generateRelease  = require('./nextVersion')
// const { GitHub, context } = require('@actions/github');


async function run() {
    try {
        const gitToken = core.getInput('github_token', {required: false});
        const octokit = github.getOctokit(gitToken);
        // const octokit = new GitHub(gitToken)

        const { owner: gitOrg, repo: gitRepo } = github.context.repo;
        // const latestSha = github.context.sha;
        const prNumber = github.context.payload.pull_request.number
        const prTittle = github.context.payload.pull_request.tittle;
        // const releaseBody = prTittle + "-" + prNumber;

        const { nextVersion, releaseBody, latestSha } = generateRelease();

        // Get existing git release tags from where the action is being executed
        const {data: tags} =  await octokit.rest.repos.listTags({
            owner: gitOrg,
            repo: gitRepo
        });

        // Logging the entire tags object
        core.info(`\u001b[35mExisting GitHub tags: ${JSON.stringify(tags, null, 2)}`);

        // Loop through the tags and log each one
        tags.forEach((tag) => {
            core.info(`\u001b[35mExisting GitHub tags: ${tag.name}`);
        });

        // Get the pull request details from the context
        const pullRequest = github.context.payload.pull_request;

        // Check if the pull request is merged
        /** @type {boolean} */
        const isMerged = pullRequest.merged;

        // Check the base branch (where the PR was merged into)
        const baseBranch = pullRequest.base.ref;

        if (isMerged && (baseBranch === 'main' || baseBranch === 'master')) {
            const createRelease= await octokit.rest.repos.createRelease({
                owner: gitOrg,
                repo: gitRepo,
                tag_name: nextVersion,
                target_commitish: latestSha,
                name: nextVersion,
                body: releaseBody,
                prerelease: false,
                make_latest: 'true'
            })

            const {
                data:
                {
                    id: releaseId,
                    html_url: releaseUrl,
                }
            } = createRelease;
            core.info(releaseId);
            core.info(releaseUrl);

            // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
            core.setOutput("GitHub Release URL", releaseUrl)
        }


        
    }catch(error) {
        core.setFailed(`Action failed with error: ${error.message}`);
    }
}



module.exports = run;