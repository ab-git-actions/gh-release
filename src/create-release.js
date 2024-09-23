const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');
// const { GitHub, context } = require('@actions/github');


const gitToken = core.getInput('github_token', {required: false});
const octokit = github.getOctokit(gitToken);

// Fetch the latest Git tag from the repository
async function getLatestTag(owner, repo) {
    try {
        const tags = await octokit.rest.repos.listTags({
            owner,
            repo,
            per_page: 1 // Get only the latest tag
        });

        if (tags.data.length === 0) {
            core.info('\u001b[38;5;6mNo tags found in the repository.');
            return null;
        }

        const latestTag = tags.data[0].name;
        core.info(`\u001b[38;5;6mLatest tag: ${latestTag}`);
        return latestTag;
    } catch (error) {
        core.error(`\u001b[38;2;255;0;0mError fetching tags: ${error.message}`);
        core.setFailed(`Error fetching tags: ${error.message}`);
    }
}

// Fetch the commit messages since the latest tag
async function getCommitsSinceTag(owner, repo, latestTag) {
    try {
        // Fetch the commits after the latest tag up to HEAD
        const commits = await octokit.rest.repos.listCommits({
            owner,
            repo,
            // Provide the reference range: latestTag..HEAD
            sha: 'HEAD',
            per_page: 100, // Adjust as necessary, default is 30
        });

        // Filter commits after the latest tag
        const commitMessages = [];
        let foundLatestTag = false;

        for (const commit of commits.data) {
            const commitMessage = commit.commit.message;

            // Stop adding commits once the latest tag is found in commit history
            if (commit.sha === latestTag || commitMessage.includes(latestTag)) {
                foundLatestTag = true;
                break;
            }

            // Add commits that are after the latest tag
            commitMessages.push(commitMessage);
        }

        if (!foundLatestTag) {
            console.log("Warning: Could not find the latest tag in the commit history.");
        }

        console.log(`Commits since ${latestTag}:`, commitMessages);
        return commitMessages;
    } catch (error) {
        core.error(`\u001b[38;2;255;0;0mError fetching commits: ${error.message}`);
        core.setFailed(`Error fetching commits: ${error.message}`);
    }
}


// Determine the type of version bump based on commit messages
function determineBumpType(commits) {
    let bumpType = 'patch'; // Default bump type

    commits.forEach((commit) => {
        if (commit.startsWith('feat')) {
            bumpType = 'minor'; // Minor bump for features
        }
        if (commit.startsWith('fix')) {
            bumpType = 'patch'; // Patch bump for fixes
        }
        if (commit.startsWith('BREAKING CHANGE') || commit.includes('BREAKING CHANGE')) {
            bumpType = 'major'; // Major bump for breaking changes
        }
    });

    core.info(`\u001b[38;5;6mDetermined bump type: ${bumpType}`);
    return bumpType;
}

// Calculate the next version using semver
function calculateNextVersion(latestTag, bumpType) {
    const newVersion = semver.inc(latestTag, bumpType);
    core.info(`\u001b[38;5;6mNew version: ${newVersion}`);
    return newVersion;
}

async function run() {
    try {
        const { owner: gitOrg, repo: gitRepo } = github.context.repo;

        const latestTag = await getLatestTag(gitOrg, gitRepo);

        if (latestTag) {
            // Step 2: Get commits since the latest tag
            const commits = await getCommitsSinceTag(gitOrg, gitRepo, latestTag);

            // Step 3: Determine the bump type based on commit messages
            const bumpType = determineBumpType(commits);

            // Step 4: Calculate the next version
            const newVersion = calculateNextVersion(latestTag, bumpType);

            // Get existing git release tags from where the action is being executed
            const {data: tags} =  await octokit.rest.repos.listTags({
                owner: gitOrg,
                repo: gitRepo
            });

            // Loop through the tags and log each one
            tags.forEach((tag) => {
                core.info(`\u001b[35mExisting GitHub tags: ${tag.name}`);
            });

            const pushEvent = (github.context.eventName === 'push')

            // This will give you the branch name, like 'refs/heads/main'
            const branchName = github.context.ref.replace('refs/heads/', '');

            if (pushEvent && (branchName === 'main' || branchName === 'master')) {

                const createRelease= await octokit.rest.repos.createRelease({
                    owner: gitOrg,
                    repo: gitRepo,
                    tag_name: newVersion,
                    target_commitish: latestTag,
                    name: newVersion,
                    body: "Testing",
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
        }

        // const latestSha = github.context.sha;
        // const prNumber = github.context.payload.pull_request.number
        // const prTitle = github.context.payload.pull_request.tittle;
        // const releaseBody = prTitle + "-" + prNumber;

    }catch(error) {
        core.setFailed(`Action failed with error: ${error.message}`);
    }
}

module.exports = run;
